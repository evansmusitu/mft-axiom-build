import base64, gzip, json, os
from pathlib import Path

HERE = Path(__file__).resolve()
if HERE.parent.name == 'scripts':
    ASSET_DIR = HERE.parent.parent / 'app' / 'flagship'
else:
    ASSET_DIR = Path('/mnt/data/fmi_flagship/parts')
OUT = Path(os.environ.get('FLAGSHIP_WORKER_OUT', '/tmp/fmi_flagship_worker.mjs'))
parts=sorted(ASSET_DIR.glob('assets.pack.part*'))
if not parts: raise SystemExit('flagship asset pack parts missing')
pack = json.loads(''.join(p.read_text(encoding='utf-8') for p in parts))

def asset(name):
    return gzip.decompress(base64.b64decode(pack[name])).decode('utf-8')
def js(value):
    return json.dumps(value, ensure_ascii=False)

html=asset('index.html'); css=asset('app.css'); appjs=asset('app.js'); arch=asset('architecture.json')
manifest=asset('manifest.json'); icon=asset('icon.svg'); sw=asset('sw.js')
src=f'''const BUILD='MUSITU_FMI_FLAGSHIP_20260915';
const PRODUCT='MUSITU Frontier Market Intelligence';
const securityHeaders={{
'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',
'permissions-policy':'camera=(), microphone=(), geolocation=(), payment=()',
'cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin',
'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
'strict-transport-security':'max-age=31536000; includeSubDomains'}};
function reply(body,status=200,contentType='text/plain; charset=utf-8',extra={{}}){{return new Response(body,{{status,headers:{{'content-type':contentType,'cache-control':'no-store',...securityHeaders,...extra}}}})}}
function json(body,status=200,extra={{}}){{return reply(JSON.stringify(body),status,'application/json; charset=utf-8',extra)}}
const HTML={js(html)},CSS={js(css)},JS={js(appjs)},ARCH={js(arch)},MANIFEST={js(manifest)},ICON={js(icon)},SW={js(sw)};
async function proxy(request,env,url){{
 const upstream=String(env.PUBLIC_BASE||'').replace(/\\/$/,'');if(!upstream)return json({{ok:false,error:'upstream_not_configured'}},503);
 const target=new URL(upstream+url.pathname.slice(4)+url.search);const headers=new Headers(request.headers);
 for(const h of ['host','cf-connecting-ip','cf-ipcountry','cf-ray','x-forwarded-for'])headers.delete(h);
 headers.set('accept',headers.get('accept')||'application/json');headers.set('user-agent','MUSITU-FMI-Flagship/1.0');
 const init={{method:request.method,headers,redirect:'manual'}};if(!['GET','HEAD'].includes(request.method))init.body=await request.arrayBuffer();
 let r;try{{r=await fetch(target.toString(),init)}}catch{{return json({{ok:false,error:'upstream_unavailable'}},502)}}
 const rh=new Headers(r.headers);rh.delete('set-cookie');for(const [k,v] of Object.entries(securityHeaders))rh.set(k,v);rh.set('cache-control','no-store');rh.set('x-musitu-fmi-app-build',BUILD);
 return new Response(r.body,{{status:r.status,statusText:r.statusText,headers:rh}})
}}
export default{{async fetch(request,env){{
 const url=new URL(request.url);
 if(url.pathname==='/healthz'){{let upstream={{ok:false,status:null}};try{{const r=await fetch(String(env.PUBLIC_BASE).replace(/\\/$/,'')+'/healthz',{{headers:{{accept:'application/json','user-agent':'MUSITU-FMI-Flagship/1.0'}}}});upstream.status=r.status;upstream.ok=r.ok;if((r.headers.get('content-type')||'').includes('json'))upstream.body=await r.json()}}catch{{upstream.error='fetch_error'}}return json({{ok:upstream.ok,product:PRODUCT,surface:'flagship_customer_app',build:BUILD,installable:true,upstream,authority:'PAPER_SHADOW_ONLY',model_architecture:'FEDERATED_OPEN_WEIGHT',production_model_authority:false,live_trading_authorized:false,trade_execution_authorized:false}},upstream.ok?200:503)}}
 if(url.pathname.startsWith('/api/'))return proxy(request,env,url);if(request.method!=='GET')return json({{ok:false,error:'method_not_allowed'}},405);
 if(url.pathname==='/'||url.pathname==='/app'||url.pathname==='/app/')return reply(HTML,200,'text/html; charset=utf-8');
 if(url.pathname==='/app.css')return reply(CSS,200,'text/css; charset=utf-8');if(url.pathname==='/app.js')return reply(JS,200,'application/javascript; charset=utf-8');
 if(url.pathname==='/architecture.json')return reply(ARCH,200,'application/json; charset=utf-8');if(url.pathname==='/sw.js')return reply(SW,200,'application/javascript; charset=utf-8',{{'service-worker-allowed':'/'}});
 if(url.pathname==='/manifest.webmanifest')return reply(MANIFEST,200,'application/manifest+json; charset=utf-8');if(url.pathname==='/icon.svg')return reply(ICON,200,'image/svg+xml; charset=utf-8');return reply('Not found',404)
}}}};
'''
OUT.write_text(src,encoding='utf-8')
print(json.dumps({'worker':str(OUT),'bytes':len(src.encode()),'build':'MUSITU_FMI_FLAGSHIP_20260915'},sort_keys=True))
