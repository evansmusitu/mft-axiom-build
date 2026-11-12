#!/usr/bin/env python3
"""Bounded Cloudflare Queues *topology* read; NOT tenant/PG/fairness attestation.

This is a one-shot, fail-closed, GET-only audit. It hashes service identifiers
rather than storing queue names, Worker names, or raw provider bodies.
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ACCOUNT_ID = '93f395f5121954671f92fffa453d6b61'
ORIGIN = 'https://api.cloudflare.com'
PREFIX = f'/client/v4/accounts/{ACCOUNT_ID}/queues'
MAX_QUEUES = 32
MAX_PAGES = 5
MAX_BODY = 131072
MAX_ENDPOINTS = 32
IDENTIFIER = re.compile(r'[0-9a-f]{32}\Z')
OUT = Path('mcn072-cloudflare-topology-readonly.json')

class ProbeFailure(Exception): pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def hash_id(s, field="RESOURCE"):
    if not isinstance(s, str) or not s or len(s) > 255 or any(ord(c) < 33 for c in s):
        raise ProbeFailure(field+'_MISSING_OR_INVALID')
    return hashlib.sha256(s.encode('utf-8')).hexdigest()

def exact_int(value, limit):
    if type(value) is not int or not 0 <= value <= limit:
        raise ProbeFailure('RESOURCE_COUNT_INVALID')
    return value

def fetch(path, token, opener):
    if not (re.fullmatch(re.escape(PREFIX) + r'\?page=[1-5]&per_page=100',path)
            or re.fullmatch(re.escape(PREFIX) + r'/[0-9a-f]{32}(?:/consumers(?:/[0-9a-f]{32})?)?',path)):
        raise ProbeFailure('UNAPPROVED_URL_PATH')
    if not isinstance(token,str) or not token or any(c.isspace() for c in token):
        raise ProbeFailure('TOKEN_UNAVAILABLE_OR_INVALID')
    req=urllib.request.Request(ORIGIN+path, method='GET', headers={
        'Authorization':'Bearer '+token, 'Accept':'application/json',
        'User-Agent':'MUSITU-MCN072-Topology-GET/1.0'})
    try:
        with opener.open(req,timeout=15) as response:
            if response.status != 200 or 'application/json' not in response.headers.get('Content-Type','').lower():
                raise ProbeFailure('UPSTREAM_RESPONSE_INVALID')
            data=response.read(MAX_BODY+1)
    except urllib.error.HTTPError as exc:
        raise ProbeFailure('UPSTREAM_HTTP_'+str(exc.code)) from None
    except (urllib.error.URLError,TimeoutError,OSError):
        raise ProbeFailure('UPSTREAM_UNREACHABLE') from None
    if len(data)>MAX_BODY:raise ProbeFailure('UPSTREAM_RESPONSE_OVERSIZE')
    try: payload=json.loads(data)
    except (ValueError, UnicodeError):raise ProbeFailure('UPSTREAM_JSON_INVALID') from None
    if type(payload) is not dict or payload.get('success') is not True:
        raise ProbeFailure('UPSTREAM_ENVELOPE_INVALID')
    return payload,hashlib.sha256(data).hexdigest()

def checked_endpoints(entries,total,role):
    exact_int(total,MAX_ENDPOINTS)
    if not isinstance(entries,list) or len(entries)!=total:
        raise ProbeFailure(role+'_INVENTORY_INCOMPLETE')
    worker_count=0
    http_pull_count=0
    r2_count=0
    names=[]
    for entry in entries:
        if type(entry) is not dict:raise ProbeFailure(role+'_ENTRY_INVALID')
        kind=entry.get('type')
        if role=='PRODUCER':
            if kind=='worker':
                target=entry.get('script');field='PRODUCER_WORKER_SCRIPT';worker_count+=1
            elif kind=='r2_bucket':
                target=entry.get('bucket_name');field='PRODUCER_R2_BUCKET';r2_count+=1
            else:raise ProbeFailure('UNKNOWN_PRODUCER_TYPE')
        else:
            if kind=='worker':
                target=entry.get('script_name');field='CONSUMER_WORKER_SCRIPT';worker_count+=1
            elif kind=='http_pull':
                target=entry.get('consumer_id');field='CONSUMER_HTTP_PULL_ID';http_pull_count+=1
            else:raise ProbeFailure('UNKNOWN_CONSUMER_TYPE')
        names.append(hash_id(target,field))
    if len(names)!=len(set(names)):
        raise ProbeFailure(role+'_DUPLICATE_TARGET')
    return {'worker_count':worker_count,'http_pull_count':http_pull_count,
            'r2_count':r2_count,'target_sha256':sorted(names)}

def inspect(token, opener):
    if not isinstance(token,str) or not token or any(c.isspace() for c in token):
        raise ProbeFailure('TOKEN_UNAVAILABLE_OR_INVALID')
    rows=[];list_hashes=[];last_pages=None
    for page in range(1,MAX_PAGES+1):
        response,digest=fetch(f'{PREFIX}?page={page}&per_page=100',token,opener)
        info=response.get('result_info');items=response.get('result')
        if type(info) is not dict or not isinstance(items,list):
            raise ProbeFailure('QUEUE_LIST_SHAPE_INVALID')
        pages=exact_int(info.get('total_pages'),MAX_PAGES)
        if pages<1 or info.get('page')!=page or (last_pages is not None and pages!=last_pages):
            raise ProbeFailure('QUEUE_LIST_PAGINATION_INVALID')
        last_pages=pages;rows.extend(items);list_hashes.append(digest)
        if len(rows)>MAX_QUEUES:raise ProbeFailure('QUEUE_LIST_TOO_LONG')
        if page==pages:break
    else:raise ProbeFailure('QUEUE_LIST_INCOMPLETE')
    if len(rows)!=exact_int(info.get('total_count'),MAX_QUEUES):
        raise ProbeFailure('QUEUE_LIST_COUNT_INVALID')
    output=[];unique=set()
    for row in rows:
        if type(row) is not dict or not isinstance(row.get('queue_id'),str):
            raise ProbeFailure('QUEUE_ID_INVALID')
        qid=row['queue_id']
        if not IDENTIFIER.fullmatch(qid) or qid in unique:
            raise ProbeFailure('QUEUE_ID_INVALID_OR_DUPLICATED')
        unique.add(qid)
        details,digest=fetch(f'{PREFIX}/{qid}',token,opener)
        body=details.get('result')
        if type(body) is not dict or body.get('queue_id')!=qid:
            raise ProbeFailure('QUEUE_DETAILS_IDENTITY_MISMATCH')
        p=checked_endpoints(body.get('producers'),body.get('producers_total_count'),'PRODUCER')
        consumer_rows=body.get('consumers')
        consumer_list_hash=None
        consumer_detail_hashes=[]
        if isinstance(consumer_rows,list) and any(
            isinstance(c,dict) and c.get('type')=='worker' and
            (not isinstance(c.get('script_name'),str) or not c.get('script_name'))
            for c in consumer_rows
        ):
            # A second Cloudflare GET may return a fuller worker identifier.
            # Require exact consumer-ID identity and type before trusting it.
            listing,consumer_list_hash=fetch(f'{PREFIX}/{qid}/consumers',token,opener)
            other=listing.get('result')
            if not isinstance(other,list) or len(other)!=len(consumer_rows):
                raise ProbeFailure('CONSUMER_LIST_COUNT_MISMATCH')
            by_id={}
            for item in other:
                if type(item) is not dict or not isinstance(item.get('consumer_id'),str) or not IDENTIFIER.fullmatch(item['consumer_id']):
                    raise ProbeFailure('CONSUMER_LIST_ID_INVALID')
                if item['consumer_id'] in by_id:
                    raise ProbeFailure('CONSUMER_LIST_DUPLICATE_ID')
                by_id[item['consumer_id']]=item
            resolved=[]
            for old in consumer_rows:
                if type(old) is not dict or not isinstance(old.get('consumer_id'),str) or not IDENTIFIER.fullmatch(old['consumer_id']):
                    raise ProbeFailure('CONSUMER_DETAILS_ID_INVALID')
                incoming=by_id.pop(old['consumer_id'],None)
                if type(incoming) is not dict or incoming.get('type')!=old.get('type'):
                    raise ProbeFailure('CONSUMER_LIST_IDENTITY_CONFLICT')
                name=old.get('script_name')
                if old['type']=='worker' and (not isinstance(name,str) or not name):
                    name=incoming.get('script_name')
                    if not isinstance(name,str) or not name:
                        # Lookup one consumer using an exact account/queue/id-pinned
                        # GET. Never infer a Worker script from an optional field.
                        exact,digest_exact=fetch(
                            f'{PREFIX}/{qid}/consumers/{old["consumer_id"]}',token,opener)
                        exact_item=exact.get('result')
                        if (type(exact_item) is not dict or
                            exact_item.get('consumer_id')!=old['consumer_id'] or
                            exact_item.get('type')!='worker'):
                            raise ProbeFailure('CONSUMER_EXACT_IDENTITY_CONFLICT')
                        for prior in (old,incoming):
                            queue_name=prior.get('queue_name')
                            if queue_name is not None and exact_item.get('queue_name')!=queue_name:
                                raise ProbeFailure('CONSUMER_EXACT_QUEUE_NAME_CONFLICT')
                        name=exact_item.get('script_name')
                        consumer_detail_hashes.append(digest_exact)
                elif old['type']=='worker' and incoming.get('script_name') not in (None,name):
                    raise ProbeFailure('CONSUMER_LIST_SCRIPT_CONFLICT')
                resolved.append({**old, 'script_name':name} if old['type']=='worker' else old)
            if by_id:raise ProbeFailure('CONSUMER_LIST_EXTRA_ID')
            consumer_rows=resolved
        c=checked_endpoints(consumer_rows,body.get('consumers_total_count'),'CONSUMER')
        output.append({'queue_id_sha256':hash_id(qid),'details_sha256':digest,
          'producer_total_count':body['producers_total_count'],
          'consumer_total_count':body['consumers_total_count'],
          'worker_producer_count':p['worker_count'],
          'r2_producer_count':p['r2_count'],
          'worker_consumer_count':c['worker_count'],
          'http_pull_consumer_count':c['http_pull_count'],
          'producer_target_sha256':p['target_sha256'],
          'consumer_target_sha256':c['target_sha256'],
          'consumer_list_sha256':consumer_list_hash,
          'consumer_detail_sha256':consumer_detail_hashes})
    return {'inventory_sha256':list_hashes,'queue_count':len(output),'queues':output,
            'tenant_mapping_verified':False,'postgres_scheduler_correlated':False,
            'independent_witness_verified':False,'mcn072_qualified':False}

def main():
    out={'schema':'musitu.mcn072.cloudflare_queue_topology_observation.v1',
         'account_id':ACCOUNT_ID,'observed_utc':datetime.now(timezone.utc).isoformat(),
         'github_run_id':os.getenv('GITHUB_RUN_ID',''),
         'github_sha':os.getenv('GITHUB_SHA',''),
         'method':'GET','cloudflare_mutations':0,'tenant_mapping_verified':False,
         'postgres_scheduler_correlated':False,'independent_witness_verified':False,
         'mcn072_qualified':False,'commercial_ga':'NO_GO'}
    try:
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        out.update(inspect(os.getenv('CLOUDFLARE_API_TOKEN',''),opener))
        out['observation_status']='TOPOLOGY_OBSERVED_NOT_FAIRNESS';code=0
    except ProbeFailure as exc:
        out['observation_status']='BLOCKED';out['reason_code']=str(exc);code=2
    except Exception:
        out['observation_status']='BLOCKED';out['reason_code']='UNEXPECTED_FAIL_CLOSED';code=2
    raw=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
    OUT.write_bytes(raw)
    OUT.with_name(OUT.name+'.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  '+OUT.name+'\n')
    print(json.dumps({'observation_status':out['observation_status'],
                      'queue_count':out.get('queue_count'),
                      'reason_code':out.get('reason_code'),
                      'cloudflare_mutations':0,'mcn072_qualified':False},sort_keys=True))
    return code

if __name__=='__main__':sys.exit(main())
