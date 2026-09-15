import hashlib, json, os, pathlib, secrets, subprocess, time, urllib.error, urllib.parse, urllib.request

API=os.environ.get('CF_API','https://api.cloudflare.com/client/v4').rstrip('/')
AID=os.environ['ACCOUNT_ID']; ZID=os.environ['ZONE_ID']; ZONE=os.environ['ZONE_NAME']
HOST=os.environ.get('APP_HOST','app.mftintelligence.com'); WORKER=os.environ.get('APP_WORKER','mft-fmi-app')
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
SOURCE_PATH=pathlib.Path(os.environ.get('APP_SOURCE','app/fmi_app_worker.mjs'))
SOURCE=SOURCE_PATH.read_bytes(); SOURCE_SHA=hashlib.sha256(SOURCE).hexdigest()
AUTH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-App-Deploy/1.0'}

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
    ok = c in expected if expected is not None else 200<=c<300
    if not ok:raise RuntimeError(f'Cloudflare HTTP {c}: {method} {path}: '+b[:400].decode('utf-8','ignore'))
    try:o=json.loads(b or b'{}')
    except Exception:o={}
    if isinstance(o,dict) and o.get('success') is False:raise RuntimeError('Cloudflare success=false '+path+' '+str(o.get('errors'))[:500])
    return o.get('result') if isinstance(o,dict) else None

def multipart():
    bd='----MUSITU'+secrets.token_hex(18);parts=[]
    def add(x):parts.append(x.encode() if isinstance(x,str) else x)
    meta={'main_module':'index.mjs','compatibility_date':'2026-09-15','bindings':[{'type':'plain_text','name':'PUBLIC_BASE','text':PUBLIC_BASE}]}
    add(f'--{bd}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n');add(json.dumps(meta,separators=(',',':')));add('\r\n')
    add(f'--{bd}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n');add(SOURCE);add('\r\n');add(f'--{bd}--\r\n')
    return bd,b''.join(parts)

def json_probe(url,method='GET',obj=None,headers=None,follow=True):
    h={'accept':'application/json','user-agent':'MUSITU-FMI-App-Acceptance/1.0'}
    if headers:h.update(headers)
    body=None
    if obj is not None:h['content-type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,rh,b=raw(url,method,h,body,35,follow)
    try:o=json.loads(b or b'{}')
    except Exception:o=None
    return c,rh,o,b

subprocess.run(['node','--check',str(SOURCE_PATH)],check=True)
text=SOURCE.decode('utf-8')
for required in ('MUSITU_FMI_APP_V1_20260915','/manifest.webmanifest','/sw.js','PAPER_SHADOW_ONLY','/api/v1/intelligence/analyze'):
    if required not in text:raise RuntimeError('app source invariant missing: '+required)
if 'live_trading_authorized:false' not in text.replace(' ',''):
    raise RuntimeError('authority boundary missing')

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
if not 200<=c<300:raise RuntimeError('app Worker upload HTTP '+str(c)+' '+b[:400].decode('utf-8','ignore'))
settings=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/settings') or {}
bindings={x.get('name'):x for x in settings.get('bindings') or [] if isinstance(x,dict)}
if set(bindings)!={'PUBLIC_BASE'} or bindings['PUBLIC_BASE'].get('text')!=PUBLIC_BASE:raise RuntimeError('app binding readback mismatch')

cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain','POST',{'enabled':True,'previews_enabled':False})
substate=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain') or {}
if substate.get('enabled') is not True or substate.get('previews_enabled') is not False:raise RuntimeError('app workers.dev exposure policy mismatch')
account_sub=cf(f'/accounts/{AID}/workers/subdomain') or {}
subname=str(account_sub.get('subdomain') or '')
if not subname:raise RuntimeError('workers account subdomain missing')
fallback=f'https://{WORKER}.{subname}.workers.dev'

if not matching:
    cf(f'/accounts/{AID}/workers/domains','PUT',{'hostname':HOST,'service':WORKER,'zone_id':ZID,'zone_name':ZONE,'override_existing_origin':True})
after=[d for d in (cf(f'/accounts/{AID}/workers/domains') or []) if isinstance(d,dict) and d.get('hostname')==HOST]
if len(after)!=1 or after[0].get('service')!=WORKER:raise RuntimeError('app custom-domain mapping failed')

base=fallback
health=None
for _ in range(35):
    hc,hh,ho,_=json_probe(base+'/healthz?ts='+str(time.time_ns()))
    if hc==200 and isinstance(ho,dict) and ho.get('ok') is True and ho.get('authority')=='PAPER_SHADOW_ONLY' and ((ho.get('upstream') or {}).get('status')==200):
        health=(hc,hh,ho);break
    time.sleep(1)
if health is None:raise RuntimeError('app workers.dev health acceptance failed')

static={}
for path,ctype in [('/app','text/html'),('/app.css','text/css'),('/app.js','application/javascript'),('/sw.js','application/javascript'),('/manifest.webmanifest','application/manifest+json'),('/icon.svg','image/svg+xml')]:
    sc,sh,sb=raw(base+path+'?ts='+str(time.time_ns()),headers={'user-agent':'MUSITU-FMI-App-Acceptance/1.0'},timeout=30)
    if sc!=200 or ctype not in (sh.get('content-type') or ''):raise RuntimeError(f'app asset {path} acceptance failed HTTP {sc} type={sh.get("content-type")}')
    if (sh.get('cache-control') or '').lower()!='no-store':raise RuntimeError('app asset missing no-store '+path)
    static[path]={'http':sc,'content_type':sh.get('content-type'),'bytes':len(sb)}
    if path=='/app.js' and b'MUSITU_FMI_APP_V1_20260915' not in sb:raise RuntimeError('served app.js build marker missing')
    if path=='/manifest.webmanifest':
        mo=json.loads(sb or b'{}')
        if mo.get('display')!='standalone' or mo.get('start_url')!='/app':raise RuntimeError('PWA manifest contract mismatch')

pc,_,po,_=json_probe(base+'/api/healthz?ts='+str(time.time_ns()))
if pc!=200 or not isinstance(po,dict) or po.get('status')!='ok' or po.get('authority')!='PAPER_SHADOW_ONLY':raise RuntimeError('app proxy health contract failed')
mc,_,mo,_=json_probe(base+'/api/v1/me')
if mc!=401:raise RuntimeError(f'unauthenticated app /v1/me expected 401 got {mc}')
ac,_,ao,_=json_probe(base+'/api/v1/intelligence/analyze','POST',{'symbol':'EURUSD','horizon':'NEXT_4H','returns':[0.001,-0.001]})
if ac!=401:raise RuntimeError(f'unauthenticated app analysis expected 401 got {ac}')

cc,_,cb=raw(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/content/v2',headers=AUTH,timeout=60)
if cc!=200 or b'MUSITU_FMI_APP_V1_20260915' not in cb:raise RuntimeError('app content/v2 readback mismatch')

custom={}
for path in ('/healthz','/app','/manifest.webmanifest'):
    qc,qh,qb=raw('https://'+HOST+path+'?ts='+str(time.time_ns()),headers={'user-agent':'MUSITU-FMI-App-Acceptance/1.0','accept':'*/*'},timeout=30)
    custom[path]={'http':qc,'content_type':qh.get('content-type'),'cf_mitigated':qh.get('cf-mitigated')}

out={
 'schema':'musitu.fmi.customer-app-v1.deployment.v1','gate':'FMI_CUSTOMER_APP_V1_READY','worker':WORKER,'host':HOST,'workers_dev_url':fallback,
 'source_sha256':SOURCE_SHA,'build':'MUSITU_FMI_APP_V1_20260915','upstream':PUBLIC_BASE,'workers_dev_enabled':True,'previews_enabled':False,
 'custom_domain_service':after[0].get('service'),'custom_domain_id':after[0].get('id'),'workers_dev_health_http':health[0],
 'upstream_health_http':(health[2].get('upstream') or {}).get('status'),'authority':health[2].get('authority'),'live_trading_authorized':False,
 'static_assets':static,'proxy_health_http':pc,'unauthenticated_me_http':mc,'unauthenticated_analysis_http':ac,'content_v2_http':cc,'custom_domain_probe':custom,
 'state_preservation':{'d1_api_calls_performed':False,'customer_rows_modified':False,'billing_rows_modified':False,'payment_provider_called':False,'checkout_initiated':False,'admin_worker_modified':False,'public_edge_worker_modified':False},
 'certification_boundaries':{'authority':'PAPER_SHADOW_ONLY','profitability':'NOT_YET_CERTIFIED','superiority':'NOT_CERTIFIED','real_money_settlement':'NOT_CERTIFIED'}
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();pathlib.Path('fmi-customer-app-v1-deployment.json').write_bytes(blob)
dg=hashlib.sha256(blob).hexdigest();pathlib.Path('fmi-customer-app-v1-deployment.sha256').write_text(dg+'  fmi-customer-app-v1-deployment.json\n')
print(json.dumps({'gate':out['gate'],'worker':WORKER,'host':HOST,'workers_dev_url':fallback,'workers_dev_health_http':health[0],'proxy_health_http':pc,'unauthenticated_me_http':mc,'unauthenticated_analysis_http':ac,'custom_domain_probe':custom,'source_sha256':SOURCE_SHA,'evidence_sha256':dg,'d1_api_calls_performed':False,'checkout_initiated':False},sort_keys=True))
