const CACHE='axiom-interface-phase2-v1';
const SHELL=['./','./index.html','./app.js','./projects.js','./styles/tokens.css','./styles/app.css','./styles/projects.css','./manifest.webmanifest','./icons/axiom.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{ if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return; event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html')))); });
