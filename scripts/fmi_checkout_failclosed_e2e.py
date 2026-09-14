import datetime
import hashlib
import json
import os
import secrets
import urllib.error
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
    'User-Agent':'MUSITU-FMI-Checkout-Failclosed-E2E/1.0',
}

def http(url,method='GET',headers=None,body=None,timeout=45):
    q=urllib.request.Request(url,method=method,headers=headers or {},data=body)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e:return e.code,{k.lower():v for k,v in e.headers.items()},e.read()

def d1(sql,params=None):
    obj={'sql':sql}
    if params is not None:obj['params']=params
    code,_,raw=http(f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query','POST',CF_HEADERS,json.dumps(obj,separators=(',',':')).encode(),45)
    if code!=200:raise RuntimeError(f'D1 HTTP {code}')
    x=json.loads(raw or b'{}')
    if x.get('success') is False:raise RuntimeError('D1 success=false')
    rows=[]
    for rr in x.get('result') or []:
        if rr.get('success') is not True:raise RuntimeError('D1 statement failed')
        rows.extend(rr.get('results') or [])
    return rows

def one(sql,params):
    r=d1(sql,params)
    if len(r)!=1:raise RuntimeError(f'cardinality mismatch {len(r)}')
    return r[0]

def api(path,method='GET',obj=None,bearer=None):
    h={'Accept':'application/json','User-Agent':'MUSITU-FMI-Checkout-Failclosed-E2E/1.0'};body=None
    if obj is not None:
        h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    if bearer:h['Authorization']='Bearer '+bearer
    code,_,raw=http(PUBLIC_BASE+path,method,h,body,45)
    try:x=json.loads(raw or b'{}')
    except Exception:x={}
    return code,x

def sha(v):return hashlib.sha256(str(v).encode()).hexdigest() if v else None

stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
email=f'checkout-failclosed-{stamp}-{secrets.token_hex(8)}@example.invalid'
print('::add-mask::'+email)
customer_id=None;token=None;evidence=None
try:
    code,signup=api('/v1/signup','POST',{'email':email,'name':'MUSITU FMI Checkout Failclosed E2E','plan':'FREE'})
    if code not in (200,201):raise RuntimeError(f'signup HTTP {code}')
    token=signup.get('api_key') or signup.get('key') or signup.get('token')
    if not isinstance(token,str) or not token:raise RuntimeError('signup credential absent')
    print('::add-mask::'+token)
    rows=d1('SELECT id,plan,status FROM customers WHERE email=?1',[email])
    if len(rows)!=1:raise RuntimeError(f'customer cardinality {len(rows)}')
    customer_id=str(rows[0].get('id') or '')
    if not customer_id:raise RuntimeError('customer id absent')
    print('::add-mask::'+customer_id)
    if str(rows[0].get('plan') or '').upper()!='FREE' or str(rows[0].get('status') or '').lower()!='active':raise RuntimeError('unexpected signup state')

    before_intents=int(one('SELECT count(*) AS n FROM billing_checkout_intents WHERE customer_id=?1',[customer_id])['n'])
    before_subs=int(one("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer_id])['n'])
    before_acts=int(one("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer_id])['n'])
    if before_intents or before_subs or before_acts:raise RuntimeError('synthetic FREE customer has preexisting billing authority')

    checkout_code,checkout=api('/v1/billing/checkout','POST',{'plan':'FREE'},token)
    err=str(checkout.get('error') or checkout.get('code') or checkout.get('message') or '').strip().lower()

    after_intents=int(one('SELECT count(*) AS n FROM billing_checkout_intents WHERE customer_id=?1',[customer_id])['n'])
    after_subs=int(one("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer_id])['n'])
    after_acts=int(one("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer_id])['n'])
    cust=one('SELECT plan,status FROM customers WHERE id=?1',[customer_id])

    if checkout_code<400:raise RuntimeError(f'same-plan checkout unexpectedly accepted HTTP {checkout_code}')
    if after_intents!=0:raise RuntimeError('same-plan checkout created checkout intent')
    if after_subs!=0 or after_acts!=0:raise RuntimeError('same-plan checkout created paid authority')
    if str(cust.get('plan') or '').upper()!='FREE':raise RuntimeError('same-plan checkout changed customer plan')

    accepted_error=err in ('already_on_plan','unknown_plan') or 'already' in err or 'unknown' in err or 'plan' in err
    if not accepted_error:raise RuntimeError(f'unexpected fail-closed error class: {err or "<empty>"}')

    evidence={
        'schema':'musitu.fmi.checkout-failclosed-e2e.v1',
        'gate':'FMI_CHECKOUT_FAILCLOSED_E2E_PASS',
        'public_base':PUBLIC_BASE,
        'signup_http':code,
        'checkout_http':checkout_code,
        'checkout_error_class':err,
        'customer_plan_before':'FREE',
        'customer_plan_after':'FREE',
        'checkout_intent_delta':after_intents-before_intents,
        'active_subscription_delta':after_subs-before_subs,
        'plan_activated_event_delta':after_acts-before_acts,
        'provider_payment_intent_observed':False,
        'paid_authority_created':False,
        'real_money_e2e_certified':False,
        'live_trading_authorized':False,
        'raw_credentials_published':False,
        'raw_customer_identifiers_published':False,
        'synthetic_customer_deleted':False,
        'residual_customer_rows':None,
        'email_sha256':sha(email),
        'customer_id_sha256':sha(customer_id),
    }
finally:
    if customer_id:
        d1('DELETE FROM customers WHERE id=?1 AND email=?2',[customer_id,email])
    else:
        d1('DELETE FROM customers WHERE email=?1',[email])
    residual=int(one('SELECT count(*) AS n FROM customers WHERE email=?1',[email])['n'])
    if residual!=0:raise RuntimeError('synthetic cleanup failed')

if evidence is None:raise RuntimeError('fail-closed evidence not earned')
evidence['synthetic_customer_deleted']=True;evidence['residual_customer_rows']=0
blob=(json.dumps(evidence,indent=2,sort_keys=True)+'\n').encode();open('fmi-checkout-failclosed-e2e.json','wb').write(blob)
digest=hashlib.sha256(blob).hexdigest();open('fmi-checkout-failclosed-e2e.sha256','w').write(digest+'  fmi-checkout-failclosed-e2e.json\n')
print(json.dumps({'gate':evidence['gate'],'signup_http':evidence['signup_http'],'checkout_http':evidence['checkout_http'],'checkout_error_class':evidence['checkout_error_class'],'checkout_intent_delta':0,'active_subscription_delta':0,'plan_activated_event_delta':0,'provider_payment_intent_observed':False,'paid_authority_created':False,'synthetic_customer_deleted':True,'residual_customer_rows':0,'evidence_sha256':digest},sort_keys=True))
