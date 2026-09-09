import {CATALOG_RAW,CATALOG_SIG_RAW,IOS_SOURCE_RAW,WEB_ADAPTER_RAW,FDROID_INDEX_RAW,SBOM_RAW,DEPENDENCIES_RAW,CHANNELS_RAW,ROLLBACK_RAW,BOOTSTRAP_RAW,CATALOG} from './generated-data.mjs';
import {STORE_CSS} from './assets.mjs';
import {renderHome,renderApp,renderInstall,renderSearch,renderDeveloper,renderReleases,renderStatus,renderLifecycle} from './render.mjs';

const SECURITY={
  'Content-Security-Policy':"default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; manifest-src 'self'",
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()'
};
const LOCALES={default:'en',supported:['en','sn','nd']};
const HOME_TITLE={en:'Install MUSITU with release truth you can verify.',sn:'Isa MUSITU nezvokwadi yekuburitswa yaunogona kuongorora.',nd:'Faka i-MUSITU ngeqiniso lokukhutshwa ongalihlola.'};
const MANIFEST_RAW=JSON.stringify({name:'MUSITU Store',short_name:'MUSITU Store',id:'/store/',scope:'/store/',start_url:'/store',display:'standalone',background_color:'#f6f7fb',theme_color:'#0f172a',description:'Verified MUSITU software distribution.'})+'\n';
const STORE_JS=String.raw`'use strict';
if ('serviceWorker' in navigator) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/store/sw.js',{scope:'/store/'}).catch(()=>{});
  });
}
`;
const STORE_SW=String.raw`'use strict';
const CACHE='musitu-store-r1';
const PUBLIC_SHELL=['/store','/store/offline','/store/assets/store.css','/store/assets/store.js','/store/manifest.webmanifest','/store/catalog.json','/store/catalog.sig'];
const CACHEABLE=new Set(PUBLIC_SHELL);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if (request.method !== 'GET') return;
  const url=new URL(request.url);
  if (url.origin!==self.location.origin || !CACHEABLE.has(url.pathname)) return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));}
    return response;
  }).catch(()=>caches.match(request).then(hit=>hit||caches.match('/store/offline'))));
});
`;
const RELEASE_ASSETS={
  '/store/bootstrap/MUSITU_Store_1.0.1.apk':{key:'bootstrap/MUSITU_Store_1.0.1.apk',sha256:'b755210f303ebb6d22a3177bb21e5ebae2e076901021ee62ca2fe6ab0f14af82',bytes:1679572,type:'application/vnd.android.package-archive',name:'MUSITU_Store_1.0.1.apk'},
  '/store/bootstrap/MUSITU_Store_1.0.0.apk':{key:'bootstrap/MUSITU_Store_1.0.0.apk',sha256:'71391bf614cc1186cbe1fda17e9e626aad71d96dbf26807228b73bd2ea99b2f8',bytes:1687882,type:'application/vnd.android.package-archive',name:'MUSITU_Store_1.0.0.apk'},
  '/store/ios/MUSITU_Chemistry_1.3.0.ipa':{key:'ios/MUSITU_Chemistry_1.3.0.ipa',sha256:'426d2dc05e2fc8846a7582324d953bbdd2a256f170f8db2b5a956bc1c51cc962',bytes:3640968,type:'application/octet-stream',name:'MUSITU_Chemistry_1.3.0.ipa'},
  '/store/android/repo/MUSITU_Chemistry_Mastery_1.3.0.apk':{key:'android/MUSITU_Chemistry_Mastery_1.3.0.apk',sha256:'4ba442122d9c86a0c3cef660334fe337c6ea9ae6fe853c964b5e94961245babd',bytes:5892286,type:'application/vnd.android.package-archive',name:'MUSITU_Chemistry_Mastery_1.3.0.apk'}
};
function response(body,status=200,type='text/html; charset=utf-8',extra={}){return new Response(body,{status,headers:{...SECURITY,'Content-Type':type,...extra}})}
function exact(raw,type='application/json; charset=utf-8'){return response(raw,200,type,{'Cache-Control':'public, max-age=300'})}
function headify(req,res){return req.method==='HEAD'?new Response(null,{status:res.status,headers:res.headers}):res}
function notFound(){return response('<!doctype html><html><body><main id="main"><h1>Not found</h1><a href="/store">MUSITU Store</a></main></body></html>',404)}
function runtimePublicationState(env){return env?.STORE_RUNTIME_PUBLICATION_STATE==='production'?'production':CATALOG.releaseControl.publicationState}
function health(env){
  const runtime=runtimePublicationState(env);
  return response(JSON.stringify({ok:true,service:'musitu-store',phase:'phase1',catalog_revision:CATALOG.revision,catalog_publication_state:CATALOG.releaseControl.publicationState,runtime_publication_state:runtime,production_deployed:runtime==='production',phase2_authorized:false,fresh_device_phase1_complete:false})+'\n',200,'application/json; charset=utf-8',{'Cache-Control':'no-store'});
}
function runtimeLabeledPage(html,env,kind){
  const runtime=runtimePublicationState(env); const snapshot=CATALOG.releaseControl.publicationState;
  if(kind==='developer'){
    const old=`<p><strong>publication state</strong> ${snapshot}</p>`;
    const next=`<p><strong>Signed catalog snapshot</strong> ${snapshot}</p><p><strong>Runtime deployment</strong> ${runtime}</p>`;
    return html.replace(old,next);
  }
  if(kind==='status'){
    const marker='<h1>Release status</h1>';
    const notice=`${marker}<div class="notice"><strong>Runtime deployment</strong> ${runtime} · <strong>Signed catalog snapshot</strong> ${snapshot}</div>`;
    return html.replace(marker,notice);
  }
  return html;
}
function localeFor(request){
  const u=new URL(request.url); const q=(u.searchParams.get('lang')||'').toLowerCase();
  if(LOCALES.supported.includes(q)) return q;
  const header=(request.headers.get('accept-language')||'').toLowerCase();
  for(const token of header.split(',')){const base=token.trim().split(';')[0].split('-')[0];if(LOCALES.supported.includes(base)) return base;}
  return LOCALES.default;
}
function installShellAssets(html,lang){
  let out=html.replace(/<html lang="[^"]+">/,`<html lang="${lang}">`);
  if(!out.includes('/store/manifest.webmanifest')) out=out.replace('</head>','<link rel="manifest" href="/store/manifest.webmanifest"><script src="/store/assets/store.js" defer></script></head>');
  return out;
}
function htmlResponse(request,html,lang=localeFor(request),extra={}){return response(installShellAssets(html,lang),200,'text/html; charset=utf-8',{'Content-Language':lang,'Vary':'Save-Data, Accept-Language',...extra})}
function liteHome(lang){
  const title=HOME_TITLE[lang]||HOME_TITLE.en;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MUSITU Store</title><link rel="stylesheet" href="/store/assets/store.css"></head><body><a class="skip-link" href="#main">Skip to main content</a><main id="main" tabindex="-1" class="page"><div class="wrap"><span class="eyebrow">Low-bandwidth mode</span><h1>${title}</h1><p>MUSITU Chemistry 1.3.0 · verified stable release.</p><div class="actions"><a class="button" href="/store/install">Install</a><a class="button secondary" href="/store/apps/chemistry">Details</a></div><p class="micro"><a href="/store/offline">Offline &amp; recovery</a></p></div></main></body></html>`;
}
function homeResponse(request){
  const u=new URL(request.url); const lang=localeFor(request); const lite=u.searchParams.get('lite')==='1'||(request.headers.get('save-data')||'').toLowerCase()==='on';
  if(lite) return htmlResponse(request,liteHome(lang),lang,{'Cache-Control':'private, max-age=0'});
  let html=renderHome(request).replace('Install MUSITU with release truth you can verify.',HOME_TITLE[lang]||HOME_TITLE.en);
  return htmlResponse(request,html,lang);
}
function offlinePage(){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline & recovery · MUSITU Store</title><link rel="stylesheet" href="/store/assets/store.css"></head><body><a class="skip-link" href="#main">Skip to main content</a><main id="main" tabindex="-1" class="page"><div class="wrap"><h1>Offline &amp; recovery</h1><p>The public Store shell can use a cached catalog only with its detached signature. Verify <a href="/store/catalog.json">/store/catalog.json</a> together with <a href="/store/catalog.sig">/store/catalog.sig</a>.</p><p>Android recovery resumes interrupted downloads and rejects a release when its expected size, SHA-256, package identity or signing certificate does not match.</p><p>Repair or reinstall does not create Premium entitlement; commerce and entitlement remain separate from software distribution.</p></div></main></body></html>`}
async function sha256Hex(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
async function releaseAsset(env,spec){
  if(!env||!env.STORE_RELEASES||typeof env.STORE_RELEASES.get!=='function') return response('Release asset unavailable\n',503,'text/plain; charset=utf-8',{'Cache-Control':'no-store'});
  let object; try{object=await env.STORE_RELEASES.get(spec.key);}catch{return response('Release asset unavailable\n',503,'text/plain; charset=utf-8',{'Cache-Control':'no-store'});}
  if(!object) return response('Release asset unavailable\n',503,'text/plain; charset=utf-8',{'Cache-Control':'no-store'});
  let bytes; try{bytes=await object.arrayBuffer();}catch{return response('Release asset unavailable\n',503,'text/plain; charset=utf-8',{'Cache-Control':'no-store'});}
  if(bytes.byteLength!==spec.bytes || (await sha256Hex(bytes))!==spec.sha256) return response('Release asset unavailable: integrity verification failed\n',503,'text/plain; charset=utf-8',{'Cache-Control':'no-store'});
  return response(bytes,200,spec.type,{'Cache-Control':'public, max-age=31536000, immutable','Content-Length':String(spec.bytes),'Content-Disposition':`attachment; filename="${spec.name}"`,'X-Content-SHA256':spec.sha256});
}

export default {async fetch(request,env){
  if(!['GET','HEAD'].includes(request.method)) return response('Method Not Allowed\n',405,'text/plain; charset=utf-8',{'Allow':'GET, HEAD','Cache-Control':'no-store'});
  const u=new URL(request.url); let r;
  if(RELEASE_ASSETS[u.pathname]) r=await releaseAsset(env,RELEASE_ASSETS[u.pathname]);
  else switch(u.pathname){
    case '/store': case '/store/': r=homeResponse(request); break;
    case '/store/apps/chemistry': r=htmlResponse(request,renderApp()); break;
    case '/store/install': r=htmlResponse(request,renderInstall(request)); break;
    case '/store/open': r=Response.redirect(CATALOG.apps[0].releases[0].web.appURL,302); break;
    case '/store/update': r=htmlResponse(request,renderLifecycle('update')); break;
    case '/store/repair': r=htmlResponse(request,renderLifecycle('repair')); break;
    case '/store/reinstall': r=htmlResponse(request,renderLifecycle('reinstall')); break;
    case '/store/rollback': r=htmlResponse(request,renderLifecycle('rollback')); break;
    case '/store/transfer-device': r=htmlResponse(request,renderLifecycle('transfer-device')); break;
    case '/store/search': r=htmlResponse(request,renderSearch(u.searchParams.get('q')||'')); break;
    case '/store/developer': r=htmlResponse(request,runtimeLabeledPage(renderDeveloper(),env,'developer')); break;
    case '/store/releases': r=htmlResponse(request,renderReleases()); break;
    case '/store/status': r=htmlResponse(request,runtimeLabeledPage(renderStatus(),env,'status')); break;
    case '/store/offline': r=htmlResponse(request,offlinePage()); break;
    case '/store/healthz': r=health(env); break;
    case '/store/catalog.json': r=exact(CATALOG_RAW); break;
    case '/store/catalog.sig': r=exact(CATALOG_SIG_RAW,'text/plain; charset=utf-8'); break;
    case '/store/ios/source.json': r=exact(IOS_SOURCE_RAW); break;
    case '/store/web/adapter.json': r=exact(WEB_ADAPTER_RAW); break;
    case '/store/android/repo/index-v1.json': r=exact(FDROID_INDEX_RAW); break;
    case '/store/apps/chemistry/sbom.json': r=exact(SBOM_RAW); break;
    case '/store/apps/chemistry/dependencies.json': r=exact(DEPENDENCIES_RAW); break;
    case '/store/release/channels.json': r=exact(CHANNELS_RAW); break;
    case '/store/release/rollback-control.json': r=exact(ROLLBACK_RAW); break;
    case '/store/bootstrap/release.json': r=exact(BOOTSTRAP_RAW); break;
    case '/store/locales.json': r=exact(JSON.stringify(LOCALES)+'\n'); break;
    case '/store/manifest.webmanifest': r=response(MANIFEST_RAW,200,'application/manifest+json; charset=utf-8',{'Cache-Control':'public, max-age=3600'}); break;
    case '/store/sw.js': r=response(STORE_SW,200,'application/javascript; charset=utf-8',{'Cache-Control':'no-cache'}); break;
    case '/store/assets/store.js': r=response(STORE_JS,200,'application/javascript; charset=utf-8',{'Cache-Control':'public, max-age=3600'}); break;
    case '/store/assets/store.css': r=response(STORE_CSS,200,'text/css; charset=utf-8',{'Cache-Control':'public, max-age=3600'}); break;
    default: r=notFound();
  }
  return headify(request,r);
}};
