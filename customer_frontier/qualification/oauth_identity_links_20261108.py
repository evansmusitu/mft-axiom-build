"""Fixed-source, GET/SELECT-only, real OAuth structural link preflight.

No customer row values or private OAuth signing keys are returned or persisted.
No production writes, IdP login, onboarding, owner proof, hosted restore or release.
"""
from pathlib import Path
import hashlib
import json
import os
import time
import urllib.error
import urllib.request

ACCOUNT='93f395f5121954671f92fffa453d6b61'
DATABASE='504029cc-f9a5-495e-818f-63c6144b4ea4'
WORKER='musitu-axiom-oauth'
CATALOG_SHA='56c70460aecf66af4eab25d4c7e363efb0a76866f788bcd5ae70f52a0f3e7ee1'
CATALOG_SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
FIELDS=('orphan_identity_claims','unverified_identity_claims','orphan_oidc_code_nonces','orphan_oidc_flow_nonces','orphan_code_clients','orphan_flow_clients','orphan_access_clients','orphan_refresh_clients','invalid_redirect_uris_json','cross_tenant_usage_keys','orphan_checkout_customers','orphan_execution_customers')
LINKS_SQL="""SELECT
 (SELECT COUNT(*) FROM oauth_identity_claims i WHERE NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=i.customer_id)) AS orphan_identity_claims,
 (SELECT COUNT(*) FROM oauth_identity_claims WHERE email_verified_at IS NULL OR trim(email_verified_at)='') AS unverified_identity_claims,
 (SELECT COUNT(*) FROM oauth_oidc_code_nonces n WHERE NOT EXISTS(SELECT 1 FROM oauth_authorization_codes c WHERE c.code_hash=n.code_hash)) AS orphan_oidc_code_nonces,
 (SELECT COUNT(*) FROM oauth_oidc_flow_nonces n WHERE NOT EXISTS(SELECT 1 FROM oauth_authorization_flows f WHERE f.id=n.flow_id)) AS orphan_oidc_flow_nonces,
 (SELECT COUNT(*) FROM oauth_authorization_codes c WHERE NOT EXISTS(SELECT 1 FROM oauth_clients a WHERE a.client_id=c.client_id)) AS orphan_code_clients,
 (SELECT COUNT(*) FROM oauth_authorization_flows f WHERE NOT EXISTS(SELECT 1 FROM oauth_clients a WHERE a.client_id=f.client_id)) AS orphan_flow_clients,
 (SELECT COUNT(*) FROM oauth_access_tokens t WHERE NOT EXISTS(SELECT 1 FROM oauth_clients a WHERE a.client_id=t.client_id)) AS orphan_access_clients,
 (SELECT COUNT(*) FROM oauth_refresh_tokens t WHERE NOT EXISTS(SELECT 1 FROM oauth_clients a WHERE a.client_id=t.client_id)) AS orphan_refresh_clients,
 (SELECT COUNT(*) FROM oauth_clients c WHERE json_valid(c.redirect_uris_json)=0) AS invalid_redirect_uris_json,
 (SELECT COUNT(*) FROM usage_events e WHERE e.key_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api_keys k WHERE k.id=e.key_id AND k.customer_id=e.customer_id)) AS cross_tenant_usage_keys,
 (SELECT COUNT(*) FROM billing_checkout_intents b WHERE NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=b.customer_id)) AS orphan_checkout_customers,
 (SELECT COUNT(*) FROM axiom_execution_tasks t WHERE NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=t.customer_id)) AS orphan_execution_customers"""

class Rejected(ValueError):
    pass

def _digest(s):
    return hashlib.sha256(s.encode('utf8')).hexdigest()

def observe(fetch):
    """Pure verdict on four fixed response objects from strictly read-only provider boundary."""
    calls=0
    zero_write=0
    def req(kind):
        nonlocal calls,zero_write
        if kind not in ('binding','metadata','catalog','relationships') or calls>=4:
            raise Rejected('UNADMITTED_REQUEST')
        calls+=1
        result=fetch(kind)
        if kind in ('catalog','relationships'):
            if not isinstance(result,dict):raise Rejected('QUERY_RESULT_UNQUALIFIED')
            meta=result.get('meta')
            if not isinstance(meta,dict) or meta.get('changed_db') is not False or type(meta.get('changes')) is not int or meta['changes']!=0 or type(meta.get('rows_written')) is not int or meta['rows_written']!=0:
                raise Rejected('SELECT_ZERO_WRITE_NOT_CONFIRMED')
            zero_write+=1
            if not isinstance(result.get('results'),list):raise Rejected('QUERY_RESULTS_INVALID')
            return result['results']
        return result
    settings=req('binding')
    bindings=settings.get('bindings') if isinstance(settings,dict) else None
    matching=[b for b in bindings if isinstance(b,dict) and b.get('type')=='d1' and b.get('name')=='AXIOM_DB'] if isinstance(bindings,list) else []
    if len(matching)!=1 or matching[0].get('id')!=DATABASE:
        raise Rejected('OAUTH_D1_BINDING_DRIFT')
    metadata=req('metadata')
    if not isinstance(metadata,dict) or metadata.get('uuid')!=DATABASE or metadata.get('name')!='musitu-axiom-prod':
        raise Rejected('OAUTH_DATABASE_IDENTITY_DRIFT')
    catalog=req('catalog')
    if len(catalog)!=33 or any(not isinstance(r,dict) or set(r)!={'type','name','tbl_name','sql'} for r in catalog):
        raise Rejected('PRODUCTION_CATALOG_DRIFT')
    if _digest(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))) != CATALOG_SHA:
        raise Rejected('PRODUCTION_CATALOG_DRIFT')
    relationships=req('relationships')
    if len(relationships)!=1 or not isinstance(relationships[0],dict) or set(relationships[0])!=set(FIELDS):
        raise Rejected('RELATIONSHIP_COUNTERS_INVALID')
    counts=relationships[0]
    if any(type(counts[name]) is not int or counts[name]<0 or counts[name]>100000000 for name in FIELDS):
        raise Rejected('RELATIONSHIP_COUNTERS_INVALID')
    all_zero=all(v==0 for v in counts.values())
    return {'schema':'musitu.axiom.oauth_structural_links_readonly.v1',
            'status':'STRUCTURAL_LINK_COUNTERS_ZERO_NOT_REAL_IDENTITY' if all_zero else 'STRUCTURAL_LINK_INCONSISTENCY_OBSERVED',
            'database_id':DATABASE,'catalog_sha256':CATALOG_SHA,'catalog_objects':33,
            'aggregate_counters':counts,'provider_requests':calls,'provider_zero_write_queries':zero_write,
            'customer_row_contents_read':False,'signing_private_keys_read':False,
            'real_identity_qualified':False,'provider_account_ownership_verified':False,
            'production_oauth_migration_qualified':False,'billing_settlement_qualified':False,
            'release_authority':False}

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def _provider_fetcher(token):
    root='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT
    db='/d1/database/'+DATABASE
    endpoint={
        'binding':('GET',root+'/workers/scripts/'+WORKER+'/settings',None),
        'metadata':('GET',root+db,None),
        'catalog':('POST',root+db+'/query',{'sql':CATALOG_SQL,'params':[]}),
        'relationships':('POST',root+db+'/query',{'sql':LINKS_SQL,'params':[]}),
    }
    elapsed=time.monotonic()
    count=0
    opener=urllib.request.build_opener(_NoRedirect())
    def fetch(kind):
        nonlocal count
        if kind not in endpoint or count>=4 or time.monotonic()-elapsed>90:
            raise Rejected('TRANSPORT_BUDGET_EXHAUSTED')
        count+=1
        method,url,body=endpoint[kind]
        data=None if body is None else json.dumps(body,separators=(',',':')).encode('utf8')
        headers={'Accept':'application/json','Authorization':'Bearer '+token,'User-Agent':'MUSITU-AXIOM-FixedReadOnlyIdentityAudit-20261108'}
        if data is not None:headers['Content-Type']='application/json'
        req=urllib.request.Request(url,data=data,method=method,headers=headers)
        try:
            with opener.open(req,timeout=20) as response:
                status=response.status
                raw=response.read(2_000_001)
        except (urllib.error.URLError,OSError,TimeoutError):
            raise Rejected('PROVIDER_UNAVAILABLE') from None
        if status!=200 or len(raw)>2_000_000:
            raise Rejected('PROVIDER_STATUS_OR_BODY_UNQUALIFIED')
        try: payload=json.loads(raw)
        except (UnicodeError,ValueError):raise Rejected('PROVIDER_JSON_UNQUALIFIED') from None
        if not isinstance(payload,dict) or payload.get('success') is not True:
            raise Rejected('PROVIDER_REJECTED')
        result=payload.get('result')
        if kind in ('binding','metadata'):return result
        if not isinstance(result,list) or len(result)!=1 or not isinstance(result[0],dict) or result[0].get('success') is not True:
            raise Rejected('PROVIDER_QUERY_ENVELOPE_UNQUALIFIED')
        return {'meta':result[0].get('meta'),'results':result[0].get('results')}
    return fetch

def main():
    token=os.getenv('CLOUDFLARE_API_TOKEN','')
    try:
        if not token or '\n' in token or '\r' in token:raise Rejected('PROVIDER_CREDENTIAL_MISSING')
        outcome=observe(_provider_fetcher(token))
        if outcome['status']!='STRUCTURAL_LINK_COUNTERS_ZERO_NOT_REAL_IDENTITY':
            status=1
        else:status=0
    except Rejected as e:
        outcome={'schema':'musitu.axiom.oauth_structural_links_readonly.v1',
                 'status':'UNQUALIFIED','reason_code':str(e),'database_id':DATABASE,
                 'real_identity_qualified':False,'production_oauth_migration_qualified':False,'release_authority':False}
        status=1
    except Exception:
        outcome={'schema':'musitu.axiom.oauth_structural_links_readonly.v1',
                 'status':'UNQUALIFIED','reason_code':'UNKNOWN_PROVIDER_OR_VALIDATOR_ERROR','database_id':DATABASE,
                 'real_identity_qualified':False,'production_oauth_migration_qualified':False,'release_authority':False}
        status=1
    output=Path('axiom-oauth-structural-link-preflight-20261108.json')
    output.write_text(json.dumps(outcome,sort_keys=True,indent=2)+'\n')
    print(json.dumps(outcome,sort_keys=True))
    return status

if __name__=='__main__':raise SystemExit(main())
