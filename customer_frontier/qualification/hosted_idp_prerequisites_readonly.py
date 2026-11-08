"""MUSITU AXIOM identity: exact-source, GET-only hosted prerequisite check.

No D1 SQL/row access; no authentication token request; no access grants;
no Cloudflare mutations; no customer, provider, or OAuth session created.
"""
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
ZONE = '5b56528f03948ff5917a5e0cd9f7109e'
RULESET = '8e8a2552a8ee4bb383abbe0d748e1da5'
STAGE_HOST = 'axiom-customer-staging.mftintelligence.com'
STAGE_WORKER = 'musitu-axiom-customer-staging'
PREVIOUS_DB_ID = 'a7384b8a-0751-4705-ac77-0616b0885e7c'
PREVIOUS_DB_NAME = 'mft-axiom-claude-staging-20260927'
ISSUER = 'https://musitu-whatsapp-staging-mpqgsc.eu1.zitadel.cloud'
APP_CLIENT = '398295490183089708'
PR166_SHA = '483140a807a16d345f5ae08e000448948a136448'
CFROOT = 'https://api.cloudflare.com/client/v4'
CLOUD_PATHS = (
    f'/zones/{ZONE}',
    f'/zones/{ZONE}/settings/security_level',
    f'/zones/{ZONE}/rulesets/{RULESET}',
    f'/accounts/{ACCOUNT}/d1/database?per_page=100&page=1',
    f'/accounts/{ACCOUNT}/d1/database/{PREVIOUS_DB_ID}',
    f'/accounts/{ACCOUNT}/workers/scripts',
    f'/accounts/{ACCOUNT}/workers/scripts/{STAGE_WORKER}/settings',
    f'/accounts/{ACCOUNT}/workers/domains',
)
EXTERNAL_URLS = (
    ISSUER+'/.well-known/openid-configuration',
    ISSUER+'/oauth/v2/keys',
    'https://'+STAGE_HOST+'/_health',
    'https://'+STAGE_HOST+'/auth/start',
    'https://'+STAGE_HOST+'/v1/customer/me',
)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class Refuse(Exception):
    pass

def get_json(url, token):
    if token:
        if not url.startswith(CFROOT) or url[len(CFROOT):] not in CLOUD_PATHS:
            raise Refuse('CLOUDFLARE_PATH_NOT_ALLOWLISTED')
        headers = {'Authorization':'Bearer '+token,'Accept':'application/json'}
    else:
        if url not in EXTERNAL_URLS:
            raise Refuse('EXTERNAL_URL_NOT_ALLOWLISTED')
        headers = {'Accept':'application/json','User-Agent':'MUSITU-AXIOM-PRIVATE-STAGING-READONLY/20261109'}
    req=urllib.request.Request(url, method='GET', headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=15) as result:
            code=result.status
            cookie=bool(result.headers.get('set-cookie'))
            raw=result.read(250001)
    except urllib.error.HTTPError as err:
        code=err.code
        cookie=bool(err.headers.get('set-cookie'))
        raw=err.read(250001)
    except (OSError,TimeoutError,ValueError):
        return {'http':'NETWORK_ERROR','cookie':False,'valid':False},None
    if len(raw)>250000:
        return {'http':code,'cookie':cookie,'valid':False},None
    try:
        body=json.loads(raw)
    except (ValueError,UnicodeError):
        body=None
    if token:
        good=isinstance(body,dict) and body.get('success') is True and code==200
        meta={'http':code,'cookie':cookie,'valid':good}
        if good and url==CFROOT+CLOUD_PATHS[3]:
            meta['result_info']=body.get('result_info')
        return meta,body.get('result') if good else None
    return {'http':code,'cookie':cookie,'valid':isinstance(body,dict)},body

def safe_d1_inventory(status,data):
    out={'metadata_read':status.get('valid') is True,'list_complete':False,'total_count':None,
         'previous_database_found':False,'candidate_label_matches':0,
         'existing_named_stage_database_not_disposable_proven':False}
    if not out['metadata_read'] or not isinstance(data,dict):
        return out
    # D1 list provider result is an array, which must be passed separately
    return out

def summarize(results):
    """Pure, fail-closed observation summary; no acceptance flag is inferred."""
    state={'schema':'AXIOM_IDP_HOSTED_PREREQUISITES_READONLY_V1',
           'reviewed_idp_source_sha':PR166_SHA,
           'provider_methods':['GET'],
           'cloudflare_mutations':0,'d1_sql_queries':0,'customer_rows_read':0,
           'customer_sessions_created':0,'oauth_production_touched':False,
           'customer_identity_live_qualified':False,
           'customer_ownership_qualified':False,'hosted_migration_qualified':False,
           'release_qualified':False}
    data,metas=results
    state['http_statuses']={k:metas[k].get('http') for k in sorted(metas)}
    zone=data.get('zone')
    settings=data.get('zone_security')
    rules=data.get('config_rules')
    dbs=data.get('d1_list')
    dbinfo=data.get('previous_d1')
    workers=data.get('workers')
    stage_settings=data.get('stage_settings')
    domains=data.get('domains')
    disc=data.get('oidc_discovery')
    jwks=data.get('oidc_jwks')
    health=data.get('stage_health')
    state['zone_correct']=bool(isinstance(zone,dict) and zone.get('name')=='mftintelligence.com' and
                                zone.get('status')=='active' and (zone.get('account') or {}).get('id')==ACCOUNT)
    state['global_under_attack']=bool(isinstance(settings,dict) and settings.get('value')=='under_attack')
    state['config_rules_v26']=bool(isinstance(rules,dict) and rules.get('id')==RULESET and
                                    rules.get('version')=='26' and len(rules.get('rules',[]))==10)
    previous=bool(isinstance(dbinfo,dict) and dbinfo.get('uuid')==PREVIOUS_DB_ID and
                  dbinfo.get('name')==PREVIOUS_DB_NAME)
    state['previous_d1_selected_metadata_verified']=previous
    table_count=dbinfo.get('num_tables') if previous else None
    state['previous_d1_table_count']=table_count if type(table_count) is int else None
    state['previous_d1_is_empty_proven']=previous and type(table_count) is int and table_count==0
    info=(data.get('d1_info') or {})
    valid_rows=isinstance(dbs,list) and all(isinstance(x,dict) and
              isinstance(x.get('uuid'),str) and isinstance(x.get('name'),str) for x in dbs)
    count=info.get('count') if isinstance(info,dict) else None
    total=info.get('total_count') if isinstance(info,dict) else None
    page=info.get('page') if isinstance(info,dict) else None
    state['d1_list_complete']=bool(valid_rows and type(count) is int and count==len(dbs) and
       type(total) is int and total==len(dbs) and type(page) is int and page==1)
    state['d1_returned_count']=len(dbs) if valid_rows else None
    state['preexisting_db_in_list']=bool(valid_rows and any(x.get('uuid')==PREVIOUS_DB_ID and
                  x.get('name')==PREVIOUS_DB_NAME for x in dbs))
    safe_labels=('disposable','restore','throwaway','sandbox')
    state['possible_disposable_d1_names_count']=sum(any(label in x['name'].lower() for label in safe_labels)
         for x in dbs) if valid_rows else None
    valid_workers=isinstance(workers,list) and all(isinstance(x,dict) and isinstance(x.get('id'),str)
         for x in workers)
    state['stage_worker_exists']=bool(valid_workers and any(x['id']==STAGE_WORKER for x in workers))
    state['possible_idp_workers_count']=sum(any(word in x['id'].lower() for word in ('idp','identity','zitadel'))
         for x in workers) if valid_workers else None
    bindings=stage_settings.get('bindings') if isinstance(stage_settings,dict) else None
    state['staging_worker_bindings_read']=isinstance(bindings,list)
    state['staging_worker_bindings_count']=len(bindings) if isinstance(bindings,list) else None
    state['stage_worker_still_host_only']=state['stage_worker_exists'] and bindings==[]
    state['stage_custom_domain_owned']=bool(isinstance(domains,list) and
       sum(1 for x in domains if isinstance(x,dict) and x.get('hostname')==STAGE_HOST and
           x.get('service')==STAGE_WORKER and x.get('enabled') is True)==1)
    state['idp_discovery_pinned']=bool(isinstance(disc,dict) and disc.get('issuer')==ISSUER and
          disc.get('authorization_endpoint')==ISSUER+'/oauth/v2/authorize' and
          disc.get('token_endpoint')==ISSUER+'/oauth/v2/token' and
          disc.get('jwks_uri')==ISSUER+'/oauth/v2/keys' and
          'S256' in disc.get('code_challenge_methods_supported',[]) and
          'RS256' in disc.get('id_token_signing_alg_values_supported',[]))
    keys=jwks.get('keys') if isinstance(jwks,dict) else None
    state['public_signing_keys_present']=bool(isinstance(keys,list) and any(isinstance(k,dict) and
          k.get('kty')=='RSA' and isinstance(k.get('kid'),str) and k.get('n') and k.get('e') for k in keys))
    state['public_jwks_key_count']=len(keys) if isinstance(keys,list) else None
    state['host_health_200_closed']=bool(metas.get('stage_health',{}).get('http')==200 and
          not metas.get('stage_health',{}).get('cookie') and isinstance(health,dict) and
          health.get('ok') is True and health.get('stage')=='host_route_only' and
          all(health.get(flag) is False for flag in (
             'identity_live_qualified','customer_ownership_qualified','oauth_upgrade_qualified','release_qualified')))
    state['host_auth_fail_closed_503']=bool(
          metas.get('stage_auth',{}).get('http')==503 and not metas.get('stage_auth',{}).get('cookie') and
          metas.get('stage_customer',{}).get('http')==503 and not metas.get('stage_customer',{}).get('cookie'))
    state['status']='HOSTED_METADATA_OBSERVED_IDENTITY_NO_GO' if all((
         state['zone_correct'],state['global_under_attack'],state['config_rules_v26'],
         state['stage_worker_exists'],state['stage_worker_still_host_only'],state['stage_custom_domain_owned'],
         state['idp_discovery_pinned'],state['public_signing_keys_present'],state['host_health_200_closed'],
         state['host_auth_fail_closed_503'],state['previous_d1_selected_metadata_verified'],
         state['d1_list_complete'])) else 'INCOMPLETE_READONLY_NO_GO'
    return state

def run(fetch=get_json):
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if not token or '\n' in token or '\r' in token:
        raise Refuse('SCOPED_READ_TOKEN_MISSING')
    requests=(
      ('zone',CFROOT+CLOUD_PATHS[0],token),
      ('zone_security',CFROOT+CLOUD_PATHS[1],token),
      ('config_rules',CFROOT+CLOUD_PATHS[2],token),
      ('d1_list',CFROOT+CLOUD_PATHS[3],token),
      ('previous_d1',CFROOT+CLOUD_PATHS[4],token),
      ('workers',CFROOT+CLOUD_PATHS[5],token),
      ('stage_settings',CFROOT+CLOUD_PATHS[6],token),
      ('domains',CFROOT+CLOUD_PATHS[7],token),
      ('oidc_discovery',EXTERNAL_URLS[0],None),
      ('oidc_jwks',EXTERNAL_URLS[1],None),
      ('stage_health',EXTERNAL_URLS[2],None),
      ('stage_auth',EXTERNAL_URLS[3],None),
      ('stage_customer',EXTERNAL_URLS[4],None),
    )
    data,meta={},{}
    for name,url,auth in requests:
        meta[name],data[name]=fetch(url,auth)
    # Envelopes for Cloudflare D1 list are arrays; transport metadata must carry
    # response pagination from a separate GET-only read, not fabricate it.
    # We cannot derive provider result_info from the array itself. Record an
    # explicit unknown unless the fetcher includes it in the trusted metadata.
    data['d1_info']=meta.get('d1_list',{}).get('result_info')
    state=summarize((data,meta))
    blob=(json.dumps(state,sort_keys=True,indent=2)+'\n').encode()
    p=Path('axiom-identity-staging-hosted-readonly.json')
    p.write_bytes(blob)
    p.with_name(p.name+'.sha256').write_text(hashlib.sha256(blob).hexdigest()+'  '+p.name+'\n')
    print('AXIOM_IDP_STAGING_METADATA='+state['status']+' CLOUD_WRITES=0 SQL=0')
    return 0 if state['status']=='HOSTED_METADATA_OBSERVED_IDENTITY_NO_GO' else 2

if __name__=='__main__':
    raise SystemExit(run())
