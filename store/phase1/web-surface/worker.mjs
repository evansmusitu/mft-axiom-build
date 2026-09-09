import {CATALOG_RAW,CATALOG_SIG_RAW,IOS_SOURCE_RAW,WEB_ADAPTER_RAW,FDROID_INDEX_RAW,SBOM_RAW,DEPENDENCIES_RAW,CHANNELS_RAW,ROLLBACK_RAW,BOOTSTRAP_RAW,CATALOG} from './generated-data.mjs';
import {STORE_CSS} from './assets.mjs';
import {renderHome,renderApp,renderInstall,renderSearch,renderDeveloper,renderReleases,renderStatus,renderLifecycle} from './render.mjs';

const SECURITY={
  'Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; manifest-src 'self'",
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()'
};
function response(body,status=200,type='text/html; charset=utf-8',extra={}){return new Response(body,{status,headers:{...SECURITY,'Content-Type':type,...extra}})}
function exact(raw,type='application/json; charset=utf-8'){return response(raw,200,type,{'Cache-Control':'public, max-age=300'})}
function headify(req,res){return req.method==='HEAD'?new Response(null,{status:res.status,headers:res.headers}):res}
function notFound(){return response('<!doctype html><html><body><main id="main"><h1>Not found</h1><a href="/store">MUSITU Store</a></main></body></html>',404)}
function health(){return response(JSON.stringify({ok:true,service:'musitu-store',phase:'phase1',catalog_revision:CATALOG.revision,phase2_authorized:false,fresh_device_phase1_complete:false,publication_state:CATALOG.releaseControl.publicationState})+'\n',200,'application/json; charset=utf-8',{'Cache-Control':'no-store'})}

export default {async fetch(request){
  if(!['GET','HEAD'].includes(request.method)) return response('Method Not Allowed\n',405,'text/plain; charset=utf-8',{'Allow':'GET, HEAD','Cache-Control':'no-store'});
  const u=new URL(request.url); let r;
  switch(u.pathname){
    case '/store': case '/store/': r=response(renderHome(request)); break;
    case '/store/apps/chemistry': r=response(renderApp()); break;
    case '/store/install': r=response(renderInstall(request)); break;
    case '/store/open': r=Response.redirect(CATALOG.apps[0].releases[0].web.appURL,302); break;
    case '/store/update': r=response(renderLifecycle('update')); break;
    case '/store/repair': r=response(renderLifecycle('repair')); break;
    case '/store/reinstall': r=response(renderLifecycle('reinstall')); break;
    case '/store/rollback': r=response(renderLifecycle('rollback')); break;
    case '/store/transfer-device': r=response(renderLifecycle('transfer-device')); break;
    case '/store/search': r=response(renderSearch(u.searchParams.get('q')||'')); break;
    case '/store/developer': r=response(renderDeveloper()); break;
    case '/store/releases': r=response(renderReleases()); break;
    case '/store/status': r=response(renderStatus()); break;
    case '/store/healthz': r=health(); break;
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
    case '/store/assets/store.css': r=response(STORE_CSS,200,'text/css; charset=utf-8',{'Cache-Control':'public, max-age=3600'}); break;
    default: r=notFound();
  }
  return headify(request,r);
}};
