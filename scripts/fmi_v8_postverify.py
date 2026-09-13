import email,hashlib,json,os,urllib.error,urllib.parse,urllib.request,time,uuid
API=os.environ['CF_API']; AID=os.environ['CLOUDFLARE_ACCOUNT_ID']; BASE=os.environ['PUBLIC_BASE'].rstrip('/')
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'User-Agent':'MUSITU-FMI-V8-IndependentReadback/1.0'}
def raw(url,method='GET',headers=None,body=None,timeout=45):
    q=urllib.request.Request(url,method=method,headers=headers or {},data=body)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
def cfget(path):
    code,h,b=raw(API+path,headers=H)
    if code!=200: raise SystemExit(f'Cloudflare readback HTTP {code}: {path}')
    return h,b
def src(name):
    h,b=cfget(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}'); ct=h.get('content-type','')
    if 'multipart/' not in ct.lower(): return b
    msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+b); parts=[]
    for p in msg.walk():
        if p.is_multipart():continue
        d=p.get_payload(decode=True) or b''
        if any(k in d for k in (b'export default',b'addEventListener',b'fetch(')):parts.append(d)
    if len(parts)!=1: raise SystemExit('Fail-closed executable readback ambiguity')
    return parts[0]
def settings(name):
    _,b=cfget(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}/settings')
    return {x.get('name'):x for x in ((json.loads(b).get('result') or {}).get('bindings') or []) if isinstance(x,dict)}
edge_src=src(os.environ['FMI_EDGE']); billing_src=src(os.environ['FMI_BILLING'])
edge_sha=hashlib.sha256(edge_src).hexdigest(); billing_sha=hashlib.sha256(billing_src).hexdigest()
if edge_sha!=os.environ['EXPECTED_V8_EDGE_SHA']: raise SystemExit(f'Fail-closed deployed edge SHA mismatch: {edge_sha}')
if billing_sha!=os.environ['EXPECTED_BILLING_SHA']: raise SystemExit(f'Fail-closed billing Worker changed: {billing_sha}')
b=settings(os.environ['FMI_EDGE'])
if b.get('FMI_DB',{}).get('id')!=os.environ['FMI_DB_UUID']: raise SystemExit('Fail-closed D1 binding mismatch after deploy')
if b.get('FMI_KERNEL',{}).get('service')!=os.environ['FMI_ADAPTER']: raise SystemExit('Fail-closed kernel binding mismatch after deploy')
if b.get('FMI_BILLING',{}).get('service')!=os.environ['FMI_BILLING']: raise SystemExit('Fail-closed billing binding mismatch after deploy')
required_headers={'strict-transport-security','x-content-type-options','x-frame-options','content-security-policy','referrer-policy','permissions-policy'}
def public(path,method='GET',obj=None,bearer=None):
    h={'Accept':'application/json','User-Agent':'MUSITU-FMI-V8-LiveProbe/1.0'}; body=None
    if obj is not None: h['Content-Type']='application/json'; body=json.dumps(obj,separators=(',',':')).encode()
    if bearer: h['Authorization']='Bearer '+bearer
    code,rh,rb=raw(BASE+path,method,h,body,30)
    try:data=json.loads(rb or b'{}')
    except:data=None
    return code,data,{k.lower():v for k,v in rh.items()},rb
health=None
for _ in range(30):
    hc,health,hh,_=public('/healthz?promotion='+uuid.uuid4().hex)
    if hc==200 and isinstance(health,dict) and health.get('status')=='ok': break
    time.sleep(2)
else: raise SystemExit('Fail-closed V8 health unavailable')
if health.get('authority')!='PAPER_SHADOW_ONLY': raise SystemExit('Fail-closed authority drift')
if not required_headers.issubset(set(hh)): raise SystemExit('Fail-closed security header regression')
wc,_,_,wbytes=public('/assets/workspace.js?promotion='+uuid.uuid4().hex)
if wc!=200: raise SystemExit('Fail-closed workspace asset unavailable')
workspace_sha=hashlib.sha256(wbytes).hexdigest()
if workspace_sha!=os.environ['EXPECTED_V8_WORKSPACE_SHA']: raise SystemExit(f'Fail-closed workspace V8 SHA mismatch: {workspace_sha}')
bc,bh,bhh,_=public('/v1/billing/healthz?promotion='+uuid.uuid4().hex)
if bc!=200 or not isinstance(bh,dict) or bh.get('ok') is not True or bh.get('settlement_certified') is not False: raise SystemExit('Fail-closed billing health regression')
if not required_headers.issubset(set(bhh)): raise SystemExit('Fail-closed billing security header regression')
uc,_,_,_=public('/v1/intelligence/analyze','POST',{'symbol':'EURUSD','returns':[0.001,-0.001,0.001,-0.001,0.0],'horizon':'NEXT'})
if uc!=401: raise SystemExit(f'Fail-closed unauthenticated analysis expected 401, got {uc}')
email_addr='fmi-v8-promotion-'+uuid.uuid4().hex+'@invalid.example'
sc,signup,_,_=public('/v1/signup','POST',{'email':email_addr})
if sc!=201 or not isinstance(signup,dict) or not signup.get('api_key') or not signup.get('customer_id') or signup.get('plan')!='FREE': raise SystemExit('Fail-closed free-signup promotion probe')
token=signup['api_key']; cid=signup['customer_id']; print('::add-mask::'+token)
monitor={'name':'V8 promotion evidence watch','symbol':'EURUSD','horizon':'NEXT_4H','match_mode':'ANY','conditions':{'regime_change':True,'mean_return_abs_delta_gte':None,'volatility_abs_delta_gte':0.0002,'trust_deteriorated':False,'provider_change':False,'source_mode_change':False}}
mc,mj,_,_=public('/v1/evidence/monitors','POST',monitor,token)
if mc!=201 or not isinstance(mj,dict) or len(str((mj.get('monitor') or {}).get('rule_sha256','')))!=64: raise SystemExit('Fail-closed V8 monitor creation probe')
p1={'symbol':'EURUSD','horizon':'NEXT_4H','returns':[0.001,-0.0004,0.0008,0.0012,-0.0003,0.0006],'imbalance':0,'source_ids':['promotion-manual-1']}
a1,x1,h1,_=public('/v1/intelligence/analyze','POST',p1,token)
if a1!=200 or not isinstance(x1,dict) or x1.get('classification')!='PAPER_SHADOW_MARKET_INTELLIGENCE': raise SystemExit('Fail-closed first V8 analysis probe')
if h1.get('x-fmi-evidence-indexed')!='true': raise SystemExit('Fail-closed V8 evidence indexing probe')
p2={'symbol':'EURUSD','horizon':'NEXT_4H','returns':[0.004,-0.003,0.005,-0.002,0.0045,-0.0035],'imbalance':0,'source_ids':['promotion-manual-2']}
a2,x2,h2,_=public('/v1/intelligence/analyze','POST',p2,token)
if a2!=200 or h2.get('x-fmi-monitor-evaluation')!='OK': raise SystemExit('Fail-closed V8 monitor evaluation probe')
ec,events,_,_=public('/v1/evidence/monitor-events?limit=50','GET',None,token)
if ec!=200 or not isinstance(events,dict) or events.get('background_market_polling') is not False or events.get('delivery')!='IN_APP_ON_NEW_EVIDENCE': raise SystemExit('Fail-closed V8 monitor feed contract')
hh=dict(H); hh['Content-Type']='application/json'
q={'sql':'DELETE FROM customers WHERE id=?1','params':[cid]}
code,_,body=raw(f"{API}/accounts/{AID}/d1/database/{os.environ['FMI_DB_UUID']}/query",'POST',hh,json.dumps(q,separators=(',',':')).encode())
if code!=200: raise SystemExit('Fail-closed promotion fixture cleanup HTTP '+str(code))
dx=json.loads(body or b'{}')
if dx.get('success') is False or any(r.get('success') is not True for r in (dx.get('result') or [])): raise SystemExit('Fail-closed promotion fixture cleanup')
ev={'schema':'musitu-fmi.v8-live-promotion-evidence.v1','gate':'PASS','deployment_pattern':'AXIOM_GITHUB_ACTIONS_PROTECTED_CLOUDFLARE_CONTROL_PLANE','worker':os.environ['FMI_EDGE'],'public_base':BASE,'edge_sha256':edge_sha,'workspace_asset_sha256':workspace_sha,'billing_worker_sha256':billing_sha,'d1_uuid':os.environ['FMI_DB_UUID'],'bindings':{'FMI_DB':'PASS','FMI_KERNEL':'PASS','FMI_BILLING':'PASS','FMI_MARKET_DATA':'BOUND' if 'FMI_MARKET_DATA' in b else 'NOT_BOUND_MANUAL_FALLBACK'},'health':'PASS','security_headers':'PASS','unauthenticated_analysis_401':'PASS','free_signup_probe':'PASS_AND_CLEANED','v8_monitor_creation':'PASS','v8_evidence_indexing':'PASS','v8_monitor_evaluation':'PASS','monitor_delivery':'IN_APP_ON_NEW_EVIDENCE','background_market_polling':False,'numeric_finance_risk_authority':'DETERMINISTIC_TOOL_ONLY','live_trading_authorized':False,'trade_execution_authorized':False,'production_model_authority':False,'scaled_autonomy':False,'profitability':'NOT_YET_CERTIFIED','superiority':'NOT_CERTIFIED','frontier':'NOT_YET_CERTIFIED','real_money_settlement':'NOT_CERTIFIED','billing_worker_modified':False,'payment_action_executed':False,'secret_values_read_or_logged':False}
raw_ev=json.dumps(ev,sort_keys=True,separators=(',',':')).encode(); ev['evidence_sha256']=hashlib.sha256(raw_ev).hexdigest()
open('fmi-v8-live-promotion-evidence.json','w').write(json.dumps(ev,indent=2,sort_keys=True)+'\n')
open('fmi-v8-live-promotion-evidence.sha256','w').write(hashlib.sha256(open('fmi-v8-live-promotion-evidence.json','rb').read()).hexdigest()+'  fmi-v8-live-promotion-evidence.json\n')
print(json.dumps({'gate':'PASS','edge_sha256':edge_sha,'workspace_sha256':workspace_sha,'billing_sha256':billing_sha,'market_data_bound':'FMI_MARKET_DATA' in b,'fixture_cleanup':'PASS','evidence_sha256':ev['evidence_sha256']},sort_keys=True))
