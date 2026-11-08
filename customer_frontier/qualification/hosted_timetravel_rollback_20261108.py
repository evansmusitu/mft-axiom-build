"""Owner-isolated D1 synthetic Time Travel recovery, never source/prod D1 writes.

An independently SHA-pinned restored target is already confirmed. This script:
(1) independently rereads source+target full data equality,
(2) reads exact target Time Travel bookmark,
(3) creates one disposable synthetic probe table+row in target only,
(4) issues exactly ONE destructive point-in-time restore to pre-probe bookmark,
(5) verifies probe gone and independently rereads full source-vs-target parity.
No real customer row UPDATE/DELETE and no double restore or retry on uncertainty.
"""
import hashlib,json,os,re,sys,time,urllib.error,urllib.parse,urllib.request
from pathlib import Path
import independent_d1_restore_observer_20261108 as observer

ACCOUNT='c954f0c842a486d0388c05b19cd21e47'
TARGET='e36972b3-850d-4273-b934-2fa67587d9f1'
PROBE='axiom_dr_ttravel_probe_20261108'
CREATE='CREATE TABLE '+PROBE+' (id INTEGER PRIMARY KEY, val TEXT NOT NULL)'
INSERT='INSERT INTO '+PROBE+" (id,val) VALUES(1,'temporary_recovery_synthetic')"
CHECK="SELECT count(*) AS n FROM "+PROBE
EXISTS="SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='"+PROBE+"'"
BMARK=re.compile(r'[0-9a-f-]{20,110}\Z',re.ASCII)
START=time.monotonic()
CONTROLS=0
class Rejected(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect())
def canonical(d):return json.dumps(d,sort_keys=True,separators=(',',':'),ensure_ascii=True)
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
def check_bookmark(value):
    if not isinstance(value,str) or not BMARK.fullmatch(value) or '--' in value:
        raise Rejected('BOOKMARK_INVALID')
    return value

def ctrl(kind,body=None,bookmark=None):
    global CONTROLS
    if time.monotonic()-START>280 or CONTROLS>=12:raise Rejected('DEADLINE_OR_CONTROL_BUDGET')
    CONTROLS+=1
    token=os.environ.get('AXIOM_CUSTOMER_STAGING_CF_API_TOKEN','')
    if not token or '\r' in token or '\n' in token:raise Rejected('TARGET_TOKEN_MISSING')
    base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+TARGET
    if kind=='bookmark':
        method='GET';url=base+'/time_travel/bookmark';rawbody=None
        if body is not None or bookmark is not None:raise Rejected('INVALID_BOOKMARK_REQUEST')
    elif kind=='restore':
        method='POST';url=base+'/time_travel/restore?bookmark='+urllib.parse.quote(check_bookmark(bookmark),safe='');rawbody=b''
        if body is not None:raise Rejected('INVALID_RESTORE_REQUEST')
    elif kind=='query':
        method='POST';url=base+'/query'
        if body not in (CREATE,INSERT,CHECK,EXISTS):raise Rejected('SYNTHETIC_SQL_NOT_ADMITTED')
        rawbody=canonical({'sql':body,'params':[]}).encode()
    else:raise Rejected('CONTROL_KIND_NOT_ADMITTED')
    headers={'Authorization':'Bearer '+token,'Accept':'application/json','User-Agent':'MUSITU-AXIOM-ScopedD1-TimeTravel-20261108'}
    if kind=='query':headers['Content-Type']='application/json'
    req=urllib.request.Request(url,method=method,headers=headers,data=rawbody)
    try:
        with opener.open(req,timeout=30) as resp:
            status=resp.status;payload=resp.read(100000)
    except (urllib.error.URLError,OSError,TimeoutError):
        raise Rejected('PROVIDER_UNKNOWN_NO_RETRY') from None
    if status!=200 or len(payload)>100000:raise Rejected('PROVIDER_STATUS_UNQUALIFIED')
    try:data=json.loads(payload)
    except ValueError:raise Rejected('PROVIDER_JSON_UNQUALIFIED') from None
    if not isinstance(data,dict) or data.get('success') is not True:raise Rejected('PROVIDER_REJECTED')
    if kind in ('bookmark','restore'):
        result=data.get('result')
        if not isinstance(result,dict):raise Rejected('TIME_TRAVEL_RESULT_INVALID')
        return result
    arr=data.get('result')
    if not isinstance(arr,list) or len(arr)!=1 or not isinstance(arr[0],dict) or arr[0].get('success') is not True:
        raise Rejected('QUERY_RESULT_INVALID')
    return arr[0]

def observed_probe_count():
    rows=ctrl('query',EXISTS)
    meta=rows.get('meta')
    if not isinstance(meta,dict) or meta.get('changed_db') is not False or meta.get('changes')!=0 or meta.get('rows_written')!=0:
        raise Rejected('READ_ONLY_PROBE_STATUS_UNCONFIRMED')
    results=rows.get('results')
    if not isinstance(results,list) or len(results)!=1 or type(results[0].get('n')) is not int:
        raise Rejected('PROBE_RESULT_MALFORMED')
    return results[0]['n']

def verify_mutation_response(resp,kind):
    meta=resp.get('meta')
    if not isinstance(meta,dict) or meta.get('changed_db') is not True:
        raise Rejected('PROBE_MUTATION_NOT_CONFIRMED')
    if kind=='insert' and (meta.get('changes')!=1 or meta.get('rows_written')!=1):
        raise Rejected('PROBE_SINGLE_WRITE_NOT_CONFIRMED')
    return True

def verify_before_and_after():
    observer.nrequests=0
    observed=observer.compare()
    if observed['status']!='INDEPENDENT_HOSTED_SCHEMA_AND_DATA_PARITY_PASS' or observed['user_rows_equal']!=25:
        raise Rejected('RESTORED_USER_DATA_BASELINE_FAILED')
    return observed

def run():
    report={'schema':'musitu.axiom.synthetic_timetravel_hosted_rollback.v1',
        'status':'UNQUALIFIED','target_database_id':TARGET,'target_account_id':ACCOUNT,
        'source_database_id':observer.SOURCE,'step':'NOT_STARTED',
        'customer_row_values_logged':False,'user_rows_deleted_or_updated':False,
        'synthetic_probe_rows':1,'time_travel_restore_confirmed':False,
        'post_restore_customer_data_equal':False,'destructive_full_database_recovery_qualified':False,
        'production_oauth_changed':False,'independent_custody_qualified':False,'release_authority':False}
    code=1
    try:
        before=verify_before_and_after()
        if observed_probe_count()!=0:raise Rejected('PROBE_ALREADY_EXISTS_ABORT')
        report['step']='BASELINE_BOOKMARK_CONFIRMED'
        bookmark=check_bookmark(ctrl('bookmark').get('bookmark'))
        report['bookmark_sha256']=sha(bookmark)
        report['step']='SYNTHETIC_MUTATION_BEGIN'
        verify_mutation_response(ctrl('query',CREATE),'create')
        verify_mutation_response(ctrl('query',INSERT),'insert')
        if observed_probe_count()!=1:raise Rejected('PROBE_NOT_INSERTED')
        # This is a destructive in-place restore of the disposable target ONLY.
        # Never repeat the POST even on unknown outcome.
        report['step']='ONE_TIME_TRAVEL_RESTORE_REQUEST_SENT'
        result=ctrl('restore',bookmark=bookmark)
        check_bookmark(result.get('bookmark'))
        check_bookmark(result.get('previous_bookmark'))
        report['time_travel_restore_confirmed']=True
        # Require a fresh provider response and full independently recomputed parity.
        if observed_probe_count()!=0:raise Rejected('PROBE_PERSISTED_AFTER_RESTORE')
        after=verify_before_and_after()
        if after['data_sha256']!=before['data_sha256']:
            raise Rejected('PRE_POST_CUSTOMER_DATA_FINGERPRINT_MISMATCH')
        report.update({'status':'HOSTED_SYNTHETIC_TIME_TRAVEL_RESTORE_PASS',
            'step':'RESTORED_AND_VERIFIED','pre_post_user_data_sha256':after['data_sha256'],
            'post_restore_customer_data_equal':True,
            'schema_and_content_recovery_verified':True})
        code=0
    except (Rejected,observer.Reject) as e:
        report['reason_code']=str(e)
    except Exception:
        report['reason_code']='UNKNOWN_OR_PROVIDER_FAILURE_NO_RESTORE_RETRY'
    report['control_operations']=CONTROLS
    p=Path('axiom-hosted-timetravel-rollback-20261108.json')
    p.write_text(canonical(report)+'\n')
    print(canonical(report))
    return code
if __name__=='__main__':sys.exit(run())
