import datetime, hashlib, json, os, urllib.error, urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
DB_ID=os.environ['FMI_DB_UUID']
CERT_PREFIX='cert-fmi-real-money-'
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','Content-Type':'application/json','User-Agent':'MUSITU-FMI-Revenue-Intent-Inventory/1.0'}

def http(url, body):
    req=urllib.request.Request(url,method='POST',headers=H,data=json.dumps(body,separators=(',',':')).encode())
    try:
        with urllib.request.urlopen(req,timeout=45) as r:return r.status,r.read()
    except urllib.error.HTTPError as e:return e.code,e.read()

def d1(sql,params=None):
    obj={'sql':sql}
    if params is not None: obj['params']=params
    code,raw=http(f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query',obj)
    if code!=200: raise RuntimeError(f'D1 HTTP {code}')
    data=json.loads(raw or b'{}')
    if data.get('success') is False: raise RuntimeError('D1 success=false')
    rows=[]
    for result in data.get('result') or []:
        if result.get('success') is not True: raise RuntimeError('D1 statement failed')
        rows.extend(result.get('results') or [])
    return rows

def sha(v): return hashlib.sha256(str(v).encode()).hexdigest() if v else None

def one_count(sql,params):
    rows=d1(sql,params)
    if len(rows)!=1: raise RuntimeError('count query cardinality mismatch')
    return int(rows[0].get('n') or 0)

rows=d1("SELECT i.reference,i.customer_id,c.email,c.plan AS customer_plan,c.status AS customer_status,i.plan,i.amount_cents,i.currency,i.status AS intent_status,i.browser_url,i.poll_url,i.paynow_reference,i.created_at,i.expires_at,i.updated_at,i.completed_at FROM billing_checkout_intents i JOIN customers c ON c.id=i.customer_id WHERE i.plan='FOUNDING' AND i.amount_cents=4900 AND i.currency='USD' ORDER BY i.created_at ASC")
if len(rows)>50: raise RuntimeError('unexpected FOUNDING intent count')
items=[]
for r in rows:
    customer=str(r.get('customer_id') or '')
    reference=str(r.get('reference') or '')
    email=str(r.get('email') or '')
    subscriptions=one_count("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer])
    activations=one_count("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer])
    items.append({
        'reference_sha256':sha(reference),
        'customer_id_sha256':sha(customer),
        'email_sha256':sha(email.lower()),
        'certification_email_prefix':email.lower().startswith(CERT_PREFIX),
        'customer_plan':r.get('customer_plan'),
        'customer_status':r.get('customer_status'),
        'plan':r.get('plan'),'amount_cents':int(r.get('amount_cents') or 0),'currency':r.get('currency'),
        'intent_status':r.get('intent_status'),'created_at':r.get('created_at'),'expires_at':r.get('expires_at'),'updated_at':r.get('updated_at'),
        'browser_url_present':bool(r.get('browser_url')),'poll_url_present':bool(r.get('poll_url')),
        'paynow_reference_present':bool(r.get('paynow_reference')),'completed_at_present':bool(r.get('completed_at')),
        'active_subscription_count':subscriptions,'plan_activated_event_count':activations,
    })
out={'schema':'musitu.fmi.revenue-intent-inventory.v1','gate':'FMI_REVENUE_INTENT_INVENTORY_READONLY_PASS','mutation_performed':False,'raw_identifiers_published':False,'intent_count':len(items),'certification_prefix_count':sum(1 for x in items if x['certification_email_prefix']),'items':items}
raw=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
open('fmi-revenue-intent-inventory.json','wb').write(raw)
dg=hashlib.sha256(raw).hexdigest()
open('fmi-revenue-intent-inventory.sha256','w').write(dg+'  fmi-revenue-intent-inventory.json\n')
print(json.dumps({'gate':out['gate'],'intent_count':out['intent_count'],'certification_prefix_count':out['certification_prefix_count'],'statuses':[{'reference_sha256':x['reference_sha256'],'certification_email_prefix':x['certification_email_prefix'],'intent_status':x['intent_status'],'created_at':x['created_at'],'paynow_reference_present':x['paynow_reference_present'],'completed_at_present':x['completed_at_present'],'active_subscription_count':x['active_subscription_count'],'plan_activated_event_count':x['plan_activated_event_count']} for x in items],'evidence_sha256':dg,'mutation_performed':False,'raw_identifiers_published':False},sort_keys=True))
