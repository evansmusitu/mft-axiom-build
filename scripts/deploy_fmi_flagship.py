import hashlib, json, os, pathlib, secrets, subprocess, time, urllib.error, urllib.parse, urllib.request

API=os.environ.get('CF_API','https://api.cloudflare.com/client/v4').rstrip('/')
AID=os.environ['ACCOUNT_ID']; ZID=os.environ['ZONE_ID']; ZONE=os.environ['ZONE_NAME']
HOST=os.environ.get('APP_HOST','app.mftintelligence.com'); WORKER=os.environ.get('APP_WORKER','mft-fmi-app')
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
SOURCE_PATH=pathlib.Path(os.environ.get('APP_SOURCE','/tmp/fmi_flagship_worker.mjs'))
SOURCE=SOURCE_PATH.read_bytes(); SOURCE_SHA=hashlib.sha256(SOURCE).hexdigest()
AUTH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Flagship-Deploy/1.0'}
BUILD='MUSITU_FMI_FLAGSHIP_20260915'

def raw(url,method='GET',headers=None,body=None,timeout=45,follow=True):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    if follow: opener=urllib.request.build_opener()
    else:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl): return None
        opener=urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req,timeout=timeout) as r:return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e:return e.code,{k.lower():v for k,v in e.headers.items()},e.read()
    except Exception as e:return 0,{},type(e).__name__.encode()

def cf(path,method='GET',obj=None,expected=None):
    h=dict(AUTH);body=None
    if obj is not None:h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,_,b=raw(API+path,method,h,body,60)
    ok=c in expected if expected is not None else 200<=c<300
    if not ok:raise RuntimeError(f'Cloudflare HTTP {c}: {method} {path}: '+b[:500].decode('utf-8','ignore'))
    try:o=json.loads(b or b'{}')
    except Exception:o={}
    if isinstance(o,dict) and o.get('success') is False:raise RuntimeError('Cloudflare success=false '+path+' '+str(o.get('errors'))[:700])
    return o.get('result') if isinstance(o,dict) else None

def multipart():
    bd='----MUSITU'+secrets.token_hex(18);parts=[]
    def add(x):parts.append(x.encode() if isinstance(x,str) else x)
    meta={'main_module':'index.mjs','compatibility_date':'2026-09-15','bindings':[{'type':'plain_text','name':'PUBLIC_BASE','text':PUBLIC_BASE}]}
    add(f'--{bd}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n');add(json.dumps(meta,separators=(',',':')));add('\r\n')
    add(f'--{bd}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n');add(SOURCE);add('\r\n');add(f'--{bd}--\r\n')
    return bd,b''.join(parts)

def json_probe(url,method='GET',obj=None,headers=None):
    h={'accept':'application/json','user-agent':'MUSITU-FMI-Flagship-Acceptance/1.0'}
    if headers:h.update(headers)
    body=None
    if obj is not None:h['content-type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,rh,b=raw(url,method,h,body,35)
    try:o=json.loads(b or b'{}')
    except Exception:o=None
    return c,rh,o,b

subprocess.run(['node','--check',str(SOURCE_PATH)],check=True)
text=SOURCE.decode('utf-8')
for required in (BUILD,'/architecture.json','FEDERATED_OPEN_WEIGHT','PAPER_SHADOW_ONLY','/v1/intelligence/analyze','Pinned open-model federation','World Model Federation'):
    if required not in text:raise RuntimeError('flagship source invariant missing: '+required)
compact=text.replace(' ','').replace('\n','')
for required in ('live_trading_authorized:false','trade_execution_authorized:false','production_model_authority:false'):
    if required not in compact:raise RuntimeError('authority boundary missing: '+required)
if '/d1/database' in text.lower():raise RuntimeError('flagship app source must not call D1 management API')

zones=cf('/zones?name='+urllib.parse.quote(ZONE)+'&status=active') or []
if len(zones)!=1 or zones[0].get('id')!=ZID or (zones[0].get('account') or {}).get('id')!=AID:raise RuntimeError('zone/account mismatch')
domains=cf(f'/accounts/{AID}/workers/domains') or []
matching=[d for d in domains if isinstance(d,dict) and d.get('hostname')==HOST]
if len(matching)>1:raise RuntimeError('duplicate app custom-domain rows')
if matching and matching[0].get('service')!=WORKER:raise RuntimeError('app hostname belongs to another Worker')
if not matching:
    dns=cf(f'/zones/{ZID}/dns_records?name='+urllib.parse.quote(HOST)+'&per_page=100') or []
    if dns:raise RuntimeError('app hostname already has DNS records; refusing override')
    routes=cf(f'/zones/{ZID}/workers/routes') or []
    if any(HOST in str(r.get('pattern') or '') for r in routes if isinstance(r,dict)):raise RuntimeError('app hostname already appears in Worker routes')

bd,body=multipart();h=dict(AUTH);h['Content-Type']='multipart/form-data; boundary='+bd
c,_,b=raw(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}', 'PUT',h,body,60)
if not 200<=c<300:raise RuntimeError('flagship Worker upload HTTP '+str(c)+' '+b[:500].decode('utf-8','ignore'))
try:upload_obj=json.loads(b or b'{}')
except Exception:upload_obj={}
if isinstance(upload_obj,dict) and upload_obj.get('success') is False:raise RuntimeError('flagship Worker upload success=false '+str(upload_obj.get('errors'))[:700])

settings=None;err=None
for _ in range(30):
    try:settings=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/settings') or {};err=None;break
    except RuntimeError as e:
        err=e
        if 'HTTP 404' not in str(e):raise
        time.sleep(1)
if settings is None:raise RuntimeError('flagship Worker settings never became readable: '+str(err))
bindings={x.get('name'):x for x in settings.get('bindings') or [] if isinstance(x,dict)}
if set(bindings)!={'PUBLIC_BASE'} or bindings['PUBLIC_BASE'].get('text')!=PUBLIC_BASE:raise RuntimeError('flagship binding readback mismatch')

if not matching:cf(f'/accounts/{AID}/workers/domains','PUT',{'hostname':HOST,'service':WORKER,'zone_id':ZID,'zone_name':ZONE,'override_existing_origin':True})
after=[d for d in (cf(f'/accounts/{AID}/workers/domains') or []) if isinstance(d,dict) and d.get('hostname')==HOST]
if len(after)!=1 or after[0].get('service')!=WORKER:raise RuntimeError('flagship custom-domain mapping failed')
cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain','POST',{'enabled':False,'previews_enabled':False})
substate=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain') or {}
if substate.get('enabled') is not False or substate.get('previews_enabled') is not False:raise RuntimeError('workers.dev/previews not disabled')

base='https://'+HOST;health=None
for _ in range(35):
    hc,hh,ho,_=json_probe(base+'/healthz?ts='+str(time.time_ns()))
    if hc==200 and isinstance(ho,dict) and ho.get('ok') is True and ho.get('authority')=='PAPER_SHADOW_ONLY' and ho.get('model_architecture')=='FEDERATED_OPEN_WEIGHT' and ho.get('production_model_authority') is False and ho.get('live_trading_authorized') is False and ((ho.get('upstream') or {}).get('status')==200):health=(hc,hh,ho);break
    time.sleep(1)
if health is None:raise RuntimeError('canonical flagship health acceptance failed')
required_headers={'strict-transport-security','x-content-type-options','x-frame-options','content-security-policy','referrer-policy','permissions-policy'}
if not required_headers.issubset(set(health[1])):raise RuntimeError('canonical flagship security headers incomplete')

static={}
assets=[('/app','text/html'),('/app.css','text/css'),('/app.js','application/javascript'),('/sw.js','application/javascript'),('/manifest.webmanifest','application/manifest+json'),('/icon.svg','image/svg+xml'),('/architecture.json','application/json')]
for path,ctype in assets:
    accepted=None; last=None
    for _ in range(30):
        sc,sh,sb=raw(base+path+'?ts='+str(time.time_ns()),headers={'user-agent':'MUSITU-FMI-Flagship-Acceptance/1.0'},timeout=30)
        last=(sc,sh,sb)
        marker_ok=(path!='/app.js' or BUILD.encode() in sb)
        if sc==200 and ctype in (sh.get('content-type') or '') and (sh.get('cache-control') or '').lower()=='no-store' and required_headers.issubset(set(sh)) and marker_ok:
            accepted=(sc,sh,sb); break
        time.sleep(1)
    if accepted is None:
        sc,sh,sb=last or (0,{},b'')
        raise RuntimeError(f'flagship asset {path} acceptance failed after propagation wait HTTP {sc} type={sh.get("content-type")} marker={BUILD.encode() in sb}')
    sc,sh,sb=accepted
    static[path]={'http':sc,'content_type':sh.get('content-type'),'bytes':len(sb)}
    if path=='/manifest.webmanifest':
        mo=json.loads(sb or b'{}')
        if mo.get('display')!='standalone' or mo.get('start_url')!='/app' or not mo.get('icons'):raise RuntimeError('PWA manifest contract mismatch')
    if path=='/architecture.json':
        ao=json.loads(sb or b'{}')
        if ao.get('federation',{}).get('architecture')!='FEDERATED_OPEN_WEIGHT':raise RuntimeError('architecture federation contract mismatch')
        if len(ao.get('federation',{}).get('portfolio') or [])!=9:raise RuntimeError('architecture pinned portfolio count mismatch')
        if len(ao.get('worldModels') or [])!=13:raise RuntimeError('architecture world-model count mismatch')
        if len(ao.get('specialists') or [])!=17:raise RuntimeError('architecture specialist count mismatch')

pc,_,po,_=json_probe(base+'/api/healthz?ts='+str(time.time_ns()))
if pc!=200 or not isinstance(po,dict) or po.get('status')!='ok' or po.get('authority')!='PAPER_SHADOW_ONLY':raise RuntimeError('flagship proxy health contract failed')
mc,_,_,_=json_probe(base+'/api/v1/me')
if mc!=401:raise RuntimeError(f'unauthenticated flagship /v1/me expected 401 got {mc}')
ac,_,_,_=json_probe(base+'/api/v1/intelligence/analyze','POST',{'symbol':'EURUSD','horizon':'NEXT_4H','returns':[0.001,-0.001,0.0004,-0.0002,0.0006]})
if ac!=401:raise RuntimeError(f'unauthenticated flagship analysis expected 401 got {ac}')

cc,_,cb=raw(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/content/v2',headers=AUTH,timeout=60)
if cc!=200 or BUILD.encode() not in cb:raise RuntimeError('flagship content/v2 readback mismatch')

out={'schema':'musitu.fmi.flagship-app.deployment.v1','gate':'FMI_FLAGSHIP_APP_READY','worker':WORKER,'canonical_url':base+'/app','host':HOST,'source_sha256':SOURCE_SHA,'build':BUILD,'upstream':PUBLIC_BASE,'workers_dev_enabled':False,'previews_enabled':False,'custom_domain_service':after[0].get('service'),'canonical_health_http':health[0],'upstream_health_http':(health[2].get('upstream') or {}).get('status'),'authority':health[2].get('authority'),'model_architecture':health[2].get('model_architecture'),'production_model_authority':False,'live_trading_authorized':False,'trade_execution_authorized':False,'static_assets':static,'proxy_health_http':pc,'unauthenticated_me_http':mc,'unauthenticated_analysis_http':ac,'content_v2_http':cc,'architecture_counts':{'pinned_models':9,'world_models':13,'specialists':17},'state_preservation':{'d1_management_api_calls_performed':False,'customer_rows_modified':False,'billing_rows_modified':False,'payment_provider_called':False,'checkout_initiated':False,'admin_worker_modified':False,'public_edge_worker_modified':False},'certification_boundaries':{'authority':'PAPER_SHADOW_ONLY','production_model_authority':False,'profitability':'NOT_YET_CERTIFIED','superiority':'NOT_CERTIFIED','real_money_settlement':'NOT_CERTIFIED'}}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();pathlib.Path('fmi-flagship-deployment.json').write_bytes(blob)
dg=hashlib.sha256(blob).hexdigest();pathlib.Path('fmi-flagship-deployment.sha256').write_text(dg+'  fmi-flagship-deployment.json\n')
print(json.dumps({'gate':out['gate'],'canonical_url':out['canonical_url'],'health':health[0],'proxy_health':pc,'pinned_models':9,'world_models':13,'specialists':17,'source_sha256':SOURCE_SHA,'evidence_sha256':dg,'d1_management_api_calls_performed':False},sort_keys=True))
