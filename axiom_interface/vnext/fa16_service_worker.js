const CACHE_PREFIX='musitu-axiom-fa16-shell-';
const CACHE_NAME=`${CACHE_PREFIX}v1`;
const SHELL_FILES=Object.freeze([
  './index.html','./manifest.webmanifest','./styles.css','./fa14_workspace.css','./fa15_advanced_surfaces.css','./fa16_mobile_pwa.css','./axiom-icon.svg',
  './app.js','./agent_runtime_ui.js','./product_reality_ui.js','./fa14_workspace_ui.js','./fa15_advanced_surfaces_ui.js','./fa16_mobile_pwa_ui.js',
  './fa16_pwa_engine.js','./authorization_gateway.js','./capability_guard.js','./capability_registry.js','./capability_router_v2.js','./data_adapters.js',
  './data_adapters_base.js','./deep_context_adapters.js','./deep_context_security.js','./deep_context_store.js','./deep_context_ui.js',
  './engineering_command_center_adapters.js','./engineering_command_center_security.js','./engineering_command_center_store.js','./engineering_command_center_ui.js',
  './engineering_command_center_verifier.js','./engineering_workspace_runtime.js','./execution_security.js','./execution_store.js','./execution_ui.js',
  './fa14_evidence_native_engine.js','./fa15_advanced_surfaces_engine.js','./foundation_bootstrap.js','./foundation_contracts.js','./identity_session_adapter.js',
  './memory_runtime_ui.js','./mission_control_store.js','./mission_control_ui.js','./mission_control_verifier.js','./product_reality_adapters.js',
  './product_reality_security.js','./product_reality_store.js','./product_reality_verifier.js','./project_work_memory_bridge.js','./provenance_verifier.js','./system_graph.js'
]);
const SENSITIVE_PATH=/(?:^|\/)(?:api|mcp|auth|oauth|session|sessions|billing|health|admin|enterprise|secrets?)(?:\/|$)/i;
const SHELL_URLS=new Set(SHELL_FILES.map(path=>new URL(path,self.registration.scope).toString()));

function cacheable(response){
  if(!response||!response.ok)return false;
  const control=response.headers.get('Cache-Control')||'';
  const vary=response.headers.get('Vary')||'';
  return !/(?:no-store|private)/i.test(control)&&!/(?:authorization|cookie)/i.test(vary)&&!response.headers.has('Set-Cookie');
}

async function precache(){
  const cache=await caches.open(CACHE_NAME);
  await cache.addAll(SHELL_FILES.map(path=>new URL(path,self.registration.scope).toString()));
}

self.addEventListener('install',event=>{event.waitUntil(precache());});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='AXIOM_FA16_ACTIVATE_UPDATE')self.skipWaiting();
});

async function navigationResponse(request){
  try{
    return await fetch(request);
  }catch{
    const shell=await caches.match(new URL('./index.html',self.registration.scope).toString());
    return shell||Response.error();
  }
}

async function staticResponse(request){
  const cached=await caches.match(request,{ignoreSearch:false});
  if(cached)return cached;
  const live=await fetch(request);
  if(cacheable(live)){const cache=await caches.open(CACHE_NAME);await cache.put(request,live.clone());}
  return live;
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||SENSITIVE_PATH.test(url.pathname))return;
  if(request.mode==='navigate'){event.respondWith(navigationResponse(request));return;}
  if(SHELL_URLS.has(url.toString())&&['script','style','image','font','manifest'].includes(request.destination))event.respondWith(staticResponse(request));
});
