import hashlib,json,os,secrets,urllib.error,urllib.request,uuid,datetime
CF_API=os.environ['CF_API'].rstrip('/'); ACCOUNT_ID=os.environ['ACCOUNT_ID']; DB_ID=os.environ['FMI_DB_UUID']; PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/'); CERT_PREFIX='cert-fmi-real-money-'
CFH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Pending-Settlement-Reconcile/1.1'}
def http(url,method='GET',headers=None,body=None,timeout=60):
 q=urllib.request.Request(url,method=method,headers=headers or {},data=body)
 try:
  with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,r.headers,r.read()
 except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
def d1(sql,params=None):
 h=dict(CFH);h['Content-Type']='application/json';obj={'sql':sql};
 if params is not None:obj['params']=params
 c,_,raw=http(f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query','POST',h,json.dumps(obj,separators=(',',':')).encode(),45)
 if c!=200:raise RuntimeError(f'D1 HTTP {c}')
 x=json.loads(raw or b'{}');
 if x.get('success') is False:raise RuntimeError('D1 success=false')
 rows=[]
 for rr in x.get('result') or []:
  if rr.get('success') is not True:raise RuntimeError('D1 statement failed')
  rows.extend(rr.get('results') or [])
 return rows
def api(path,obj,bearer):
 h={'Accept':'application/json','Content-Type':'application/json','Authorization':'Bearer '+bearer,'User-Agent':'MUSITU-FMI-Pending-Settlement-Reconcile/1.1'}
 c,_,raw=http(PUBLIC_BASE+path,'POST',h,json.dumps(obj,separators=(',',':')).encode(),60)
 try:x=json.loads(raw or b'{}')
 except:x={}
 return c,x
def sha(v):return hashlib.sha256(str(v).encode()).hexdigest() if v else None
def one(sql,p):
 r=d1(sql,p)
 if len(r)!=1:raise RuntimeError('cardinality mismatch')
 return r[0]
def temp_key(customer):
 kid='settle_'+uuid.uuid4().hex; token='musitu_fmi_settle_'+secrets.token_urlsafe(40); print('::add-mask::'+kid);print('::add-mask::'+token)
 now=datetime.datetime.now(datetime.timezone.utc); exp=now+datetime.timedelta(minutes=20); h=hashlib.sha256(token.encode()).hexdigest()
 d1("INSERT INTO api_keys(id,customer_id,key_hash,status,created_at,expires_at,revoked_at) VALUES(?1,?2,?3,'active',?4,?5,NULL)",[kid,customer,h,now.isoformat().replace('+00:00','Z'),exp.isoformat().replace('+00:00','Z')]);return kid,token
def cleanup(customer,kid):
 d1('DELETE FROM api_keys WHERE id=?1',[kid]); n=int(one("SELECT count(*) AS n FROM api_keys WHERE id=?1",[kid])['n'])
 if n!=0:raise RuntimeError('temporary key cleanup failed')
rows=d1("SELECT i.reference,i.customer_id,c.email,i.plan,i.amount_cents,i.currency,i.status,i.created_at FROM billing_checkout_intents i JOIN customers c ON c.id=i.customer_id WHERE i.plan='FOUNDING' AND i.amount_cents=4900 AND i.currency='USD' ORDER BY i.created_at ASC")
if not rows or len(rows)>20:raise RuntimeError('unexpected intent count')
out=[]
for r in rows:
 customer=str(r['customer_id']);ref=str(r['reference']);email=str(r.get('email') or '');print('::add-mask::'+customer);print('::add-mask::'+ref)
 kid,tok=temp_key(customer)
 try:
  code,p=api('/v1/billing/poll',{'reference':ref},tok)
  if code!=200:raise RuntimeError(f'poll HTTP {code}: {p.get("error")}')
 finally:cleanup(customer,kid)
 post=one('SELECT status,paynow_reference,completed_at FROM billing_checkout_intents WHERE reference=?1',[ref]);cust=one('SELECT plan,status FROM customers WHERE id=?1',[customer]);subs=int(one("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer])['n']);acts=int(one("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer])['n'])
 paid=p.get('paid') is True
 if paid:
  if post.get('status')!='paid' or not post.get('paynow_reference') or not post.get('completed_at') or subs!=1 or acts!=1 or str(cust.get('plan') or '').upper()!='FOUNDING':raise RuntimeError('paid provider state failed ledger verification')
 else:
  if subs!=0 or acts!=0 or str(cust.get('plan') or '').upper()!='FREE':raise RuntimeError('unpaid provider state has paid authority')
 out.append({'reference_sha256':sha(ref),'customer_id_sha256':sha(customer),'certification_email_prefix':email.lower().startswith(CERT_PREFIX),'created_at':r.get('created_at'),'provider_paid':paid,'provider_status':'paid' if paid else str(p.get('status') or 'unknown').lower(),'intent_status_after_poll':post.get('status'),'paynow_reference_present':bool(post.get('paynow_reference')),'completed_at_present':bool(post.get('completed_at')),'customer_plan_after_poll':cust.get('plan'),'active_subscription_count':subs,'plan_activated_event_count':acts})
remain=int(one("SELECT count(*) AS n FROM api_keys WHERE id LIKE 'settle_%'",[])['n'])
if remain!=0:raise RuntimeError('settlement temporary keys remain')
evidence={'schema':'musitu.fmi.pending-settlement-reconcile.v1','gate':'FMI_PENDING_SETTLEMENT_RECONCILE_PASS','intent_count':len(out),'paid_intent_count':sum(1 for x in out if x['provider_paid']),'intents':out,'duplicate_checkout_created':False,'raw_identifiers_published':False,'active_temporary_keys_remaining':0,'mutation_scope':['temporary_api_key_insert_delete','existing_intent_provider_poll','provider_verified_settlement_only_if_paid'],'real_money_e2e_certified':False}
raw=(json.dumps(evidence,indent=2,sort_keys=True)+'\n').encode();open('fmi-pending-settlement-reconcile.json','wb').write(raw);dg=hashlib.sha256(raw).hexdigest();open('fmi-pending-settlement-reconcile.sha256','w').write(dg+'  fmi-pending-settlement-reconcile.json\n')
print(json.dumps({'gate':evidence['gate'],'intent_count':len(out),'paid_intent_count':evidence['paid_intent_count'],'statuses':[{'reference_sha256':x['reference_sha256'],'certification_email_prefix':x['certification_email_prefix'],'provider_paid':x['provider_paid'],'provider_status':x['provider_status'],'intent_status_after_poll':x['intent_status_after_poll'],'customer_plan_after_poll':x['customer_plan_after_poll'],'active_subscription_count':x['active_subscription_count'],'plan_activated_event_count':x['plan_activated_event_count']} for x in out],'duplicate_checkout_created':False,'active_temporary_keys_remaining':0,'real_money_e2e_certified':False,'evidence_sha256':dg},sort_keys=True))
