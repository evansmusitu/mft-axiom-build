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
    'User-Agent':'MUSITU-FMI-Free-Signup-E2E/1.0',
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
    headers={'Accept':'application/json','Content-Type':content_type,'User-Agent':'MUSITU-FMI-Free-Signup-E2E/1.0'}
    return http(PUBLIC_BASE+'/v1/signup','POST',headers,body,45)

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

    key_rows=d1("SELECT id,key_hash,status,expires_at FROM api_keys WHERE customer_id=?1 ORDER BY created_at ASC",[customer_id])
    active_keys=[r for r in key_rows if str(r.get('status') or '').lower()=='active']
    raw_key_matches_d1=None
    if raw_api_key:
        raw_hash=hashlib.sha256(raw_api_key.encode()).hexdigest()
        raw_key_matches_d1=any(str(r.get('key_hash') or '')==raw_hash for r in active_keys)
        if not raw_key_matches_d1: raise RuntimeError('returned credential does not match active D1 key')

    signup_shape={
        'response_json':isinstance(response_obj,dict),
        'response_keys':sorted(k for k in response_obj.keys() if k not in ('api_key','key','token','customer_id','id')) if isinstance(response_obj,dict) else [],
        'raw_api_key_returned':bool(raw_api_key),
        'raw_api_key_matches_active_d1':raw_key_matches_d1,
        'active_api_key_count':len(active_keys),
    }

    # FREE signup must never create paid authority.
    subs=int(one("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer_id])['n'])
    acts=int(one("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer_id])['n'])
    checkouts=int(one('SELECT count(*) AS n FROM billing_checkout_intents WHERE customer_id=?1',[customer_id])['n'])
    if subs!=0 or acts!=0 or checkouts!=0:
        raise RuntimeError('FREE signup unexpectedly created paid/billing authority')

    evidence={
        'schema':'musitu.fmi.free-signup-e2e.v1',
        'gate':'FMI_FREE_CUSTOMER_SIGNUP_E2E_PASS',
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
    raise RuntimeError('signup evidence was not earned')
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
    'raw_api_key_returned':evidence['signup_shape']['raw_api_key_returned'],
    'raw_api_key_matches_active_d1':evidence['signup_shape']['raw_api_key_matches_active_d1'],
    'paid_authority_created':False,
    'synthetic_customer_deleted':True,
    'residual_customer_rows':0,
    'real_money_e2e_certified':False,
    'live_trading_authorized':False,
    'evidence_sha256':digest,
},sort_keys=True))
