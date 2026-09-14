import datetime
import hashlib
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
DB_ID=os.environ['FMI_DB_UUID']
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
CF_HEADERS={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],
    'Accept':'application/json',
    'Content-Type':'application/json',
    'User-Agent':'MUSITU-FMI-Free-Signup-E2E/1.1',
}

def http(url,method='GET',headers=None,body=None,timeout=45):
    req=urllib.request.Request(url,method=method,headers=headers or {},data=body)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e:
        return e.code,{k.lower():v for k,v in e.headers.items()},e.read()

def d1(sql,params=None):
    payload={'sql':sql}
    if params is not None: payload['params']=params
    code,_,raw=http(
        f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query',
        'POST',CF_HEADERS,json.dumps(payload,separators=(',',':')).encode(),45)
    if code!=200: raise RuntimeError(f'D1 HTTP {code}')
    obj=json.loads(raw or b'{}')
    if obj.get('success') is False: raise RuntimeError('D1 success=false')
    rows=[]
    for item in obj.get('result') or []:
        if item.get('success') is not True: raise RuntimeError('D1 statement failed')
        rows.extend(item.get('results') or [])
    return rows

def one(sql,params):
    rows=d1(sql,params)
    if len(rows)!=1: raise RuntimeError(f'cardinality mismatch: {len(rows)}')
    return rows[0]

def sha(v):
    return hashlib.sha256(str(v).encode()).hexdigest() if v else None

def post_signup(email_value,content_type,body):
    headers={'Accept':'application/json','Content-Type':content_type,'User-Agent':'MUSITU-FMI-Free-Signup-E2E/1.1'}
    return http(PUBLIC_BASE+'/v1/signup','POST',headers,body,45)

def deep_values(obj,key):
    values=[]
    if isinstance(obj,dict):
        for k,v in obj.items():
            if str(k).lower()==key.lower(): values.append(v)
            values.extend(deep_values(v,key))
    elif isinstance(obj,list):
        for item in obj: values.extend(deep_values(item,key))
    return values

stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
nonce=secrets.token_hex(8)
email_value=f'launch-e2e-{stamp}-{nonce}@example.invalid'
name_value='MUSITU FMI Launch E2E'
print('::add-mask::'+email_value)

before=int(one('SELECT count(*) AS n FROM customers WHERE email=?1',[email_value])['n'])
if before!=0: raise RuntimeError('synthetic identity already exists')

customer_id=None
raw_api_key=None
signup_code=None
signup_shape=None
transport=None
cleanup_verified=False
try:
    attempts=[
        ('application/json',json.dumps({'email':email_value,'name':name_value,'plan':'FREE'},separators=(',',':')).encode(),'json'),
        ('application/x-www-form-urlencoded',urllib.parse.urlencode({'email':email_value,'name':name_value,'plan':'FREE'}).encode(),'form'),
    ]
    response_obj={}
    for content_type,body,label in attempts:
        code,headers,raw=post_signup(email_value,content_type,body)
        signup_code=code
        transport=label
        try: response_obj=json.loads(raw or b'{}')
        except Exception: response_obj={}
        # Never attempt a second transport if the first caused any customer mutation.
        current=d1('SELECT id,plan,status FROM customers WHERE email=?1',[email_value])
        if code in (200,201) or current:
            break
    if signup_code not in (200,201):
        raise RuntimeError(f'signup HTTP {signup_code}')

    rows=d1('SELECT id,email,plan,status FROM customers WHERE email=?1',[email_value])
    if len(rows)!=1: raise RuntimeError(f'signup customer cardinality={len(rows)}')
    customer=rows[0]
    customer_id=str(customer.get('id') or '')
    if not customer_id: raise RuntimeError('customer id missing in D1')
    print('::add-mask::'+customer_id)
    if str(customer.get('plan') or '').upper()!='FREE': raise RuntimeError('synthetic signup elevated plan')
    if str(customer.get('status') or '').lower()!='active': raise RuntimeError('synthetic customer not active')

    # Raw credentials, if returned, are masked immediately and never written to evidence.
    for key_name in ('api_key','key','token'):
        value=response_obj.get(key_name)
        if isinstance(value,str) and value:
            raw_api_key=value
            print('::add-mask::'+raw_api_key)
            break
    if not raw_api_key:
        raise RuntimeError('signup did not return an API credential')

    key_rows=d1("SELECT id,key_hash,status,expires_at FROM api_keys WHERE customer_id=?1 ORDER BY created_at ASC",[customer_id])
    active_keys=[r for r in key_rows if str(r.get('status') or '').lower()=='active']
    raw_hash=hashlib.sha256(raw_api_key.encode()).hexdigest()
    raw_key_matches_d1=any(str(r.get('key_hash') or '')==raw_hash for r in active_keys)
    if not raw_key_matches_d1: raise RuntimeError('returned credential does not match active D1 key')

    # Prove the credential is accepted by the live edge account endpoint.
    me_headers={'Accept':'application/json','Authorization':'Bearer '+raw_api_key,'User-Agent':'MUSITU-FMI-Free-Signup-E2E/1.1'}
    me_code,_,me_raw=http(PUBLIC_BASE+'/v1/me','GET',me_headers,None,45)
    try: me_obj=json.loads(me_raw or b'{}')
    except Exception: me_obj={}
    if me_code!=200: raise RuntimeError(f'/v1/me HTTP {me_code}')
    if not isinstance(me_obj,dict): raise RuntimeError('/v1/me did not return a JSON object')
    observed_plans=[str(v).upper() for v in deep_values(me_obj,'plan') if v is not None]
    observed_statuses=[str(v).lower() for v in deep_values(me_obj,'status') if v is not None]
    observed_emails=[str(v).lower() for v in deep_values(me_obj,'email') if v is not None]
    if observed_plans and 'FREE' not in observed_plans: raise RuntimeError('/v1/me plan mismatch')
    if observed_statuses and 'active' not in observed_statuses: raise RuntimeError('/v1/me status mismatch')
    if observed_emails and email_value.lower() not in observed_emails: raise RuntimeError('/v1/me email mismatch')

    signup_shape={
        'response_json':isinstance(response_obj,dict),
        'response_keys':sorted(k for k in response_obj.keys() if k not in ('api_key','key','token','customer_id','id')) if isinstance(response_obj,dict) else [],
        'raw_api_key_returned':True,
        'raw_api_key_matches_active_d1':True,
        'active_api_key_count':len(active_keys),
    }
    account_access={
        'me_http':me_code,
        'me_json_object':True,
        'me_response_keys':sorted(k for k in me_obj.keys() if str(k).lower() not in ('api_key','key','token','customer_id','id','email')),
        'observed_free_plan':('FREE' in observed_plans) if observed_plans else None,
        'observed_active_status':('active' in observed_statuses) if observed_statuses else None,
        'observed_matching_email':(email_value.lower() in observed_emails) if observed_emails else None,
        'credential_accepted':True,
    }

    # FREE signup and authenticated account access must never create paid authority.
    subs=int(one("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer_id])['n'])
    acts=int(one("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer_id])['n'])
    checkouts=int(one('SELECT count(*) AS n FROM billing_checkout_intents WHERE customer_id=?1',[customer_id])['n'])
    if subs!=0 or acts!=0 or checkouts!=0:
        raise RuntimeError('FREE signup unexpectedly created paid/billing authority')

    evidence={
        'schema':'musitu.fmi.free-customer-access-e2e.v1',
        'gate':'FMI_FREE_CUSTOMER_ACCESS_E2E_PASS',
        'public_base':PUBLIC_BASE,
        'signup_http':signup_code,
        'signup_transport':transport,
        'email_sha256':sha(email_value),
        'customer_id_sha256':sha(customer_id),
        'customer_plan':'FREE',
        'customer_status':'active',
        'active_subscription_count':subs,
        'plan_activated_event_count':acts,
        'checkout_intent_count':checkouts,
        'signup_shape':signup_shape,
        'account_access':account_access,
        'paid_authority_created':False,
        'raw_identifiers_published':False,
        'raw_credentials_published':False,
        'synthetic_customer_deleted':False,
        'residual_customer_rows':None,
        'real_money_e2e_certified':False,
        'live_trading_authorized':False,
    }
finally:
    # Exact synthetic identity cleanup. Child rows are ON DELETE CASCADE by verified schema.
    if customer_id:
        d1('DELETE FROM customers WHERE id=?1 AND email=?2',[customer_id,email_value])
    else:
        # Only this cryptographically unique synthetic email may be removed.
        d1('DELETE FROM customers WHERE email=?1',[email_value])
    residual=int(one('SELECT count(*) AS n FROM customers WHERE email=?1',[email_value])['n'])
    cleanup_verified=(residual==0)
    if not cleanup_verified: raise RuntimeError('synthetic customer cleanup failed')

if 'evidence' not in globals():
    raise RuntimeError('customer access evidence was not earned')
evidence['synthetic_customer_deleted']=True
evidence['residual_customer_rows']=0
blob=(json.dumps(evidence,indent=2,sort_keys=True)+'\n').encode()
open('fmi-free-signup-e2e.json','wb').write(blob)
digest=hashlib.sha256(blob).hexdigest()
open('fmi-free-signup-e2e.sha256','w').write(digest+'  fmi-free-signup-e2e.json\n')
print(json.dumps({
    'gate':evidence['gate'],
    'signup_http':evidence['signup_http'],
    'signup_transport':evidence['signup_transport'],
    'customer_plan':evidence['customer_plan'],
    'customer_status':evidence['customer_status'],
    'active_api_key_count':evidence['signup_shape']['active_api_key_count'],
    'raw_api_key_returned':True,
    'raw_api_key_matches_active_d1':True,
    'me_http':evidence['account_access']['me_http'],
    'credential_accepted':evidence['account_access']['credential_accepted'],
    'paid_authority_created':False,
    'synthetic_customer_deleted':True,
    'residual_customer_rows':0,
    'real_money_e2e_certified':False,
    'live_trading_authorized':False,
    'evidence_sha256':digest,
},sort_keys=True))
