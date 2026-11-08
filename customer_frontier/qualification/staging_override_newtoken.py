"""Owner-authorized one-use exact-host Cloudflare config-rules reconciliation.

One atomic full-ruleset PUT after read-only version, rule-order, quota, owner,
rollback and API dry-run admission. A later failure never triggers blind retries.
Does NOT bind identity, create a customer, or touch production OAuth.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import time
import urllib.error
import urllib.request

ACCOUNT='93f395f5121954671f92fffa453d6b61'
ZONE='5b56528f03948ff5917a5e0cd9f7109e'
RULESET='8e8a2552a8ee4bb383abbe0d748e1da5'
HOST='axiom-customer-staging.mftintelligence.com'
WORKER='musitu-axiom-customer-staging'
RULEPATH=f'/zones/{ZONE}/rulesets/{RULESET}'
EXPR=f'(http.host eq "{HOST}")'
REF='axiom_customer_stage_uam_override_20261108'
OLD_IDS=('15ad7cfa5d20422cb585fee04ea2d574','57f8a7896c0246a0a16b7a4fa018cf13')
OLD_EXPR_HASHES=('c4914e41508638978e5d2b9b7d8e710f8538b978f7f55ca5c0d0f7bf02611ab2','fd5ef396c99db35b11ec73c56b916ad1ad18cea8fd5d9dabc9c66e6a8a182893')
REST_IDS=('954764cb51104a808c3d0da6f8695d9a','c792da7cea7e4584b13296ecd7f38f87','fa9bb46869114c7fb86add03f5151cf2','bc8c60317d884ceaacecaeb3e94e10c2','5c35f41905bb43d8bb129c2c19e937d5','cd80cef2c43d4d708161941ff3214c50','6192219484aa4825a75d879a693ce77f','f1c7293d94a34d1098e39b28bd245433')
REST_HASHES=('04fe965c7719795c515f660ec748c843b6210b36d3c4d22fdd6aaca094a24b85','1f04cc3da05b9c34622990742002cb977e8562fafb4a3230f80c45be56d10e2c','41f262178e8d2c4c6c97b401933009344f016f1d285a806fb6e20eef92797421','41460014582169e85f016b6d821cf36ad54dbb85d177785d1f39de6c508e3d20','f7b6d9927002f25f841eecab8ca53dad4146119a1429bfe219a5fc474ad37176','f28eb2b0623bdc532dec61a4f7945245d1cf1fd77172e39f88ca5f865795a780','64c1d310a95e29e2c4803a5959f81eb1745a8a8a9cfc2ba7dcfb9cf14d41a84d','488ce28f51a7bc8585b3bee9f9f81943cf9030facc67e39a2c4aa3970e340d53')
FULL_IDS=(OLD_IDS[0],OLD_IDS[1],*REST_IDS)
FULL_HASHES=(*OLD_EXPR_HASHES,*REST_HASHES)
ALLOWED_RULE_FIELDS={'id','version','last_updated','action','expression','action_parameters','enabled','description','ref'}

class Stop(Exception):pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class Client:
    def __init__(self, read_token, config_token):
        if (not read_token or not config_token or read_token == config_token
            or any(c in t for t in (read_token,config_token) for c in '\n\r')):
            raise Stop('SCOPED_SECRETS_MISSING_OR_NOT_DISTINCT')
        self.read_token=read_token
        self.config_token=config_token
        self.attempted=[]
    def req(self,method,path,body=None):
        reads={'/user/tokens/verify',RULEPATH,RULEPATH+'/versions/25',f'/zones/{ZONE}',f'/zones/{ZONE}/settings/security_level',f'/accounts/{ACCOUNT}/workers/domains',f'/accounts/{ACCOUNT}/workers/scripts/{WORKER}/settings'}
        if method=='GET' and path not in reads:raise Stop('UNREVIEWED_GET')
        if method=='PUT' and path not in (RULEPATH+'?dry_run=true',RULEPATH):raise Stop('UNREVIEWED_WRITE')
        if method not in ('GET','PUT'):raise Stop('UNREVIEWED_METHOD')
        if method=='PUT':self.attempted.append('DRY_RUN' if path.endswith('dry_run=true') else 'ONE_LIVE_PUT')
        token=self.config_token if method=='PUT' or path=='/user/tokens/verify' else self.read_token
        headers={'authorization':'Bearer '+token,'accept':'application/json','user-agent':'MUSITU-AXIOM-EXACT-STAGING-CONFIG-20261108'}
        payload=None
        if body is not None:
            payload=json.dumps(body,sort_keys=True,separators=(',',':')).encode()
            if len(payload)>30000:raise Stop('PAYLOAD_TOO_LARGE')
            headers['content-type']='application/json'
        request=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,data=payload,method=method,headers=headers)
        try:
            with urllib.request.build_opener(NoRedirect).open(request,timeout=22) as f:
                if f.status!=200:raise Stop('PROVIDER_BAD_STATUS')
                raw=f.read(100001)
                if len(raw)>100000:raise Stop('PROVIDER_RESPONSE_TOO_LARGE')
        except urllib.error.HTTPError as e:raise Stop('PROVIDER_HTTP_'+str(e.code)) from None
        except (OSError,TimeoutError,ValueError):raise Stop('PROVIDER_TRANSPORT_OR_RESULT_UNKNOWN') from None
        try:doc=json.loads(raw)
        except ValueError:raise Stop('PROVIDER_BAD_JSON') from None
        if not isinstance(doc,dict) or doc.get('success') is not True:
            raise Stop('PROVIDER_ERROR_ENVELOPE')
        return doc.get('result')
    def get(self,path):return self.req('GET',path)
    def put(self,path,body):return self.req('PUT',path,body)

def h(v):return hashlib.sha256(v.encode()).hexdigest()
def rule_core(r):
    if not isinstance(r,dict) or not set(r).issubset(ALLOWED_RULE_FIELDS):raise Stop('UNREVIEWED_RULE_FIELDS')
    if not isinstance(r.get('expression'),str) or not isinstance(r.get('action_parameters'),dict):raise Stop('RULE_INVALID')
    return {k:copy.deepcopy(v) for k,v in r.items() if k not in ('last_updated','version')}

def verify_baseline(current, historical):
    if not isinstance(current,dict) or not isinstance(historical,dict):raise Stop('MISSING_RULESET')
    if (current.get('id'),current.get('version'),current.get('phase'),current.get('kind'))!=(RULESET,'25','http_config_settings','zone'):
        raise Stop('RULESET_VERSION_OR_ID_DRIFT')
    rules=current.get('rules')
    if not isinstance(rules,list) or len(rules)!=10:raise Stop('RULE_QUOTA_OR_ORDER_CHANGED')
    if [(r.get('id'),h(r.get('expression',''))) for r in rules]!=list(zip(FULL_IDS,FULL_HASHES)):
        raise Stop('RULE_ID_OR_EXPRESSION_DRIFT')
    if historical.get('id')!=RULESET or historical.get('version')!='25' or historical.get('rules')!=rules:
        raise Stop('HISTORICAL_ROLLBACK_SNAPSHOT_MISMATCH')
    a,b=rules[:2]
    ma=re.fullmatch(r'\(?http\.host eq "([a-z0-9.-]+)"\)?',a['expression'])
    mb=re.fullmatch(r'\(?http\.host eq "([a-z0-9.-]+)"\)?',b['expression'])
    if not ma or not mb or ma.group(1)==mb.group(1) or HOST in (ma.group(1),mb.group(1)):
        raise Stop('EXISTING_RULES_NOT_DISJOINT_EXACT_HOSTS')
    for r in (a,b):
        if r.get('enabled') is not True or r.get('action')!='set_config' or r.get('action_parameters')!={'bic':False,'security_level':'essentially_off'}:
            raise Stop('EXISTING_RULE_ACTION_DIFFERENCE')
    if any(HOST in r.get('expression','') for r in rules):raise Stop('STAGE_HOST_ALREADY_IN_RULES')
    cores=[rule_core(r) for r in rules]
    return cores,(ma.group(1),mb.group(1))

def create_payload(cores):
    if len(cores)!=10:raise Stop('INVALID_RULE_COUNT')
    first=copy.deepcopy(cores[0]);first['expression']='('+cores[0]['expression']+') or ('+cores[1]['expression']+')'
    fresh={'action':'set_config','enabled':True,'expression':EXPR,'action_parameters':{'security_level':'essentially_off'},
           'ref':REF,'description':'AXIOM customer staging hostname only: disable Under Attack challenge, retain WAF and DDoS'}
    return {'rules':[first,*cores[2:],fresh]}

def check_applied(result,cores,payload):
    if not isinstance(result,dict) or result.get('id')!=RULESET or result.get('phase')!='http_config_settings':return False
    rules=result.get('rules')
    if not isinstance(rules,list) or len(rules)!=10:return False
    actual=[rule_core(x) for x in rules]
    expected=payload['rules']
    if not actual[-1].get('id') or not re.fullmatch(r'[a-f0-9]{32}',str(actual[-1]['id'])):return False
    actual[-1].pop('id')
    return actual==expected and [r.get('id') for r in rules[:9]]==[cores[0]['id'],*[x['id'] for x in cores[2:]]]

def http(path):
    if path not in ('/_health','/auth/start','/v1/customer/me'):raise Stop('UNREVIEWED_HTTP_PATH')
    request=urllib.request.Request('https://'+HOST+path,method='GET',headers={'accept':'application/json','user-agent':'MUSITU-AXIOM-STAGING-INDEPENDENT-READBACK/20261108'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request,timeout=10) as f:
            return f.status,bool(f.headers.get('set-cookie')),f.read(3000)
    except urllib.error.HTTPError as e:return e.code,bool(e.headers.get('set-cookie')),e.read(3000)
    except (TimeoutError,OSError,ValueError):return None,False,None

def run(client,observe=http,sleep=time.sleep):
    result={'status':'NO_WRITE','schema':'AXIOM_STAGING_CONFIG_RULE_OWNER_APPROVED_V1',
      'zone_id':ZONE,'ruleset_id':RULESET,'original_version':'25', 'new_rule_exact_host':HOST,
      'original_hosts_changed_semantically':False,'rollback_version_pinned':False,
      'other_rule_count_preserved':0,'new_rule_count':None,'live_write_attempted':False,
      'production_oauth_touched':False,'customer_identity_qualified':False,'release_qualified':False,
      'global_under_attack_unchanged':None,'validation_dry_run':False}
    writer=client.get('/user/tokens/verify')
    if not isinstance(writer,dict) or writer.get('status')!='active':raise Stop('NEW_WRITE_TOKEN_NOT_ACTIVE')
    zone=client.get(f'/zones/{ZONE}')
    if not isinstance(zone,dict) or zone.get('account',{}).get('id')!=ACCOUNT or zone.get('name')!='mftintelligence.com' or zone.get('status')!='active' or zone.get('plan',{}).get('name')!='Free Website':
        raise Stop('ZONE_OWNER_OR_PLAN_DRIFT')
    security=client.get(f'/zones/{ZONE}/settings/security_level')
    if not isinstance(security,dict) or security.get('value')!='under_attack':raise Stop('GLOBAL_SECURITY_DRIFT')
    domains=client.get(f'/accounts/{ACCOUNT}/workers/domains')
    settings=client.get(f'/accounts/{ACCOUNT}/workers/scripts/{WORKER}/settings')
    if not isinstance(domains,list) or sum(1 for d in domains if isinstance(d,dict) and d.get('hostname')==HOST and d.get('service')==WORKER and d.get('enabled') is True)!=1:
        raise Stop('STAGING_CUSTOM_DOMAIN_NOT_ADMITTED')
    if not isinstance(settings,dict) or settings.get('bindings')!=[]:raise Stop('STAGING_WORKER_NOT_FAIL_CLOSED')
    current=client.get(RULEPATH)
    historical=client.get(RULEPATH+'/versions/25')
    cores,hosts=verify_baseline(current,historical)
    result['rollback_version_pinned']=True
    result['old_pair_expression_sha256']=list(OLD_EXPR_HASHES)
    result['retired_rule_id']=OLD_IDS[1]
    result['retained_rule_id']=OLD_IDS[0]
    result['other_rule_count_preserved']=8
    result['old_hostnames_digest']=[h(x) for x in hosts]
    payload=create_payload(cores)
    if len(payload['rules'])!=10:raise Stop('PLAN_RULE_LIMIT')
    result['new_rule_count']=10
    dry=client.put(RULEPATH+'?dry_run=true',payload)
    if dry is not None:raise Stop('DRY_RUN_NOT_NULL')
    result['validation_dry_run']=True
    again=client.get(RULEPATH)
    if again!=current or client.get(f'/zones/{ZONE}/settings/security_level')!=security:
        raise Stop('RULESET_CHANGED_DURING_PREFLIGHT')
    # Cloudflare dry-run and rule checks do not pin the Worker ingress itself.
    # Recheck both exact previously admitted GET resources immediately before
    # considering a policy-changing PUT; any ingress drift is a hard veto.
    if (client.get(f'/accounts/{ACCOUNT}/workers/domains')!=domains or
        client.get(f'/accounts/{ACCOUNT}/workers/scripts/{WORKER}/settings')!=settings):
        raise Stop('STAGING_INGRESS_CHANGED_DURING_PREFLIGHT')
    result['live_write_attempted']=True
    client.put(RULEPATH,payload)
    updated=client.get(RULEPATH)
    if not check_applied(updated,cores,payload):
        result['status']='PROVIDER_WRITE_READBACK_MISMATCH_REVIEW_REQUIRED'
        return result
    global_security=client.get(f'/zones/{ZONE}/settings/security_level')
    result['global_under_attack_unchanged']=global_security==security
    if not result['global_under_attack_unchanged']:
        result['status']='GLOBAL_SETTING_DRIFT_REVIEW_REQUIRED';return result
    result['actual_ruleset_version']=updated.get('version')
    result['status']='HOST_RULE_PUBLISHED_HTTPS_PENDING'
    for i in range(4):
        status,cookie,body=observe('/_health')
        result['health_http_status']=status
        if status==200 and not cookie:
            try:health=json.loads(body)
            except (TypeError,ValueError):health={}
            if isinstance(health,dict) and health.get('stage')=='host_route_only' and health.get('identity_live_qualified') is False:
                auth=observe('/auth/start');customer=observe('/v1/customer/me')
                result['auth_http_status']=auth[0];result['customer_http_status']=customer[0]
                if auth[0]==503 and customer[0]==503 and not auth[1] and not customer[1]:
                    result['status']='EXACT_STAGE_HTTPS_200_AND_AUTH_503_PASS'
                    break
        if i<3:sleep(7)
    return result

def main():
    receipt={'status':'NO_WRITE','production_oauth_touched':False,'customer_identity_qualified':False,'release_qualified':False}
    try:
        client=Client(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_STAGING_CONFIG_RULES_TOKEN'))
        receipt=run(client)
    except Stop as exc:
        receipt['status']='STOPPED'
        receipt['reason']=str(exc)
    except Exception:
        receipt['status']='STOPPED_UNEXPECTED_ERROR'
    if 'client' in locals():
        receipt['attempted_methods']=client.attempted
        receipt['ambiguous_live_write']=('ONE_LIVE_PUT' in client.attempted) and receipt.get('status') not in ('EXACT_STAGE_HTTPS_200_AND_AUTH_503_PASS','HOST_RULE_PUBLISHED_HTTPS_PENDING')
    raw=(json.dumps(receipt,sort_keys=True,indent=2)+'\n').encode()
    p=Path('axiom-staging-configuration-oneuse.json');p.write_bytes(raw)
    p.with_name(p.name+'.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  '+p.name+'\n')
    print('AXIOM_STAGE_CONFIG_STATUS='+receipt['status'])
    print('PRODUCTION_OAUTH_TOUCHED=false CUSTOMER_IDENTITY_QUALIFIED=false')
    return 0 if receipt['status']=='EXACT_STAGE_HTTPS_200_AND_AUTH_503_PASS' else 2
if __name__=='__main__':raise SystemExit(main())
