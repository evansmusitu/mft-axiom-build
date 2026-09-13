import datetime, hashlib, json, os, pathlib, secrets, urllib.error, urllib.request, uuid

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
DB_ID=os.environ['FMI_DB_UUID']
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
CERT_EMAIL_PREFIX='cert-fmi-real-money-'
CFH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Real-Money-Reconcile/2.0'}

def http(url,method='GET',headers=None,body=None,timeout=60):
    q=urllib.request.Request(url,method=method,headers=headers or {},data=body)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def api(path,method='GET',obj=None,bearer=None):
    h={'Accept':'application/json','User-Agent':'MUSITU-FMI-Real-Money-Reconcile/2.0'};body=None
    if obj is not None:
        h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    if bearer:h['Authorization']='Bearer '+bearer
    code,rh,raw=http(PUBLIC_BASE+path,method,h,body)
    try:x=json.loads(raw or b'{}')
    except Exception:x={}
    return code,{k.lower():v for k,v in rh.items()},x

def d1(sql,params=None):
    h=dict(CFH);h['Content-Type']='application/json';obj={'sql':sql}
    if params is not None:obj['params']=params
    code,_,raw=http(f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query','POST',h,json.dumps(obj,separators=(',',':')).encode(),45)
    if code!=200:raise RuntimeError(f'D1 HTTP {code}')
    x=json.loads(raw or b'{}');rows=[]
    if x.get('success') is False:raise RuntimeError('D1 success=false')
    for rr in x.get('result') or []:
        if rr.get('success') is not True:raise RuntimeError('D1 statement failed')
        rows.extend(rr.get('results') or [])
    return rows

def utcnow():return datetime.datetime.now(datetime.timezone.utc)
def iso(dt):return dt.isoformat().replace('+00:00','Z')
def sha(v):return hashlib.sha256(str(v).encode()).hexdigest() if v else None

def parse_dt(v):
    if not v:return None
    try:
        d=datetime.datetime.fromisoformat(str(v).replace('Z','+00:00'))
        if d.tzinfo is None:d=d.replace(tzinfo=datetime.timezone.utc)
        return d.astimezone(datetime.timezone.utc)
    except Exception:return None

def q1(sql,params=None):
    r=d1(sql,params)
    if len(r)!=1:raise RuntimeError(f'expected exactly one row, got {len(r)}')
    return r[0]

# Select exactly one newest certification checkout. Raw identifiers never leave process output.
rows=d1("SELECT c.id AS customer_id,c.email,c.plan AS customer_plan,c.status AS customer_status,i.reference,i.plan,i.amount_cents,i.currency,i.status AS intent_status,i.expires_at,i.paynow_reference,i.completed_at FROM customers c JOIN billing_checkout_intents i ON i.customer_id=c.id WHERE c.email LIKE ?1 ORDER BY i.created_at DESC LIMIT 2",[CERT_EMAIL_PREFIX+'%'])
if not rows:raise RuntimeError('no FMI certification checkout exists')
intent=rows[0]
customer=str(intent['customer_id']);reference=str(intent['reference'])
print('::add-mask::'+customer);print('::add-mask::'+reference)
if intent.get('plan')!='FOUNDING' or int(intent.get('amount_cents') or 0)!=4900 or intent.get('currency')!='USD':raise RuntimeError('certification catalog drift')

# IMPORTANT: local checkout expiry controls creation/reuse, not authoritative post-payment settlement.
# Always poll the existing safe Paynow poll URL. A paid, cryptographically verified provider response
# may reconcile after the local 30-minute initiation window. Unpaid/cancelled/failed states still fail closed.

suffix=uuid.uuid4().hex
key_id='cert_fmi_reconcile_'+suffix
token='musitu_fmi_real_money_reconcile_'+secrets.token_urlsafe(40)
print('::add-mask::'+token);print('::add-mask::'+key_id)
created=iso(utcnow());key_exp=iso(utcnow()+datetime.timedelta(minutes=20));key_hash=hashlib.sha256(token.encode()).hexdigest()
d1("INSERT INTO api_keys(id,customer_id,key_hash,status,created_at,expires_at,revoked_at) VALUES(?1,?2,?3,'active',?4,?5,NULL)",[key_id,customer,key_hash,created,key_exp])

evidence={}
try:
    before_sub=int(q1("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer])['n'])
    before_act=int(q1("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer])['n'])
    code,headers,poll=api('/v1/billing/poll','POST',{'reference':reference},token)
    if code!=200:raise RuntimeError(f'FMI billing poll failed HTTP {code}: {poll.get("error")}')
    paid=poll.get('paid') is True

    post=q1("SELECT plan,amount_cents,currency,status,paynow_reference,completed_at,updated_at FROM billing_checkout_intents WHERE reference=?1",[reference])
    cust=q1("SELECT plan,status FROM customers WHERE id=?1",[customer])
    subs=d1("SELECT provider,provider_reference,plan,status,amount_cents,currency,period_start,period_end FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer])
    acts=d1("SELECT metadata_json,occurred_at FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED' ORDER BY occurred_at",[customer])

    if not paid:
        if str(post.get('status') or '').lower() not in ('pending','cancelled','failed','created','initiated'):
            raise RuntimeError('unexpected unpaid canonical status')
        if len(subs)!=0 or len(acts)!=0 or str(cust.get('plan') or '').upper()!='FREE':
            raise RuntimeError('unpaid checkout provisioned paid authority')
        evidence={
            'schema':'musitu.fmi.real-money-certification-reconcile.v2',
            'gate':'FMI_REAL_MONEY_CERTIFICATION_AWAITING_PAYMENT',
            'provider':'paynow','payment_status':str(poll.get('status') or 'pending').lower(),
            'intent_status':post.get('status'),'real_money_e2e_certified':False,
            'active_subscription_count':0,'plan_activated_event_count':0,'customer_plan':'FREE',
            'production_analysis_performed':False,'mutation_scope':['temporary_api_key_insert_delete','verified_provider_poll_status_only'],
            'raw_api_key_published':False,'raw_customer_id_published':False,'raw_reference_published':False,
            'profitability':'NOT_YET_CERTIFIED','superiority':'NOT_CERTIFIED','live_trading_authorized':False,'trade_execution_authorized':False,
        }
    else:
        if str(post.get('status') or '').lower()!='paid' or not post.get('paynow_reference') or not post.get('completed_at'):
            raise RuntimeError('provider reports paid but settlement ledger incomplete')
        if len(subs)!=1:raise RuntimeError('paid checkout does not have exactly one active subscription')
        s=subs[0]
        if (s.get('provider'),s.get('plan'),s.get('status'),int(s.get('amount_cents') or 0),s.get('currency'))!=('paynow','FOUNDING','active',4900,'USD') or not s.get('provider_reference'):
            raise RuntimeError('active subscription contract mismatch')
        if not parse_dt(s.get('period_end')) or parse_dt(s.get('period_end'))<=utcnow():raise RuntimeError('active subscription period invalid')
        if str(cust.get('plan') or '').upper()!='FOUNDING' or cust.get('status')!='active':raise RuntimeError('customer plan activation mismatch')
        if len(acts)!=1:raise RuntimeError(f'expected exactly one PLAN_ACTIVATED event, got {len(acts)}')
        try:meta=json.loads(acts[0].get('metadata_json') or '{}')
        except Exception:meta={}
        psha=str(meta.get('provider_payload_sha256') or '')
        if meta.get('plan')!='FOUNDING' or meta.get('provider')!='paynow' or len(psha)!=64 or any(c not in '0123456789abcdef' for c in psha.lower()):
            raise RuntimeError('PLAN_ACTIVATED verified-provider evidence mismatch')

        # Prove the paid identity can perform a real paper-shadow analysis and is metered exactly once.
        before_events=int(q1("SELECT count(*) AS n FROM usage_events WHERE customer_id=?1",[customer])['n'])
        today=utcnow().date().isoformat()
        b_rows=d1("SELECT analysis_count,share_count FROM usage_buckets WHERE customer_id=?1 AND bucket_date=?2",[customer,today])
        before_analysis=int(b_rows[0].get('analysis_count') or 0) if len(b_rows)==1 else 0
        payload={'symbol':'EURUSD','horizon':'NEXT_4H','returns':[0.001,-0.0004,0.0008,0.0012,-0.0003,0.0006],'imbalance':0,'source_ids':['real-money-certification']}
        ac,ah,aj=api('/v1/intelligence/analyze','POST',payload,token)
        if ac!=200 or aj.get('classification')!='PAPER_SHADOW_MARKET_INTELLIGENCE':raise RuntimeError(f'paid entitlement analysis failed HTTP {ac}')
        after_events=int(q1("SELECT count(*) AS n FROM usage_events WHERE customer_id=?1",[customer])['n'])
        a_rows=d1("SELECT analysis_count,share_count FROM usage_buckets WHERE customer_id=?1 AND bucket_date=?2",[customer,today])
        if len(a_rows)!=1:raise RuntimeError('paid analysis usage bucket absent')
        after_analysis=int(a_rows[0].get('analysis_count') or 0)
        if after_events-before_events!=1 or after_analysis-before_analysis!=1:raise RuntimeError('paid analysis metering delta mismatch')
        last=q1("SELECT event_type,plan,request_hash,response_hash,latency_ms,metadata_json FROM usage_events WHERE customer_id=?1 ORDER BY created_at DESC LIMIT 1",[customer])
        if str(last.get('plan') or '').upper()!='FOUNDING' or not last.get('request_hash') or not last.get('response_hash'):
            raise RuntimeError('paid analysis usage event contract mismatch')

        # A second provider status poll must be idempotent and must not duplicate activation/subscription.
        code2,_,poll2=api('/v1/billing/poll','POST',{'reference':reference},token)
        if code2!=200 or poll2.get('paid') is not True:raise RuntimeError('second paid poll failed')
        sub2=int(q1("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'",[customer])['n'])
        act2=int(q1("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[customer])['n'])
        if sub2!=1 or act2!=1:raise RuntimeError('duplicate paid provisioning detected')

        evidence={
            'schema':'musitu.fmi.real-money-certification-reconcile.v2','gate':'FMI_REAL_MONEY_E2E_PASS',
            'provider':'paynow','payment_status':'paid','intent_status':'paid','plan':'FOUNDING','price_id':'fmi-founding-monthly','amount_cents':4900,'currency':'USD',
            'subscription_active':True,'active_subscription_count':1,'provider_reference_present':True,'completed_at_present':True,
            'customer_entitlement_active':True,'customer_plan':'FOUNDING','plan_activated_event_count':1,'verified_provider_payload_sha256_present':True,
            'production_analysis_http':200,'production_analysis_classification':'PAPER_SHADOW_MARKET_INTELLIGENCE','usage_event_delta':1,'usage_bucket_analysis_delta':1,
            'idempotent_second_poll':True,'duplicate_active_subscription':False,'duplicate_plan_activation':False,
            'post_expiry_provider_reconciliation_allowed':True,
            'real_money_e2e_certified':True,'raw_api_key_published':False,'raw_customer_id_published':False,'raw_reference_published':False,
            'profitability':'NOT_YET_CERTIFIED','superiority':'NOT_CERTIFIED','live_trading_authorized':False,'trade_execution_authorized':False,
        }
finally:
    d1('DELETE FROM api_keys WHERE id=?1',[key_id])
    active=int(q1("SELECT count(*) AS n FROM api_keys WHERE customer_id=?1 AND status='active'",[customer])['n'])
    if active!=0:raise RuntimeError('active certification API key remained after reconciliation')

evidence['active_certification_api_keys_remaining']=0
evidence['customer_id_sha256']=sha(customer);evidence['reference_sha256']=sha(reference)
raw=(json.dumps(evidence,indent=2,sort_keys=True)+'\n').encode();pathlib.Path('fmi-real-money-certification-reconcile.json').write_bytes(raw)
dg=hashlib.sha256(raw).hexdigest();pathlib.Path('fmi-real-money-certification-reconcile.sha256').write_text(dg+'  fmi-real-money-certification-reconcile.json\n',encoding='utf-8')
print(json.dumps({'gate':evidence['gate'],'payment_status':evidence.get('payment_status'),'real_money_e2e_certified':evidence.get('real_money_e2e_certified'),'customer_plan':evidence.get('customer_plan'),'active_subscription_count':evidence.get('active_subscription_count'),'plan_activated_event_count':evidence.get('plan_activated_event_count'),'active_certification_api_keys_remaining':0,'raw_api_key_published':False,'raw_customer_id_published':False,'raw_reference_published':False,'evidence_sha256':dg},sort_keys=True))
