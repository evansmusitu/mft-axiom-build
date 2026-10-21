"""Prepare ONLY three identity-bound secrets for a read-only LIFELINE owner JWT probe.

No Modal credentials, Neon, agent keys, customer data or executable actions are installed.
The main edge remains HTTP 503 for every backend route until the other seven
isolated bindings are independently approved. Never print identity/token values.
"""
from __future__ import annotations
import json,os,re,urllib.error,urllib.request
ACCOUNT='93f395f5121954671f92fffa453d6b61'
APP='71c315f0-3cfa-4217-98f1-e31d9ec8a44b'
HOST='lifeline-mt5-stage.mftintelligence.com'
WORKER='lifeline-mt5-edge-isolated'
NAME='LIFELINE Verified Owner MFA - Preenrollment'
BASE='https://api.cloudflare.com/client/v4'
KNOWN_EMAILS={'evansmusitu5@gmail.com','musituevans@gmail.com'}
REQUIRED={'ACCESS_ISSUER','ACCESS_AUD','ACCESS_OPERATOR_SUB',
          'MODAL_ORIGIN','MODAL_PROXY_KEY','MODAL_PROXY_SECRET',
          'EDGE_SHARED_SECRET','AGENT_ID','AGENT_TENANT','AGENT_HMAC_KEY'}
IDENTITY={'ACCESS_ISSUER','ACCESS_AUD','ACCESS_OPERATOR_SUB'}
def api(method,path,token,payload=None):
    h={'Authorization':'Bearer '+token,'Accept':'application/json',
       'User-Agent':'LIFELINE-IdentityOnly-Stage/1'}
    body=None
    if payload is not None:
        h['Content-Type']='application/json'
        body=json.dumps(payload,separators=(',',':')).encode()
    req=urllib.request.Request(BASE+path,data=body,method=method,headers=h)
    try:
        with urllib.request.urlopen(req,timeout=30) as resp:
            data=json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError('Cloudflare '+method+' HTTP '+str(e.code)+' identity-only stage failed') from None
    if not isinstance(data,dict) or data.get('success') is not True:
        raise RuntimeError('Cloudflare API declined identity-only stage')
    return data.get('result')
def main():
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if len(token)<20:raise RuntimeError('existing scoped Cloudflare token unavailable')
    if api('GET','/accounts/'+ACCOUNT,token).get('id')!=ACCOUNT:
        raise RuntimeError('Cloudflare account mismatch')
    zones=api('GET','/zones?name=mftintelligence.com&per_page=10',token)
    if not isinstance(zones,list) or len(zones)!=1 or zones[0].get('account',{}).get('id')!=ACCOUNT:
        raise RuntimeError('exact zone account mismatch')
    app=api('GET','/accounts/'+ACCOUNT+'/access/apps/'+APP,token)
    if (app.get('id')!=APP or app.get('name')!='LIFELINE MT5 PRIVATE ACCESS STAGE'
        or app.get('domain')!=HOST or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}',str(app.get('aud','')))):
        raise RuntimeError('Access app identity/audience not qualified')
    policies=api('GET','/accounts/'+ACCOUNT+'/access/apps/'+APP+'/policies?per_page=20',token)
    if not isinstance(policies,list) or len(policies)!=1:
        raise RuntimeError('isolated app must have precisely one allow policy')
    p=policies[0];m=p.get('mfa_config') or {}
    if (p.get('decision')!='allow' or p.get('name')!=NAME or
       m.get('mfa_disabled') is not False or m.get('session_duration')!='0m' or
       not any(a in m.get('allowed_authenticators',[]) for a in ('totp','biometrics','security_key'))):
        raise RuntimeError('owner-only independent MFA not configured')
    inc=p.get('include',[])
    if not isinstance(inc,list) or len(inc)!=1 or 'email' not in inc[0]:
        raise RuntimeError('owner Access allow is not uniquely email-bound')
    email=inc[0]['email'].get('email','').strip().lower()
    if email not in KNOWN_EMAILS:raise RuntimeError('unexpected owner')
    org=api('GET','/accounts/'+ACCOUNT+'/access/organizations',token)
    raw=org.get('auth_domain','')
    auth=raw.removeprefix('https://').rstrip('/')
    if not re.fullmatch(r'[a-z0-9-]+\\.cloudflareaccess\\.com',auth):
        raise RuntimeError('invalid pinned Access JWT issuer')
    issuer='https://'+auth+'/'
    users=api('GET','/accounts/'+ACCOUNT+'/access/users?per_page=100',token)
    if (not isinstance(users,list) or len(users)!=1 or
        users[0].get('email','').lower()!=email or not users[0].get('last_successful_login')):
        raise RuntimeError('verified owner Access identity missing')
    uid=users[0].get('id','')
    if not re.fullmatch(r'[a-fA-F0-9-]{36}',str(uid)):
        raise RuntimeError('owner UUID invalid')
    identity=api('GET','/accounts/'+ACCOUNT+'/access/users/'+uid+'/last_seen_identity',token)
    subject=identity.get('user_uuid','')
    if not isinstance(subject,str) or not re.fullmatch(r'[a-fA-F0-9-]{36}',subject):
        raise RuntimeError('owner Access JWT subject identity not qualified')
    # Reject ambiguity instead of binding the issuer to a different principal.
    if subject.lower()!=uid.lower():
        raise RuntimeError('owner JWT subject differs from verified Access user UUID')
    domains=api('GET','/accounts/'+ACCOUNT+'/workers/domains',token)
    if not isinstance(domains,list) or len([d for d in domains if d.get('hostname')==HOST])!=1:
        raise RuntimeError('isolated Worker custom-domain identity ambiguous')
    dom=next(d for d in domains if d.get('hostname')==HOST)
    if dom.get('service')!=WORKER or dom.get('zone_id')!=zones[0]['id']:
        raise RuntimeError('owner domain belongs to unrelated Worker')
    path='/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER+'/secrets'
    existing=api('GET',path,token)
    if not isinstance(existing,list):raise RuntimeError('binding readback unsupported')
    names={x.get('name') for x in existing if isinstance(x,dict)}
    if not names.issubset(IDENTITY):
        raise RuntimeError('unknown preexisting Worker bindings; refuse identity-only changes')
    pairs={'ACCESS_ISSUER':issuer,'ACCESS_AUD':app['aud'],'ACCESS_OPERATOR_SUB':subject}
    for name in sorted(IDENTITY-names):
        result=api('PUT',path,token,{'name':name,'text':pairs[name],'type':'secret_text'})
        if not isinstance(result,dict) or result.get('name')!=name:
            raise RuntimeError('Cloudflare identity-only secret write not acknowledged')
    final=api('GET',path,token)
    listed={x.get('name') for x in final if isinstance(x,dict)}
    if listed!=IDENTITY or (REQUIRED-listed)!=REQUIRED-IDENTITY:
        raise RuntimeError('private backend accidentally configured or unexpected bindings')
    # NEVER reveal user_uuid, auth_domain, secret values, contact or JWTs.
    print(json.dumps({'schema':'lifeline.owner_identity_only_stage.v1',
        'account_verified':True,'app_verified':True,
        'owner_independent_mfa_policy':True,
        'worker_identity_bindings':len(listed),
        'required_worker_bindings':len(REQUIRED),
        'missing_private_backend_bindings':len(REQUIRED-listed),
        'verified_owner_app_login':False,
        'verified_real_owner_jwt':False,
        'new_owner_probe_route_requires_real_access_jwt':True,
        'private_modal_backend_connected':False,'live_trading':False,
        'identity_values_exposed':False,'secrets_exposed':False},sort_keys=True))
if __name__=='__main__':main()
