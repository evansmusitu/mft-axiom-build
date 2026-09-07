import {PRODUCT,RELEASE,SUPPORT} from './content.mjs';

export const INSTALL_CANONICAL_URL='https://payments.mftintelligence.com/chemistry/install';
export const INSTALL_DIAGNOSTICS_URL='https://payments.mftintelligence.com/chemistry/install/diagnostics';

const installEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function classifyInstallContext({ua='',vendor='',maxTouchPoints=0,standalone=false}={}){
  const u=String(ua).toLowerCase();
  const v=String(vendor).toLowerCase();
  const touch=Number(maxTouchPoints)||0;
  if(standalone)return 'installed';
  const iOS=/iphone|ipad|ipod/.test(u)||(/macintosh/.test(u)&&touch>1);
  const inApp=/fban|fbav|instagram|linkedinapp|twitter|micromessenger|line\//.test(u)||/\bwv\b/.test(u);
  const safari=iOS&&/safari/.test(u)&&/apple/.test(v)&&!/crios|fxios|edgios|opios|duckduckgo/.test(u)&&!inApp;
  if(iOS&&safari)return 'ios-safari';
  if(iOS)return inApp?'ios-inapp':'ios-other';
  if(/android/.test(u)&&inApp)return 'android-inapp';
  if(/android/.test(u)&&/samsungbrowser/.test(u))return 'samsung';
  if(/android/.test(u)&&/chrome|crios/.test(u)&&!/edga|opr\//.test(u))return 'android-chrome';
  if(/android/.test(u))return 'android-other';
  if(/edg\//.test(u))return 'desktop-edge';
  if(/chrome|chromium/.test(u))return 'desktop-chrome';
  return 'desktop-other';
}

function classifyServerInstallMode(ua=''){
  const u=String(ua).toLowerCase();
  const iOS=/iphone|ipad|ipod/.test(u);
  const inApp=/fban|fbav|instagram|linkedinapp|twitter|micromessenger|line\//.test(u)||/\bwv\b/.test(u);
  if(iOS&&inApp)return 'ios-inapp';
  if(iOS&&/safari/.test(u)&&!/crios|fxios|edgios|opios|duckduckgo/.test(u))return 'ios-safari';
  if(iOS)return 'ios-other';
  if(/android/.test(u)&&inApp)return 'android-inapp';
  if(/android/.test(u)&&/samsungbrowser/.test(u))return 'samsung';
  if(/android/.test(u))return 'android-ready';
  return 'desktop';
}

export const INSTALL_CONCIERGE_CSS=String.raw`
.install-concierge{min-height:68vh;display:grid;place-items:center;padding:1rem 0}
.install-card{width:min(100%,720px);border:1px solid rgba(255,255,255,.14);border-radius:24px;padding:clamp(1.25rem,4vw,2.25rem);background:#151d2d;color:#f7f9fc;box-shadow:0 24px 80px rgba(0,0,0,.22)}
.install-card h1,.install-card h2,.install-card h3{margin-top:0;color:#fff}.install-card .lead,.install-card p{color:#dbe3ef}.install-card a:not(.button){color:#dce8ff}
.install-state{display:inline-flex;align-items:center;gap:.45rem;padding:.35rem .65rem;border-radius:999px;border:1px solid rgba(255,255,255,.24);font-size:.9rem;color:#eef4ff}
.install-state.good{border-color:rgba(102,220,155,.72)}.install-state.attention{border-color:rgba(255,194,92,.72)}
[data-install-panel]{display:none}
.install-concierge[data-install-mode="installed"] [data-install-panel="installed"],
.install-concierge[data-install-mode="ios-safari"] [data-install-panel="ios-safari"],
.install-concierge[data-install-mode="ios-inapp"] [data-install-panel="ios-inapp"],
.install-concierge[data-install-mode="ios-other"] [data-install-panel="ios-other"],
.install-concierge[data-install-mode="native"] [data-install-panel="native"],
.install-concierge[data-install-mode="samsung"] [data-install-panel="samsung"],
.install-concierge[data-install-mode="android-inapp"] [data-install-panel="android-inapp"],
.install-concierge[data-install-mode="android-ready"] [data-install-panel="android-ready"],
.install-concierge[data-install-mode="android-fallback"] [data-install-panel="android-fallback"],
.install-concierge[data-install-mode="desktop"] [data-install-panel="desktop"]{display:block}
.install-actions{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.1rem}.install-actions .button{min-height:48px}
.install-quiet{margin-top:1rem;font-size:.92rem;opacity:.9}
.ios-coach{margin:1.25rem 0;border:1px solid rgba(255,255,255,.12);border-radius:22px;overflow:hidden;background:rgba(255,255,255,.04)}
.ios-screen{min-height:240px;display:grid;align-content:end;padding:1rem;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.08))}
.ios-sheet{border-radius:20px 20px 8px 8px;background:rgba(248,249,252,.98);color:#111;padding:1rem}.ios-sheet strong{display:block;margin-bottom:.35rem}
.safari-bar{display:grid;grid-template-columns:repeat(5,1fr);align-items:center;gap:.35rem;padding:.75rem;border-top:1px solid rgba(0,0,0,.12);background:#f7f7f8;color:#111}
.safari-tool{display:grid;place-items:center;min-height:44px;border-radius:12px}.safari-tool.share{outline:3px solid #246bfd;outline-offset:2px}.safari-tool svg{width:24px;height:24px}
.install-steps{display:grid;gap:.6rem;margin:1rem 0}.install-step{display:flex;gap:.7rem;align-items:flex-start;padding:.75rem;border-radius:14px;background:rgba(255,255,255,.06)}
.install-step b{display:grid;place-items:center;flex:0 0 28px;height:28px;border-radius:50%;background:rgba(255,255,255,.12)}
.install-diagnostics{display:grid;gap:.65rem;margin:1rem 0}.diag-row{display:flex;justify-content:space-between;gap:1rem;padding:.8rem;border-radius:12px;background:rgba(255,255,255,.06)}.diag-row output{font-weight:700}
.install-help-link[hidden]{display:none}.install-help-link{margin-top:1rem}
.install-onboarding{position:fixed;inset:0;z-index:9999;background:rgba(4,8,16,.94);padding:1rem;display:grid;place-items:center}.install-onboarding[hidden]{display:none}
.install-onboarding-card{width:min(100%,620px);border-radius:24px;padding:1.4rem;background:#111827;color:#f7f9fc;border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 80px rgba(0,0,0,.42)}
.install-onboarding-step[hidden]{display:none}.install-onboarding-progress{display:flex;gap:.4rem;margin:.85rem 0 1rem}.install-onboarding-progress span{height:6px;flex:1;border-radius:999px;background:rgba(255,255,255,.14)}.install-onboarding-progress span.active{background:currentColor}
@media(max-width:520px){.install-card{border-radius:18px}.install-actions{display:grid}.install-actions .button{width:100%}.ios-screen{min-height:210px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

const shareSvg=`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 16V3m0 0L8.5 6.5M12 3l3.5 3.5M5 10v9h14v-9"/></svg>`;

export const INSTALL_HANDOFF_JS=String.raw`
(()=>{
  'use strict';
  const root=document.getElementById('install-concierge');
  if(!root)return;
  const installButton=document.getElementById('install-musitu');
  const copyButtons=[...document.querySelectorAll('[data-copy-install-url]')];
  const help=document.getElementById('install-help-link');
  const status=document.querySelector('[data-install-status]');
  const emit=name=>{try{dispatchEvent(new CustomEvent('musitu:field-event',{detail:{name}}))}catch{}};
  const standalone=()=>{try{return window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches===true||navigator.standalone===true}catch{return false}};
  const ua=String(navigator.userAgent||'').toLowerCase(),vendor=String(navigator.vendor||'').toLowerCase(),touch=Number(navigator.maxTouchPoints)||0;
  const iOS=/iphone|ipad|ipod/.test(ua)||(/macintosh/.test(ua)&&touch>1);
  const inApp=/fban|fbav|instagram|linkedinapp|twitter|micromessenger|line\//.test(ua)||/\bwv\b/.test(ua);
  const safari=iOS&&/safari/.test(ua)&&/apple/.test(vendor)&&!/crios|fxios|edgios|opios|duckduckgo/.test(ua)&&!inApp;
  const samsung=/android/.test(ua)&&/samsungbrowser/.test(ua);
  const android=/android/.test(ua);
  let deferred=null;
  const mode=m=>{root.dataset.installMode=m};
  const text=s=>{if(status)status.textContent=s};
  const immediateMode=()=>standalone()?'installed':iOS?(safari?'ios-safari':inApp?'ios-inapp':'ios-other'):android?(inApp?'android-inapp':samsung?'samsung':'android-ready'):'desktop';
  mode(immediateMode());
  emit('install_view');
  if(standalone())text('MUSITU is installed on this device.');
  addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();deferred=e;mode('native');emit('install_prompt_available');
    if(installButton){installButton.hidden=false;installButton.disabled=false}
  });
  installButton?.addEventListener('click',async()=>{
    if(!deferred){mode(android?'android-ready':'desktop');if(help)help.hidden=false;emit('install_help_needed');return}
    emit('install_started');installButton.disabled=true;
    try{
      await deferred.prompt();
      const choice=await deferred.userChoice;
      if(choice?.outcome==='accepted')text('Installation accepted. Finishing setup…');
      else {text('Installation was not completed. You can continue using MUSITU now.');if(help)help.hidden=false}
    }catch{
      text('The browser install control did not open. Use the immediate fallback below.');if(help)help.hidden=false;emit('install_help_needed');
    }finally{deferred=null;installButton.disabled=false}
  });
  addEventListener('appinstalled',()=>{deferred=null;mode('installed');emit('install_completed');text('MUSITU is installed ✓')});
  addEventListener('pageshow',()=>{if(standalone())mode('installed')});
  copyButtons.forEach(btn=>btn.addEventListener('click',async()=>{
    emit('install_help_needed');
    try{await navigator.clipboard.writeText('https://payments.mftintelligence.com/chemistry/install');btn.textContent='Copied — open Safari and paste'}
    catch{btn.textContent='Open Safari and enter payments.mftintelligence.com/chemistry/install'}
  }));
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/chemistry/sw.js',{scope:'/chemistry/'}).then(r=>r.update()).catch(()=>{});
})();
`;

export const INSTALL_DIAGNOSTICS_JS=String.raw`
(()=>{
  'use strict';
  const out=(k,v,good=true)=>{const el=document.querySelector('[data-diag="'+k+'"]');if(el){el.textContent=v;el.dataset.good=good?'true':'false'}};
  const action=document.querySelector('[data-diagnostic-action]');
  const standalone=(()=>{try{return window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches===true||navigator.standalone===true}catch{return false}})();
  const ua=String(navigator.userAgent||'').toLowerCase(),vendor=String(navigator.vendor||'').toLowerCase(),touch=Number(navigator.maxTouchPoints)||0;
  const iOS=/iphone|ipad|ipod/.test(ua)||(/macintosh/.test(ua)&&touch>1);
  const inApp=/fban|fbav|instagram|linkedinapp|twitter|micromessenger|line\//.test(ua)||/\bwv\b/.test(ua);
  const safari=iOS&&/safari/.test(ua)&&/apple/.test(vendor)&&!/crios|fxios|edgios|opios|duckduckgo/.test(ua)&&!inApp;
  const family=standalone?'installed':iOS?(safari?'iOS Safari':inApp?'iOS in-app browser':'iOS non-Safari'):/samsungbrowser/.test(ua)?'Samsung Internet':/android/.test(ua)?'Android browser':/edg\//.test(ua)?'Desktop Edge':/chrome|chromium/.test(ua)?'Desktop Chrome':'Other desktop browser';
  out('browser',family);out('os',iOS?'iOS/iPadOS':/android/.test(ua)?'Android':'Desktop');out('standalone',standalone?'Yes':'No',standalone);
  out('secure',isSecureContext?'Yes':'No',isSecureContext);out('online',navigator.onLine?'Online':'Offline',navigator.onLine);
  let promptSeen=false;addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptSeen=true;out('prompt','Available',true)});
  setTimeout(()=>{if(!promptSeen)out('prompt',standalone?'Not needed':'Not exposed by this browser',standalone||iOS)},250);
  const checks=[['manifest','/chemistry/manifest.webmanifest'],['install-js','/chemistry/assets/install-handoff.js?v=4'],['css','/chemistry/assets/install-concierge.css?v=4'],['icon','/chemistry/assets/musitu-chemistry-192.png'],['rescue','/chemistry/rescue?src=direct'],['sw','/chemistry/sw.js']];
  Promise.all(checks.map(async([k,url])=>{try{const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});out(k,r.ok?'Healthy':'HTTP '+r.status,r.ok);return r.ok}catch{out(k,'Unavailable',false);return false}})).then(results=>{
    const all=results.every(Boolean);if(!action)return;
    if(!navigator.onLine)action.textContent='Reconnect to the internet, then reload this page.';
    else if(!isSecureContext)action.textContent='Open the secure HTTPS MUSITU install URL.';
    else if(iOS&&!safari)action.textContent='Open the MUSITU install URL in Safari.';
    else if(standalone)action.textContent='Installation is complete. Open Chemistry Rescue.';
    else if(!all)action.textContent='A MUSITU installation asset is unavailable. Use MUSITU in the browser now and retry installation shortly.';
    else if(iOS)action.textContent='Safari is ready. Use Share → Add to Home Screen → Open as Web App → Add.';
    else action.textContent='The installation surface is healthy. Return to Install; Chrome or Samsung will expose its trusted install control when available.';
  });
})();
`;

export const INSTALL_SW_JS=String.raw`
const CACHE='musitu-chemistry-install-v4';
const STATIC=['/chemistry/install','/chemistry/rescue?src=direct','/chemistry/assets/storefront.css?v=3','/chemistry/assets/install-concierge.css?v=4','/chemistry/assets/install-handoff.js?v=4','/chemistry/assets/musitu-chemistry-192.png','/chemistry/assets/musitu-chemistry-512.png','/chemistry/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('musitu-chemistry-install-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
const networkFirst=async req=>{try{const r=await fetch(req);if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r}catch{return await caches.match(req)}};
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;const u=new URL(req.url);
  if(u.origin!==location.origin||!u.pathname.startsWith('/chemistry/'))return;
  if(/^\/chemistry\/(checkout|return|claim|telemetry|plans)/.test(u.pathname))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(r=>{if(r.ok&&['/chemistry/install','/chemistry/rescue'].includes(u.pathname)){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r}).catch(async()=>await caches.match(req)||await caches.match('/chemistry/rescue?src=direct')));return;
  }
  if(u.pathname==='/chemistry/assets/install-handoff.js'||u.pathname==='/chemistry/assets/install-concierge.css'||u.pathname==='/chemistry/manifest.webmanifest'){event.respondWith(networkFirst(req));return}
  if(u.pathname.startsWith('/chemistry/assets/'))event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r})));
});
`;

function commonHead({title,description,robots='index,follow,max-image-preview:large'}){
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${installEsc(title)}</title><meta name="description" content="${installEsc(description)}"><meta name="robots" content="${robots}"><meta name="theme-color" content="#18223A"><link rel="manifest" href="/chemistry/manifest.webmanifest"><link rel="apple-touch-icon" href="/chemistry/assets/musitu-chemistry-192.png"><link rel="stylesheet" href="/chemistry/assets/storefront.css?v=3"><link rel="stylesheet" href="/chemistry/assets/install-concierge.css?v=4">`;
}
function header(){return `<a class="skip-link" href="#main">Skip to main content</a><header class="site-header"><div class="wrap"><nav class="nav" aria-label="Primary"><a class="brand" href="/chemistry/">MUSITU<span>EDUCATION NEXUS</span></a><div class="nav-links"><a href="/chemistry/rescue">Chemistry Rescue</a><a href="/chemistry/install" aria-current="page">Install</a><a href="/chemistry/plans">Plans</a><a href="/chemistry/support">Support</a></div></nav></div></header>`}
function footer(){return `<footer class="site-footer"><div class="wrap"><strong>${installEsc(PRODUCT.name)}</strong> · ${installEsc(PRODUCT.family)}<br><span>One universal MUSITU install URL. Device-specific guidance appears automatically.</span><div class="footer-links"><a href="/chemistry/privacy">Privacy</a><a href="/chemistry/terms">Terms</a><a href="/chemistry/support">Support</a><a href="/chemistry/verify">Verify release</a></div></div></footer>`}

export function renderInstall({userAgent=''}={}){
  const apk=`/chemistry/download/${RELEASE.apk}`;
  const initialMode=classifyServerInstallMode(userAgent);
  const chromeIntent='intent://payments.mftintelligence.com/chemistry/install#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fpayments.mftintelligence.com%2Fchemistry%2Finstall;end';
  const structured=JSON.stringify({'@context':'https://schema.org','@type':'SoftwareApplication',name:PRODUCT.name,applicationCategory:'EducationalApplication',operatingSystem:'Android, iOS, iPadOS, Web',url:INSTALL_CANONICAL_URL,softwareVersion:RELEASE.version,offers:{'@type':'Offer',price:'0',priceCurrency:'USD'}});
  return `<!doctype html><html lang="en"><head>${commonHead({title:'Get MUSITU Chemistry on this device',description:'One MUSITU install link that adapts automatically to iPhone, iPad, Android, Samsung Internet and desktop.'})}<link rel="canonical" href="${INSTALL_CANONICAL_URL}"><script type="application/ld+json">${structured}</script><script src="/chemistry/assets/web-vitals-6.0.1.iife.js" defer></script><script src="/chemistry/assets/field-experience.js?v=1" defer></script><script src="/chemistry/assets/install-handoff.js?v=4" defer></script></head><body>${header()}<main id="main" tabindex="-1"><div class="wrap"><section id="install-concierge" class="install-concierge" data-install-mode="${initialMode}" aria-live="polite">
    <article class="install-card" data-install-panel="installed"><span class="install-state good">Installed ✓</span><h1>MUSITU is installed</h1><p class="lead">You are ready. Open Chemistry Rescue and continue learning.</p><div class="install-actions"><a class="button" href="/chemistry/rescue?src=direct">Open Chemistry Rescue</a></div></article>
    <article class="install-card" data-install-panel="native"><span class="install-state good">Ready</span><h1>Install MUSITU</h1><p class="lead">Your browser is ready to install MUSITU as an app.</p><div class="install-actions"><button class="button" id="install-musitu" type="button">Install MUSITU</button><a class="button secondary" href="/chemistry/rescue?src=direct">Use MUSITU now</a></div><p class="install-quiet" data-install-status>The secure browser install confirmation opens immediately after you tap.</p></article>
    <article class="install-card" data-install-panel="android-ready"><span class="install-state good">Android · ready now</span><h1>Get MUSITU now</h1><p class="lead">No waiting screen. Open the trusted Chrome install path, or start Chemistry Rescue immediately.</p><div class="install-actions"><a class="button" href="${chromeIntent}">Open in Chrome to install</a><a class="button secondary" href="/chemistry/rescue?src=direct">Use MUSITU now</a></div><details><summary>Need the verified APK fallback?</summary><div class="install-actions"><a class="button tertiary" data-field-event="install_fallback" href="${apk}">Download verified Android APK</a></div></details></article>
    <article class="install-card" data-install-panel="ios-safari"><span class="install-state good">iPhone / iPad · Safari</span><h1>Add MUSITU as an app</h1><p class="lead">Three taps. No App Store account needed.</p><div class="ios-coach" aria-label="Safari install coach"><div class="ios-screen"><div class="ios-sheet"><strong>Add to Home Screen</strong><span>Keep “Open as Web App” enabled, then tap Add.</span></div></div><div class="safari-bar"><span class="safari-tool">‹</span><span class="safari-tool">›</span><span class="safari-tool share">${shareSvg}</span><span class="safari-tool">▣</span><span class="safari-tool">•••</span></div></div><div class="install-steps"><div class="install-step"><b>1</b><span>Tap <strong>Share</strong> in Safari.</span></div><div class="install-step"><b>2</b><span>Choose <strong>Add to Home Screen</strong> and keep <strong>Open as Web App</strong> enabled.</span></div><div class="install-step"><b>3</b><span>Tap <strong>Add</strong>. MUSITU appears on your Home Screen.</span></div></div></article>
    <article class="install-card" data-install-panel="ios-inapp"><span class="install-state attention">iPhone / iPad · in-app browser</span><h1>Open in Safari</h1><p class="lead">Safari is required for the iPhone Home Screen install control.</p><div class="install-actions"><button class="button" type="button" data-copy-install-url>Copy MUSITU link for Safari</button><a class="button secondary" href="/chemistry/rescue?src=direct">Use MUSITU now</a></div></article>
    <article class="install-card" data-install-panel="ios-other"><span class="install-state attention">iPhone / iPad</span><h1>Open in Safari</h1><p class="lead">Safari provides the reliable Home Screen app installation flow.</p><div class="install-actions"><button class="button" type="button" data-copy-install-url>Copy MUSITU link for Safari</button><a class="button secondary" href="/chemistry/rescue?src=direct">Use MUSITU now</a></div></article>
    <article class="install-card" data-install-panel="samsung"><span class="install-state good">Samsung Internet</span><h1>Add MUSITU to your phone</h1><p class="lead">Use Samsung Internet’s trusted install control. You can also start learning immediately.</p><div class="install-actions"><a class="button" href="/chemistry/rescue?src=direct">Use MUSITU now</a></div><div class="install-steps"><div class="install-step"><b>1</b><span>Open the Samsung Internet menu.</span></div><div class="install-step"><b>2</b><span>Choose <strong>Install app</strong> or <strong>Add page to Home screen</strong>.</span></div></div><details><summary>Verified Android fallback</summary><div class="install-actions"><a class="button secondary" data-field-event="install_fallback" href="${apk}">Download verified Android APK</a></div></details></article>
    <article class="install-card" data-install-panel="android-inapp"><span class="install-state attention">Android · in-app browser</span><h1>Continue in Chrome</h1><p class="lead">This embedded browser cannot expose Android’s trusted install control.</p><div class="install-actions"><a class="button" href="${chromeIntent}">Open in Chrome</a><a class="button secondary" href="/chemistry/rescue?src=direct">Use MUSITU now</a></div></article>
    <article class="install-card" data-install-panel="android-fallback"><span class="install-state attention">Android fallback</span><h1>Use MUSITU now</h1><p class="lead">Your browser did not expose its web-app install control.</p><div class="install-actions"><a class="button" href="/chemistry/rescue?src=direct">Open Chemistry Rescue</a><a class="button secondary" data-field-event="install_fallback" href="${apk}">Download verified Android APK</a></div></article>
    <article class="install-card" data-install-panel="desktop"><span class="install-state good">Ready</span><h1>Use MUSITU here</h1><p class="lead">MUSITU works immediately in this browser. If the browser supports installation, its trusted install control appears automatically.</p><div class="install-actions"><a class="button" href="/chemistry/rescue?src=direct">Open Chemistry Rescue</a></div></article>
    <p class="install-help-link" id="install-help-link" hidden><a data-field-event="install_help_needed" href="/chemistry/install/diagnostics">Installation still not working? Run MUSITU self-diagnostics.</a></p>
  </section></div></main>${footer()}</body></html>`;
}

export function renderInstallDiagnostics(){
  const rows=['browser','os','standalone','secure','online','prompt','manifest','install-js','css','icon','rescue','sw'].map(k=>`<div class="diag-row"><span>${installEsc(k.replace('-',' '))}</span><output data-diag="${k}">Checking…</output></div>`).join('');
  return `<!doctype html><html lang="en"><head>${commonHead({title:'MUSITU install diagnostics',description:'Private device-local installation diagnostics for MUSITU Chemistry.',robots:'noindex,nofollow'})}<link rel="canonical" href="${INSTALL_DIAGNOSTICS_URL}"><script src="/chemistry/assets/install-diagnostics.js?v=4" defer></script></head><body>${header()}<main id="main" tabindex="-1"><div class="wrap"><section class="install-concierge"><article class="install-card"><span class="install-state">Self-diagnostics</span><h1>MUSITU installation check</h1><p class="lead">This check runs on your device. It reports browser capability and MUSITU asset health; it does not send device identifiers.</p><div class="install-diagnostics">${rows}</div><div class="panel"><h2>Recommended next action</h2><p data-diagnostic-action>Checking…</p></div><div class="install-actions"><a class="button" href="/chemistry/install">Return to Install</a><a class="button secondary" href="/chemistry/rescue?src=direct">Use MUSITU now</a></div></article></section></div></main>${footer()}</body></html>`;
}
