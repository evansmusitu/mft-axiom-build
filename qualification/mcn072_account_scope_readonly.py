#!/usr/bin/env python3
"""MCN-072 Cloudflare account-scope discovery. GitHub secret-backed, GET-only, no credential export.

Cloudflare accounts / Queues / Workers metadata only. Every provider reply is discarded
in-memory after digesting/sanitization. No raw ids, names, secrets, URLs, bodies or
script source are written. This probe NEVER authenticates PostgreSQL or fairness.
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

AUTH_FAMILIES = {
 'CLOUDFLARE_API_TOKEN': 'bearer',
 'CLOUDFLARE_GLOBAL_API_KEY': 'global',
 'CLOUDFLARE_API_KEY': 'global',
 'MUSITU_CF_STAGING_READ_TOKEN': 'bearer',
}
DEFAULT_ACCOUNT = '93f395f5121954671f92fffa453d6b61'  # existing source-pinned MCN-072 account
BASE = 'https://api.cloudflare.com'
OUT = Path('mcn072-cloudflare-all-account-scopes.json')
MAX_BYTES = 300000
ACCOUNT_RE = re.compile(r'[0-9a-f]{32}\Z')
SCRIPT_RE = re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')
PAGE_ACCOUNTS = re.compile(r'/client/v4/accounts\?page=[1-5]&per_page=50\Z')
QUEUES = re.compile(r'/client/v4/accounts/[0-9a-f]{32}/queues\?page=1&per_page=100\Z')
WORKERS = re.compile(r'/client/v4/accounts/[0-9a-f]{32}/workers/scripts\Z')
ID_RE = re.compile(r'[0-9a-f]{32}\Z')
NAME_CUE = re.compile(r'axiom|musitu|mcn|schedul|postgres|tenant|fair|queue|jobs?',re.I)

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self, req, fp, code, msg, headers, newurl): return None

class ProbeError(Exception): pass

def sha(v): return hashlib.sha256(v if isinstance(v,bytes) else str(v).encode()).hexdigest()

def account_id(value):
 return value.lower() if isinstance(value,str) and ACCOUNT_RE.fullmatch(value.lower()) else None

def allowed_path(path):
 return isinstance(path,str) and bool(PAGE_ACCOUNTS.fullmatch(path) or QUEUES.fullmatch(path) or WORKERS.fullmatch(path) or path in ('/client/v4/user','/client/v4/user/tokens/verify'))

def initial_report():
 return {'schema':'musitu.mcn072.cloudflare_account_scope_getonly.v1','mcn072':'NO_GO',
         'postgres_correspondence_authenticated':False,'qualified_live_windows':0,
         'credentials_exported':False,'network_mutations':0,
         'cloudflare_methods':['GET'], 'authority_scope':'ACCOUNT_AND_QUEUE_METADATA_ONLY'}

def available_auth():
 result={}
 for label,kind in AUTH_FAMILIES.items():
  value=os.environ.get(label,'')
  valid=isinstance(value,str) and 12<=len(value)<=512 and not any(c.isspace() for c in value)
  if kind=='global':
   email=os.environ.get('CLOUDFLARE_EMAIL','')
   valid=valid and '@' in email and '\n' not in email and '\r' not in email
  result[label]={'available':bool(valid),'kind':kind}
 return result

def _unique_json(pairs):
 out={}
 for key,value in pairs:
  if key in out: raise ProbeError('DUPLICATE_JSON_KEY')
  out[key]=value
 return out

def read(path, family, opener):
 if not allowed_path(path): raise ProbeError('PATH_NOT_ALLOWLISTED')
 label, kind=family,AUTH_FAMILIES[family]
 key=os.environ.get(label,'')
 if not available_auth()[label]['available']:raise ProbeError('AUTH_NOT_CONFIGURED')
 headers={'Accept':'application/json','User-Agent':'MUSITU-MCN072-AccountScope-GETONLY/1.0'}
 if kind=='bearer': headers['Authorization']='Bearer '+key
 else:
  headers['X-Auth-Email']=os.environ['CLOUDFLARE_EMAIL']
  headers['X-Auth-Key']=key
 req=urllib.request.Request(BASE+path,headers=headers,method='GET')
 try:
  with opener.open(req,timeout=15) as r:
   if r.status!=200:raise ProbeError('HTTP_NOT_200')
   if 'application/json' not in r.headers.get('Content-Type','').lower():raise ProbeError('MIME_NOT_JSON')
   body=r.read(MAX_BYTES+1)
 except urllib.error.HTTPError as e:raise ProbeError('HTTP_'+str(e.code)) from None
 except (urllib.error.URLError,OSError,TimeoutError):raise ProbeError('TRANSPORT_UNAVAILABLE') from None
 if len(body)>MAX_BYTES:raise ProbeError('OVERSIZE')
 try: payload=json.loads(body,object_pairs_hook=_unique_json)
 except (ValueError,UnicodeError):raise ProbeError('BAD_JSON') from None
 if type(payload) is not dict or payload.get('success') is not True:
  raise ProbeError('RESPONSE_NOT_SUCCESS')
 expected=dict if path in ('/client/v4/user','/client/v4/user/tokens/verify') else list
 if type(payload.get('result')) is not expected:raise ProbeError('RESPONSE_RESULT_WRONG_TYPE')
 return payload,sha(body)

def summarize_queue(raw):
 if type(raw) is not dict:raise ProbeError('QUEUE_ROW_INVALID')
 qid=raw.get('queue_id')
 name=raw.get('queue_name')
 if type(qid) is not str or not ID_RE.fullmatch(qid):raise ProbeError('QUEUE_ID_INVALID')
 if type(name) is not str or not 0<len(name)<=128:raise ProbeError('QUEUE_NAME_INVALID')
 rows=raw.get('consumers') or []
 if type(rows) is not list or len(rows)>50:raise ProbeError('CONSUMER_COUNT_INVALID')
 workers=[]
 for x in rows:
  if type(x) is not dict:raise ProbeError('CONSUMER_ROW_INVALID')
  if x.get('type')=='worker':
   alias=x.get('script_name') or x.get('script')
   workers.append({'alias_sha256':sha(alias) if type(alias) is str and SCRIPT_RE.fullmatch(alias) else None,
                   'matches_prior_worker':type(alias) is str and sha(alias)=='858e0f26ca2186c35dd97e229a0b3b155281bab97fa9bf52cc8349d00c8ae009'})
 return {'id_sha256':sha(qid),'queue_name_sha256':sha(name),'scheduler_name_cue':bool(NAME_CUE.search(name)),
         'has_worker_consumer':bool(workers),'worker_consumers':workers,
         'consumer_count':len(rows)}

def _configured_accounts():
 by={DEFAULT_ACCOUNT:{'historical_audit_account'}}
 for label in ('MUSITU_CF_PRODUCTION_ACCOUNT_ID','MUSITU_CF_STAGING_ACCOUNT_ID'):
  aid=account_id(os.environ.get(label,''))
  if aid:by.setdefault(aid,set()).add(label)
 return by

def _merge_accounts_by_provider(family,opener,accounts):
 count=0; status='COMPLETE'
 for page in range(1,6):
  try: data,_=read(f'/client/v4/accounts?page={page}&per_page=50',family,opener)
  except ProbeError as e:return 'UNAVAILABLE_'+str(e) if page==1 else 'PARTIAL_'+str(e),count
  rows=data['result']
  if len(rows)>50:return 'OVERSIZE_PAGE',count
  for a in rows:
   aid=account_id(a.get('id')) if type(a) is dict else None
   if not aid:return 'INVALID_ACCOUNT_ROW',count
   accounts.setdefault(aid,set()).add('provider_accounts_list')
   count+=1
  meta=data.get('result_info') or {}
  if len(rows)<50 or (type(meta) is dict and isinstance(meta.get('total_pages'),int) and page>=meta['total_pages']):break
 else:status='TRUNCATED_MAX_5_PAGES'
 return status,count

def probe_auth_family(label,opener):
 out={'credential_label':label,'credential_kind':AUTH_FAMILIES[label],
      'credential_configured':available_auth()[label]['available'],
      'account_list_status':'NOT_ATTEMPTED','candidate_accounts':[],
      'candidate_count':0,'scoped_accounts_probed':0}
 if not out['credential_configured']:return out
 identity_path='/client/v4/user/tokens/verify' if AUTH_FAMILIES[label]=='bearer' else '/client/v4/user'
 try:
  p,_=read(identity_path,label,opener)
  out['identity_check_status']='SUCCESS'
  if AUTH_FAMILIES[label]=='bearer':out['token_state_active']=p.get('result',{}).get('status')=='active'
 except ProbeError as e:out['identity_check_status']=str(e)
 accounts=_configured_accounts()
 status,number=_merge_accounts_by_provider(label,opener,accounts)
 out['account_list_status']=status
 out['provider_account_count']=number
 for aid,sources in sorted(accounts.items(),key=lambda x:sha(x[0])):
  entry={'account_id_sha256':sha(aid),'historical_audit_account':aid==DEFAULT_ACCOUNT,
         'candidate_tags':sorted(sources),'queues_read_status':'NOT_ATTEMPTED',
         'workers_read_status':'NOT_ATTEMPTED','queues':[],'queue_count':None,'worker_count':None}
  try:
   p,digest=read(f'/client/v4/accounts/{aid}/queues?page=1&per_page=100',label,opener)
   raw=p['result'];entry['queues_read_status']='SUCCESS';entry['queue_response_sha256']=digest
   if len(raw)>100:raise ProbeError('QUEUES_TOO_MANY')
   entry['queues']=[summarize_queue(x) for x in raw]
   entry['queue_count']=len(raw)
   info=p.get('result_info') or {}
   if isinstance(info,dict) and isinstance(info.get('total_pages'),int) and info['total_pages']>1:
    entry['queues_read_status']='INCOMPLETE_MULTIPAGE'
  except ProbeError as e:entry['queues_read_status']=str(e);entry['queues']=[]
  try:
   p,digest=read(f'/client/v4/accounts/{aid}/workers/scripts',label,opener)
   rows=p['result']
   entry['workers_read_status']='SUCCESS';entry['workers_response_sha256']=digest
   entry['worker_count']=len(rows)
   entry['prior_worker_in_inventory']=any(type(x) is dict and type(x.get('id')) is str and sha(x.get('id'))=='858e0f26ca2186c35dd97e229a0b3b155281bab97fa9bf52cc8349d00c8ae009' for x in rows)
  except ProbeError as e:entry['workers_read_status']=str(e)
  out['candidate_accounts'].append(entry)
  out['scoped_accounts_probed']+=1
  if len(out['candidate_accounts'])>=55:
   out['candidate_inventory_truncated']=True
   break
 out['candidate_count']=len(out['candidate_accounts'])
 return out

def main():
 report=initial_report()
 report['secret_families_referenced_by_source']=list(AUTH_FAMILIES)
 report['account_identity_sources']=['historical_audit_account','MUSITU_CF_PRODUCTION_ACCOUNT_ID','MUSITU_CF_STAGING_ACCOUNT_ID','provider_accounts_list']
 report['not_a_cloudflare_api_credential']=['MUSITU_CONNECT_AXIOM_ACCOUNT_KEY','MUSITU_CF_STAGING_DATABASE_ID','MUSITU_CF_STAGING_DATABASE_NAME']
 opener=urllib.request.build_opener(NoRedirect())
 report['audits']=[]
 for label in AUTH_FAMILIES:
  try:report['audits'].append(probe_auth_family(label,opener))
  except Exception:report['audits'].append({'credential_label':label,'status':'UNCLASSIFIED_FAILURE'})
 raw=(json.dumps(report,sort_keys=True,indent=2)+'\n').encode()
 OUT.write_bytes(raw)
 OUT.with_suffix('.json.sha256').write_text(sha(raw)+'  '+OUT.name+'\n')
 print(json.dumps({'mcn072':'NO_GO','credential_families_tested':len(report['audits']),
                   'configured_families':sum(x.get('credential_configured',False) for x in report['audits']),
                   'accounts_tested':sum(x.get('scoped_accounts_probed',0) for x in report['audits']),
                   'provider_authenticated_postgres':False},sort_keys=True))
 return 0

if __name__=='__main__':sys.exit(main())
