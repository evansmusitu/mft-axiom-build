// Dedicated offline shell for the installed MUSITU Chemistry experience.
// Payment, entitlement and telemetry routes remain network/server authoritative.
export const INSTALL_SW_V5_JS=String.raw`
const CACHE='musitu-chemistry-install-v8';
const APP='/chemistry/app';
const RESCUE='/chemistry/rescue?src=direct';
const INSTALL='/chemistry/install';
const STATIC=[
  APP,
  '/chemistry/app?view=rescue',
  '/chemistry/app?view=exam',
  '/chemistry/app?view=premium',
  '/chemistry/app?view=help',
  RESCUE,
  INSTALL,
  '/chemistry/assets/app-shell.css?v=4',
  '/chemistry/assets/app-shell.js?v=4',
  '/chemistry/assets/app-bridge.js?v=1',
  '/chemistry/assets/storefront.css?v=3',
  '/chemistry/assets/install-concierge.css?v=4',
  '/chemistry/assets/install-handoff.js?v=4',
  '/chemistry/assets/musitu-chemistry-192.png',
  '/chemistry/assets/musitu-chemistry-512.png',
  '/chemistry/manifest.webmanifest?v=2'
];
const SENSITIVE=/^\/chemistry\/(checkout|return|claim|telemetry|plans)(?:\/|$)/;
const cachePut=async(req,res)=>{
  if(res&&res.ok){const c=await caches.open(CACHE);await c.put(req,res.clone())}
  return res;
};
const networkFirst=async(req,fallback)=>{
  try{return await cachePut(req,await fetch(req))}
  catch{return await caches.match(req)||await caches.match(fallback)}
};
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('musitu-chemistry-install-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const u=new URL(req.url);
  if(u.origin!==location.origin||!u.pathname.startsWith('/chemistry/'))return;
  if(SENSITIVE.test(u.pathname))return;

  if(req.mode==='navigate'){
    if(u.pathname==='/chemistry/app'){
      event.respondWith(networkFirst(req,APP));
      return;
    }
    if(u.pathname==='/chemistry/rescue'){
      event.respondWith(networkFirst(req,RESCUE));
      return;
    }
    if(u.pathname==='/chemistry/install'){
      event.respondWith(networkFirst(req,INSTALL));
      return;
    }
    return;
  }

  if(
    u.pathname==='/chemistry/assets/app-shell.js'||
    u.pathname==='/chemistry/assets/app-shell.css'||
    u.pathname==='/chemistry/assets/app-bridge.js'||
    u.pathname==='/chemistry/assets/install-handoff.js'||
    u.pathname==='/chemistry/assets/install-concierge.css'||
    u.pathname==='/chemistry/manifest.webmanifest'
  ){
    event.respondWith(networkFirst(req,req));
    return;
  }

  if(u.pathname.startsWith('/chemistry/assets/')){
    event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>cachePut(req,r))));
  }
});
`;
