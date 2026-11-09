"""MUSITU AXIOM owner-only isolated D1 Time Travel rollback to independently witnessed empty state.

ONE TARGET ONLY. Never production OAuth. One restore POST at most. Fail closed on drift.
No application/customer records read or persisted. Only schema and aggregate SELECT.
Owner-approved disposable D1. Historic empty state observed in immutable CI 42595180224.
"""
import datetime
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ACCOUNT='c954f0c842a486d0388c05b19cd21e47'
TARGET='c023a0a0-472a-4178-ad07-02f1d6b2e122'
TARGET_NAME='axiom-dr-clean-restore-20261109'
EMPTY_WITNESSED_AT='2026-11-09T09:40:18Z'
EMPTY_WITNESS_RUN=42595180224
EXACT_APP_SCHEMA_SHA='694014c4d0b6e470518e5f4e70695fee27bbb5ac25095cf462f9451fd95ea116'
EXPECTED_TABLES=17
EXPECTED_ROWS=4764
ROOT='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT
CATALOG="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
APP_RESERVED={'_cf_KV','_cf_METADATA'}
IDENTIFIER=re.compile(r'[A-Za-z0-9_]{1,128}\Z',re.ASCII)
BOOKMARK=re.compile(r'[0-9a-f-]{20,110}\Z',re.ASCII)
START=time.monotonic()
CALLS=0

class Halt(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None
opener=urllib.request.build_opener(NoRedirect())

def canonical(d):
    return json.dumps(d,sort_keys=True,separators=(',',':'),ensure_ascii=True)
def sha(v):
    return hashlib.sha256(v if isinstance(v,bytes) else v.encode('utf8')).hexdigest()
def valid_bookmark(v):
    if not isinstance(v,str) or not BOOKMARK.fullmatch(v) or '--' in v:
        raise Halt('INVALID_TIME_TRAVEL_BOOKMARK')
    return v

def request(method,path,token,body=None):
    global CALLS
    CALLS+=1
    if CALLS>75 or time.monotonic()-START>300:raise Halt('REQUEST_OR_TIME_BUDGET_EXCEEDED')
    if not token or any(c in token for c in '\r\n'):raise Halt('TOKEN_MISSING')
    allowed={
      ('GET','/d1/database/'+TARGET),
      ('POST','/d1/database/'+TARGET+'/query'),
      ('GET','/d1/database/'+TARGET+'/time_travel/bookmark'),
      ('GET','/workers/scripts')
    }
    if re.fullmatch(r'/workers/scripts/[A-Za-z0-9_-]{1,128}/settings',path):
        allowed.add(('GET',path))
    is_history=path.startswith('/d1/database/'+TARGET+'/time_travel/bookmark?timestamp=')
    if is_history:
        tail=path.split('timestamp=',1)[-1]
        if urllib.parse.unquote(tail)!=EMPTY_WITNESSED_AT:
            raise Halt('HISTORICAL_TIMESTAMP_NOT_PINNED')
        allowed.add(('GET',path))
    is_restore=path.startswith('/d1/database/'+TARGET+'/time_travel/restore?bookmark=')
    if is_restore:
        mark=urllib.parse.unquote(path.split('bookmark=',1)[-1])
        valid_bookmark(mark)
        allowed.add(('POST',path))
    if (method,path) not in allowed:raise Halt('OTHER_RESOURCE_OR_METHOD_FORBIDDEN')
    if method=='POST' and path.endswith('/query'):
        if not isinstance(body,dict) or body.get('params')!=[]:
            raise Halt('SQL_BODY_DENIED')
        sql=body.get('sql')
        if sql!=CATALOG and not (isinstance(sql,str) and
          re.fullmatch(r'SELECT COUNT\(\*\) AS n FROM "[A-Za-z0-9_]{1,128}"',sql)):
            raise Halt('UNREVIEWED_SQL_DENIED')
    elif is_restore:
        if body!=b'':raise Halt('RESTORE_BODY_DENIED')
    elif body is not None:
        raise Halt('GET_REQUEST_BODY_DENIED')
    url=ROOT+path
    headers={'Authorization':'Bearer '+token,'Accept':'application/json',
             'User-Agent':'MUSITU-AXIOM-OWNER-SCOPED-DR-TIMETRAVEL-20261109'}
    if isinstance(body,dict):
        data=canonical(body).encode('utf8')
        headers['Content-Type']='application/json'
    else:data=body
    req=urllib.request.Request(url,method=method,data=data,headers=headers)
    try:
        with opener.open(req,timeout=23) as response:
            code=response.status
            raw=response.read(750001)
    except urllib.error.HTTPError as err:
        raise Halt('CLOUDFLARE_HTTP_'+str(err.code)) from None
    except (OSError,TimeoutError,ValueError):
        raise Halt('PROVIDER_UNKNOWN_NO_RESTORE_RETRY') from None
    if code!=200 or len(raw)>750000:raise Halt('RESPONSE_INVALID')
    try:doc=json.loads(raw)
    except (ValueError,UnicodeError):raise Halt('PROVIDER_JSON_INVALID') from None
    if not isinstance(doc,dict) or doc.get('success') is not True:
        raise Halt('PROVIDER_RETURNED_UNSUCCESSFUL')
    return doc.get('result')

def read_query(token,sql):
    result=request('POST','/d1/database/'+TARGET+'/query',token,{'sql':sql,'params':[]})
    if not isinstance(result,list) or len(result)!=1 or not isinstance(result[0],dict):
        raise Halt('SQL_RESULT_SHAPE_INVALID')
    item=result[0];meta=item.get('meta')
    if not (item.get('success') is True and isinstance(meta,dict) and
        meta.get('changed_db') is False and meta.get('changes')==0 and meta.get('rows_written')==0):
        raise Halt('QUERY_READ_ONLY_NOT_CONFIRMED')
    rows=item.get('results')
    if not isinstance(rows,list):raise Halt('SQL_RESULT_NOT_ARRAY')
    return rows

def catalog_status(token,include_counts):
    rows=read_query(token,CATALOG)
    if len(rows)>100 or any(not isinstance(x,dict) or set(x)!={'type','name','tbl_name','sql'} for x in rows):
        raise Halt('CATALOG_UNQUALIFIED')
    user=[x for x in rows if x['name'] not in APP_RESERVED]
    system=[x for x in rows if x['name'] in APP_RESERVED]
    if any(x['type']!='table' or x['name'] not in APP_RESERVED for x in system):
        raise Halt('RESERVED_SYSTEM_SCHEMA_MISMATCH')
    tables=[x['name'] for x in user if x['type']=='table']
    out={'app_schema_object_count':len(user),'app_tables':len(tables),
         'schema_sha256':sha(json.dumps(user,sort_keys=True)),
         'app_empty':len(user)==0,
         'internal_objects':len(system)}
    if include_counts:
        if len(tables)>30 or any(not IDENTIFIER.fullmatch(t) for t in tables):
            raise Halt('TABLE_IDENTIFIER_NOT_ALLOWLISTED')
        total=0
        for name in sorted(tables):
            count=read_query(token,'SELECT COUNT(*) AS n FROM "'+name+'"')
            if len(count)!=1 or type(count[0].get('n')) is not int or count[0]['n']<0:
                raise Halt('AGGREGATE_RESULT_INVALID')
            total+=count[0]['n']
        out['aggregate_rows']=total
    return out

def check_unbound(token):
    items=request('GET','/workers/scripts',token)
    if not isinstance(items,list) or len(items)>30 or any(
        not isinstance(x,dict) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',str(x.get('id','')))
        for x in items):
        raise Halt('WORKER_CATALOG_UNQUALIFIED')
    hits=0
    for item in items:
        obj=request('GET','/workers/scripts/'+item['id']+'/settings',token)
        if not isinstance(obj,dict) or not isinstance(obj.get('bindings'),list):
            raise Halt('WORKER_BINDINGS_UNQUALIFIED')
        for b in obj['bindings']:
            if isinstance(b,dict) and (b.get('id')==TARGET or b.get('database_id')==TARGET):
                hits+=1
    if hits:raise Halt('DISPOSABLE_TARGET_HAS_ACTIVE_WORKER_BINDING')
    return {'all_workers_checked':len(items),'target_bindings':0}

def bookmark(token,history=False):
    path='/d1/database/'+TARGET+'/time_travel/bookmark'
    if history:path+='?timestamp='+urllib.parse.quote(EMPTY_WITNESSED_AT,safe='')
    result=request('GET',path,token)
    if not isinstance(result,dict):raise Halt('BOOKMARK_NOT_OBJECT')
    return valid_bookmark(result.get('bookmark'))

def restore_once(token,history_bookmark):
    path='/d1/database/'+TARGET+'/time_travel/restore?bookmark='+urllib.parse.quote(valid_bookmark(history_bookmark),safe='')
    result=request('POST',path,token,b'')
    if not isinstance(result,dict):raise Halt('RESTORE_RESPONSE_SHAPE_INVALID')
    valid_bookmark(result.get('bookmark'))
    valid_bookmark(result.get('previous_bookmark'))
    return {'acknowledged':True,'new_bookmark_sha256':sha(result['bookmark']),
            'previous_bookmark_sha256':sha(result['previous_bookmark'])}

def run():
    reader=os.environ.get('CLOUDFLARE_AXIOM_DR_READ_TOKEN','')
    writer=os.environ.get('MUSITU_CLOUDFLARE_ADMIN_TOKEN','')
    report={'schema':'AXIOM_ISOLATED_D1_HISTORICAL_EMPTY_STATE_TARGET_ONLY_RESTORE_20261109',
        'target_database_id':TARGET,'account_id':ACCOUNT,
        'historical_empty_state_at':EMPTY_WITNESSED_AT,'historical_empty_evidence_run':EMPTY_WITNESS_RUN,
        'restore_attempts':0,'source_oauth_writes':0,'customer_rows_read':0,
        'target_only':True,'full_disaster_restore_qualified':False,
        'production_oauth_migration_qualified':False,'release_qualified':False,
        'status':'STOPPED_NO_RESTORE'}
    try:
        if not reader or not writer or reader==writer or any(c in reader+writer for c in '\n\r'):
            raise Halt('SCOPED_DISTINCT_SECRETS_REQUIRED')
        obj=request('GET','/d1/database/'+TARGET,reader)
        if not isinstance(obj,dict) or obj.get('uuid')!=TARGET or obj.get('name')!=TARGET_NAME:
            raise Halt('EXACT_TARGET_IDENTITY_CHANGED')
        report.update(check_unbound(reader))
        before=catalog_status(reader,True)
        if (before['app_tables']!=EXPECTED_TABLES or before['app_schema_object_count']!=32 or
          before['aggregate_rows']!=EXPECTED_ROWS or before['schema_sha256']!=EXACT_APP_SCHEMA_SHA):
            raise Halt('PINNED_TARGET_SCHEMA_OR_ROW_COUNT_CHANGED')
        report['pre_restore_user_tables']=before['app_tables']
        report['pre_restore_total_rows']=before['aggregate_rows']
        report['pre_restore_schema_sha256']=before['schema_sha256']
        old=bookmark(reader,True)
        current=bookmark(reader,False)
        if old>=current or old==current:raise Halt('HISTORIC_BOOKMARK_NOT_BEFORE_CURRENT')
        report['historic_empty_bookmark_sha256']=sha(old)
        report['current_bookmark_sha256']=sha(current)
        report['pre_restore_timestamp_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        # One destructive operation against the pinned disposable database only;
        # NO automatic retry on timeout, unknown response, or failed validation.
        report['restore_attempts']=1
        report['phase']='ONE_PROVIDER_TARGET_ONLY_TIME_TRAVEL_RESTORE_SENT'
        result=restore_once(writer,old)
        report.update(result)
        report['phase']='POST_RESTORE_READ_ONLY_STABILITY'
        checks=[]
        for delay in (0,45,120):
            if delay:time.sleep(delay)
            check=catalog_status(reader,False)
            checks.append({'elapsed_hold_seconds':delay,
              'application_schema_objects':check['app_schema_object_count'],
              'app_empty':check['app_empty']})
        report['stability_checks']=checks
        if not all(x['app_empty'] for x in checks):
            raise Halt('TARGET_ROLLBACK_NOT_STABLE_ACROSS_CHECKS')
        report['target_only_time_travel_qualified']=True
        report['status']='TARGET_ONLY_HISTORICAL_EMPTY_ROLLBACK_STABILITY_PASS_NO_RELEASE'
    except Halt as e:
        report['reason_code']=str(e)
        report['status']='UNQUALIFIED_OR_UNSTABLE_NO_RETRY'
    except Exception as e:
        report['reason_type']=type(e).__name__
        report['status']='UNKNOWN_NO_RETRY'
    report['provider_requests']=CALLS
    data=(canonical(report)+'\n').encode()
    p=Path('axiom-isolated-dr-historical-rollback-20261109.json')
    p.write_bytes(data)
    p.with_name(p.name+'.sha256').write_text(sha(data)+'  '+p.name+'\n')
    print('TARGET_ONLY_HISTORY_RESTORE='+report['status']+' ATTEMPTS='+str(report['restore_attempts']))
    return 0 if report['status']=='TARGET_ONLY_HISTORICAL_EMPTY_ROLLBACK_STABILITY_PASS_NO_RELEASE' else 2

if __name__=='__main__':sys.exit(run())
