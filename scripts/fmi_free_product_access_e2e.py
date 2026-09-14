import datetime, hashlib, json, os, secrets, urllib.error, urllib.request

CF_API=os.environ['CF_API'].rstrip('/'); ACCOUNT_ID=os.environ['ACCOUNT_ID']; DB_ID=os.environ['FMI_DB_UUID']; PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
CFH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','Content-Type':'application/json','User-Agent':'MUSITU-FMI-Free-Product-Access-E2E/1.0'}

def http(url,method='GET',headers=None,body=None,timeout=45):
    q=urllib.request.Request(url,method=method,headers=headers or {},data=body)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e:return e.code,{k.lower():v for k,v in e.headers.items()},e.read()

def d1(sql,params=None):
    payload={'sql':sql}
    if params is not None:payload['params']=params
    c,_,raw=http(f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query','POST',CFH,json.dumps(payload,separators=(',',':')).encode(),45)
    if c!=200:raise RuntimeError(f'D1 HTTP {c}')
    x=json.loads(raw or b'{}')
    if x.get('success') is False:raise RuntimeError('D1 success=false')
    rows=[]
    for rr in x.get('result') or []:
        if rr.get('success') is not True:raise RuntimeError('D1 statement failed')
        rows.extend(rr.get('results') or [])
    return rows

def one(sql,p):
    r=d1(sql,p)
    if len(r)!=1:raise RuntimeError(f'cardinality mismatch={len(r)}')
    return r[0]

def safe_json(raw):
    try:return json.loads(raw or b'{}')
    except Exception:return None

def digest(v):return hashlib.sha256(str(v).encode()).hexdigest()

stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S');nonce=secrets.token_hex(8)
email=f'product-e2e-{stamp}-{nonce}@example.invalid';print('::add-mask::'+email)
customer_id=None;token=None;evidence=None
try:
    if int(one('SELECT count(*) AS n FROM customers WHERE email=?1',[email])['n'])!=0:raise RuntimeError('synthetic identity collision')
    payload=json.dumps({'email':email,'name':'MUSITU FMI Product Access E2E','plan':'FREE'},separators=(',',':')).encode()
    code,_,raw=http(PUBLIC_BASE+'/v1/signup','POST',{'Accept':'application/json','Content-Type':'application/json','User-Agent':'MUSITU-FMI-Free-Product-Access-E2E/1.0'},payload,45)
    if code!=201:raise RuntimeError(f'signup HTTP {code}')
    obj=safe_json(raw)
    if not isinstance(obj,dict):raise RuntimeError('signup response not JSON object')
    token=next((obj.get(k) for k in ('api_key','key','token') if isinstance(obj.get(k),str) and obj.get(k)),None)
    if not token:raise RuntimeError('signup credential missing')
    print('::add-mask::'+token)
    row=one('SELECT id,plan,status FROM customers WHERE email=?1',[email]);customer_id=str(row.get('id') or '');print('::add-mask::'+customer_id)
    if not customer_id or str(row.get('plan') or '').upper()!='FREE' or str(row.get('status') or '').lower()!='active':raise RuntimeError('customer state mismatch')
    kh=hashlib.sha256(token.encode()).hexdigest();keys=d1("SELECT key_hash,status FROM api_keys WHERE customer_id=?1",[customer_id]);matches=[r for r in keys if str(r.get('status') or '').lower()=='active' and str(r.get('key_hash') or '')==kh]
    if len(matches)!=1:raise RuntimeError('issued key not uniquely active in D1')
    ah={'Accept':'application/json','Authorization':'Bearer '+token,'User-Agent':'MUSITU-FMI-Free-Product-Access-E2E/1.0'}
    surfaces={}
    for path in ('/v1/me','/v1/history','/v1/watchlists'):
        c,_,r=http(PUBLIC_BASE+path,'GET',ah,None,45);o=safe_json(r)
        surfaces[path]={'http':c,'json':isinstance(o,(dict,list))}
        if c!=200:raise RuntimeError(f'{path} HTTP {c}')
        if not isinstance(o,(dict,list)):raise RuntimeError(f'{path} response not JSON')
    subs=int(one("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer_id])['n']);acts=int(one("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer_id])['n']);checkouts=int(one('SELECT count(*) AS n FROM billing_checkout_intents WHERE customer_id=?1',[customer_id])['n'])
    if subs or acts or checkouts:raise RuntimeError('FREE product access created paid authority')
    evidence={'schema':'musitu.fmi.free-product-access-e2e.v1','gate':'FMI_FREE_PRODUCT_SURFACES_E2E_PASS','public_base':PUBLIC_BASE,'signup_http':201,'customer_plan':'FREE','customer_status':'active','credential_hash_matches_d1':True,'surfaces':surfaces,'active_subscription_count':subs,'plan_activated_event_count':acts,'checkout_intent_count':checkouts,'paid_authority_created':False,'synthetic_customer_deleted':False,'residual_customer_rows':None,'email_sha256':digest(email),'customer_id_sha256':digest(customer_id),'raw_credentials_published':False,'raw_identifiers_published':False,'live_trading_authorized':False,'real_money_e2e_certified':False}
finally:
    if customer_id:d1('DELETE FROM customers WHERE id=?1 AND email=?2',[customer_id,email])
    else:d1('DELETE FROM customers WHERE email=?1',[email])
    residual=int(one('SELECT count(*) AS n FROM customers WHERE email=?1',[email])['n'])
    if residual!=0:raise RuntimeError('synthetic cleanup failed')

if evidence is None:raise RuntimeError('product access evidence not earned')
evidence['synthetic_customer_deleted']=True;evidence['residual_customer_rows']=0
blob=(json.dumps(evidence,indent=2,sort_keys=True)+'\n').encode();open('fmi-free-product-access-e2e.json','wb').write(blob);dg=hashlib.sha256(blob).hexdigest();open('fmi-free-product-access-e2e.sha256','w').write(dg+'  fmi-free-product-access-e2e.json\n')
print(json.dumps({'gate':evidence['gate'],'signup_http':201,'customer_plan':'FREE','credential_hash_matches_d1':True,'surfaces':evidence['surfaces'],'paid_authority_created':False,'synthetic_customer_deleted':True,'residual_customer_rows':0,'live_trading_authorized':False,'real_money_e2e_certified':False,'evidence_sha256':dg},sort_keys=True))