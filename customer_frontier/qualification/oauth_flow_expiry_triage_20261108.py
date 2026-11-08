"""Read-only aggregate classification of already-observed missing OAuth client references."""
import os,json,sys,urllib.request,urllib.error
from pathlib import Path
import oauth_identity_links_20261108 as baseline

DB=baseline.DATABASE
ACCOUNT=baseline.ACCOUNT
SQL="""WITH unmatched AS (
 SELECT f.client_id, f.expires_at, f.used_at FROM oauth_authorization_flows f
 WHERE NOT EXISTS(SELECT 1 FROM oauth_clients c WHERE c.client_id=f.client_id)
) SELECT COUNT(*) AS total,
 COUNT(CASE WHEN julianday(expires_at) < julianday('now') THEN 1 END) AS expired,
 COUNT(CASE WHEN julianday(expires_at) >= julianday('now') THEN 1 END) AS unexpired,
 COUNT(CASE WHEN julianday(expires_at) IS NULL THEN 1 END) AS invalid_expiry,
 COUNT(CASE WHEN used_at IS NOT NULL THEN 1 END) AS used,
 COUNT(DISTINCT client_id) AS distinct_unknown_clients
 FROM unmatched"""
FIELDS=('total','expired','unexpired','invalid_expiry','used','distinct_unknown_clients')
class Rejected(ValueError):pass

def classify(original,counts):
    if original.get('status')!='STRUCTURAL_LINK_INCONSISTENCY_OBSERVED' or original.get('catalog_sha256')!=baseline.CATALOG_SHA or original.get('provider_zero_write_queries')!=2:
        raise Rejected('PRIOR_READONLY_BASELINE_NOT_QUALIFIED')
    refs=original.get('aggregate_counters')
    if not isinstance(refs,dict) or set(refs)!=set(baseline.FIELDS) or refs.get('orphan_flow_clients')!=3 or any(v!=0 for k,v in refs.items() if k!='orphan_flow_clients'):
        raise Rejected('UNREGISTERED_FLOW_REFERENCE_COUNTER_DRIFT')
    if not isinstance(counts,dict) or set(counts)!=set(FIELDS) or any(type(counts[k]) is not int or counts[k]<0 for k in FIELDS):
        raise Rejected('TIMING_COUNTER_ENVELOPE_INVALID')
    if counts['total']!=3 or counts['expired']+counts['unexpired']+counts['invalid_expiry']!=counts['total'] or counts['used']>3 or counts['distinct_unknown_clients']>3:
        raise Rejected('TIMING_COUNTER_SUM_INCONSISTENT')
    if counts['invalid_expiry']>0:state='UNREGISTERED_FLOW_INVALID_EXPIRY_PRESENT'
    elif counts['unexpired']>0:state='UNREGISTERED_FLOW_NOT_YET_EXPIRED_PRESENT'
    else:state='THREE_UNREGISTERED_FLOWS_EXPIRED_NOT_USER_OWNERSHIP'
    return {'schema':'musitu.axiom.oauth_unregistered_flows_expiry_triage.v1','status':state,
        'database_id':DB,'catalog_sha256':baseline.CATALOG_SHA,'unregistered_flow_counts':counts,
        'provider_read_only_queries':3,'private_flow_ids_read':False,'redirect_uris_read':False,
        'authorization_codes_read':False,'customer_rows_read':False,'real_identity_qualified':False,
        'oauth_migration_qualified':False,'delete_or_repair_performed':False,'release_authority':False}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kw):return None

def timing_query(token):
    req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+DB+'/query',
       data=json.dumps({'sql':SQL,'params':[]},separators=(',',':')).encode('utf8'),method='POST',
       headers={'Authorization':'Bearer '+token,'Accept':'application/json','Content-Type':'application/json','User-Agent':'MUSITU-AXIOM-OAuth-FlowExpiryReadOnly/1.0'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=20) as r:
            status=r.status;raw=r.read(2000001)
    except (urllib.error.URLError,OSError,TimeoutError):raise Rejected('PROVIDER_TIMING_QUERY_UNAVAILABLE') from None
    if status!=200 or len(raw)>2000000:raise Rejected('PROVIDER_TIMING_STATUS_UNQUALIFIED')
    try:data=json.loads(raw)
    except Exception:raise Rejected('PROVIDER_TIMING_JSON_INVALID') from None
    if not isinstance(data,dict) or data.get('success') is not True:raise Rejected('PROVIDER_TIMING_REJECTED')
    xs=data.get('result')
    if not isinstance(xs,list) or len(xs)!=1 or xs[0].get('success') is not True:raise Rejected('PROVIDER_TIMING_ENVELOPE_INVALID')
    meta=xs[0].get('meta')
    if not isinstance(meta,dict) or meta.get('changed_db') is not False or meta.get('changes')!=0 or meta.get('rows_written')!=0:
        raise Rejected('PROVIDER_TIMING_ZERO_WRITES_NOT_CONFIRMED')
    rows=xs[0].get('results')
    if not isinstance(rows,list) or len(rows)!=1:raise Rejected('PROVIDER_TIMING_ROWS_INVALID')
    return rows[0]

def main():
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    try:
        if not token or '\n' in token or '\r' in token:raise Rejected('PROVIDER_TOKEN_UNAVAILABLE')
        original=baseline.observe(baseline._provider_fetcher(token))
        result=classify(original,timing_query(token))
        status=0 if result['status']=='THREE_UNREGISTERED_FLOWS_EXPIRED_NOT_USER_OWNERSHIP' else 1
    except (Rejected,baseline.Rejected) as e:
        result={'schema':'musitu.axiom.oauth_unregistered_flows_expiry_triage.v1','status':'UNQUALIFIED',
           'reason_code':str(e),'database_id':DB,'delete_or_repair_performed':False,'real_identity_qualified':False,'release_authority':False}
        status=1
    except Exception:
        result={'schema':'musitu.axiom.oauth_unregistered_flows_expiry_triage.v1','status':'UNQUALIFIED',
           'reason_code':'UNKNOWN_OR_PROVIDER_ERROR','database_id':DB,'delete_or_repair_performed':False,'real_identity_qualified':False,'release_authority':False}
        status=1
    Path('axiom-oauth-unregistered-flow-expiry-triage-20261108.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
    print(json.dumps(result,sort_keys=True))
    return status

if __name__=='__main__':sys.exit(main())
