import hashlib,json,os,pathlib,secrets,subprocess,time,urllib.error,urllib.parse,urllib.request
API=os.environ.get('CF_API','https://api.cloudflare.com/client/v4').rstrip('/')
AID=os.environ['ACCOUNT_ID']; ZID=os.environ['ZONE_ID']; ZONE=os.environ['ZONE_NAME']
HOST=os.environ.get('APP_HOST','app.mftintelligence.com'); WORKER=os.environ.get('APP_WORKER','mft-fmi-app')
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/'); SOURCE_PATH=pathlib.Path(os.environ.get('APP_SOURCE','/tmp/fmi_flagship_worker.mjs'))
SOURCE=SOURCE_PATH.read_bytes(); SOURCE_SHA=hashlib.sha256(SOURCE).hexdigest(); BUILD='MUSITU_FMI_FLAGSHIP_V2_20260916'
AUTH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Flagship-V2-Deploy/1.0'}

def raw(url,method='GET',headers=None,body=None,timeout=45):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body),timeout=timeout) as r:return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e:return e.code,{k.lower():v for k,v in e.headers.items()},e.read()
    except Exception as e:return 0,{},type(e).__name__.encode()
def cf(path,method='GET',obj=None):
    h=dict(AUTH); body=None
    if obj is not None:h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,_,b=raw(API+path,method,h,body,60)
    if not 200<=c<300:raise RuntimeError(f'Cloudflare HTTP {c}: {path}: '+b[:400].decode('utf-8','ignore'))
    o=json.loads(b or b'{}')
    if isinstance(o,dict) and o.get('success') is False:raise RuntimeError(str(o.get('errors'))[:500])
    return o.get('result') if isinstance(o,dict) else None
def probe(url,method='GET',obj=None):
    h={'accept':'application/json','user-agent':'MUSITU-FMI-Flagship-V2-Acceptance/1.0'}; body=None
    if obj is not None:h['content-type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,rh,b=raw(url,method,h,body,35)
    try:o=json.loads(b or b'{}')
    except:o=None
    return c,rh,o,b

def multipart():
    bd='----MUSITU'+secrets.token_hex(18); p=[]
    def add(x):p.append(x.encode() if isinstance(x,str) else x)
    meta={'main_module':'index.mjs','compatibility_date':'2026-09-15','bindings':[{'type':'plain_text','name':'PUBLIC_BASE','text':PUBLIC_BASE}]}
    add(f'--{bd}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n');add(json.dumps(meta,separators=(',',':')));add('\r\n')
    add(f'--{bd}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n');add(SOURCE);add('\r\n');add(f'--{bd}--\r\n')
    return bd,b''.join(p)

subprocess.run(['node','--check',str(SOURCE_PATH)],check=True)
text=SOURCE.decode()
for s in (BUILD,'FEDERATED_OPEN_WEIGHT','PAPER_SHADOW_ONLY','/architecture.json','/v1/intelligence/analyze','Market discovery','Governed market investigation','Pinned open-model federation','World Model Federation'):
    if s not in text:raise RuntimeError('source invariant missing: '+s)
compact=text.replace(' ','').replace('\n','')
for s in ('live_trading_authorized:false','trade_execution_authorized:false','production_model_authority:false'):
    if s not in compact:raise RuntimeError('authority boundary missing: '+s)
if '/d1/database' in text.lower():raise RuntimeError('D1 management API forbidden')

zones=cf('/zones?name='+urllib.parse.quote(ZONE)+'&status=active') or []
if len(zones)!=1 or zones[0].get('id')!=ZID or (zones[0].get('account') or {}).get('id')!=AID:raise RuntimeError('zone/account mismatch')
domains=cf(f'/accounts/{AID}/workers/domains') or []; rows=[d for d in domains if d.get('hostname')==HOST]
if len(rows)!=1 or rows[0].get('service')!=WORKER:raise RuntimeError('canonical app domain mapping mismatch')

bd,body=multipart();h=dict(AUTH);h['Content-Type']='multipart/form-data; boundary='+bd
c,_,b=raw(f'{API}/accounts/{AID}/workers/scripts/{WORKER}','PUT',h,body,60)
if not 200<=c<300:raise RuntimeError('Worker upload failed '+str(c)+' '+b[:300].decode('utf-8','ignore'))
cf(f'/accounts/{AID}/workers/scripts/{WORKER}/subdomain','POST',{'enabled':False,'previews_enabled':False})

base='https://'+HOST; health=None
for _ in range(40):
    hc,hh,ho,_=probe(base+'/healthz?ts='+str(time.time_ns()))
    if hc==200 and isinstance(ho,dict) and ho.get('build')==BUILD and ho.get('authority')=='PAPER_SHADOW_ONLY' and ho.get('model_architecture')=='FEDERATED_OPEN_WEIGHT' and ho.get('production_model_authority') is False and ho.get('live_trading_authorized') is False and ho.get('trade_execution_authorized') is False and (ho.get('upstream') or {}).get('status')==200:
        health=(hc,hh,ho);break
    time.sleep(1)
if health is None:raise RuntimeError('V2 canonical health did not converge')
required={'strict-transport-security','x-content-type-options','x-frame-options','content-security-policy','referrer-policy','permissions-policy'}
if not required.issubset(health[1]):raise RuntimeError('security headers incomplete')

static={}; arch_obj=None
for path,ctype in [('/app','text/html'),('/app.css','text/css'),('/app.js','application/javascript'),('/architecture.json','application/json')]:
    accepted=None
    for _ in range(35):
        sc,sh,sb=raw(base+path+'?v2='+str(time.time_ns()),headers={'user-agent':'MUSITU-FMI-Flagship-V2-Acceptance/1.0'},timeout=30)
        marker=path!='/app.js' or BUILD.encode() in sb
        if sc==200 and ctype in (sh.get('content-type') or '') and (sh.get('cache-control') or '').lower()=='no-store' and required.issubset(sh) and marker:accepted=(sc,sh,sb);break
        time.sleep(1)
    if accepted is None:raise RuntimeError('asset did not converge: '+path)
    sc,sh,sb=accepted;static[path]={'http':sc,'bytes':len(sb),'content_type':sh.get('content-type')}
    if path=='/architecture.json':arch_obj=json.loads(sb)
if len((arch_obj.get('federation') or {}).get('portfolio') or [])!=9 or len(arch_obj.get('worldModels') or [])!=13 or len(arch_obj.get('specialists') or [])!=17:raise RuntimeError('architecture counts mismatch')

pc,_,po,_=probe(base+'/api/healthz?ts='+str(time.time_ns()))
if pc!=200 or not isinstance(po,dict) or po.get('authority')!='PAPER_SHADOW_ONLY':raise RuntimeError('proxy health failed')
mc,_,_,_=probe(base+'/api/v1/me'); ac,_,_,_=probe(base+'/api/v1/intelligence/analyze','POST',{'symbol':'EURUSD','horizon':'NEXT_4H','returns':[.001,-.001,.0004]})
if mc!=401 or ac!=401:raise RuntimeError(f'auth boundary mismatch me={mc} analyze={ac}')
cc,_,cb=raw(f'{API}/accounts/{AID}/workers/scripts/{WORKER}/content/v2',headers=AUTH,timeout=60)
if cc!=200 or BUILD.encode() not in cb:raise RuntimeError('content/v2 mismatch')

out={'schema':'musitu.fmi.flagship-app-v2.deployment.v1','gate':'FMI_FLAGSHIP_V2_READY','canonical_url':base+'/app','build':BUILD,'source_sha256':SOURCE_SHA,'authority':'PAPER_SHADOW_ONLY','model_architecture':'FEDERATED_OPEN_WEIGHT','production_model_authority':False,'live_trading_authorized':False,'trade_execution_authorized':False,'architecture_counts':{'pinned_models':9,'world_models':13,'specialists':17},'canonical_health_http':200,'upstream_health_http':(health[2].get('upstream') or {}).get('status'),'proxy_health_http':pc,'unauthenticated_me_http':mc,'unauthenticated_analysis_http':ac,'content_v2_http':cc,'static_assets':static,'state_preservation':{'d1_management_api_calls_performed':False,'customer_rows_modified':False,'billing_rows_modified':False,'payment_provider_called':False,'checkout_initiated':False,'admin_worker_modified':False,'public_edge_worker_modified':False},'certification_boundaries':{'profitability':'NOT_YET_CERTIFIED','superiority':'NOT_CERTIFIED','real_money_settlement':'NOT_CERTIFIED'}}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();pathlib.Path('fmi-flagship-v2-deployment.json').write_bytes(blob);dg=hashlib.sha256(blob).hexdigest();pathlib.Path('fmi-flagship-v2-deployment.sha256').write_text(dg+'  fmi-flagship-v2-deployment.json\n')
print(json.dumps({'gate':out['gate'],'canonical_url':out['canonical_url'],'source_sha256':SOURCE_SHA,'evidence_sha256':dg,'pinned_models':9,'world_models':13,'specialists':17},sort_keys=True))
