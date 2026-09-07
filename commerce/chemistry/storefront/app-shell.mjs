import {PRODUCT,SUPPORT,PREMIUM_FEATURES} from './content.mjs';

const APP_URL='https://payments.mftintelligence.com/chemistry/app';
const APP_VIEWS=new Set(['home','rescue','premium','help']);
const appEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalizeAppView=v=>APP_VIEWS.has(String(v||'').toLowerCase())?String(v||'').toLowerCase():'home';

export const APP_BRIDGE_JS="(()=>{'use strict';try{const installed=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches===true)||navigator.standalone===true;if(installed&&location.pathname==='/chemistry/rescue')location.replace('/chemistry/app');}catch{}})();";

export const APP_SHELL_JS=String.raw`
(()=>{
  'use strict';
  const root=document.documentElement;
  const installed=()=>{try{return window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches===true||navigator.standalone===true}catch{return false}};
  const state=document.querySelector('[data-app-install-state]');
  const APP_CACHE='musitu-chemistry-app-shell-v3';
  const APP_STATIC=[
    '/chemistry/app',
    '/chemistry/app?view=rescue',
    '/chemistry/app?view=premium',
    '/chemistry/app?view=help',
    '/chemistry/assets/app-shell.css?v=3',
    '/chemistry/assets/app-shell.js?v=3',
    '/chemistry/assets/musitu-chemistry-192.png',
    '/chemistry/assets/musitu-chemistry-512.png',
    '/chemistry/manifest.webmanifest'
  ];
  const paintState=()=>{
    root.dataset.appMode=installed()?'installed':'browser';
    if(state)state.textContent=installed()?(navigator.onLine?'Installed':'Offline ready'):'Web preview';
  };
  const primeOfflineShell=async()=>{
    if(!('caches' in window)||!navigator.onLine)return false;
    try{
      const cache=await caches.open(APP_CACHE);
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('musitu-chemistry-app-shell-')&&k!==APP_CACHE).map(k=>caches.delete(k)));
      const results=await Promise.all(APP_STATIC.map(async url=>{
        try{
          const response=await fetch(url,{cache:'reload',credentials:'same-origin'});
          if(!response.ok)return false;
          await cache.put(url,response.clone());
          return true;
        }catch{return false}
      }));
      return results.every(Boolean);
    }catch{return false}
  };
  paintState();
  addEventListener('online',()=>{paintState();primeOfflineShell()});
  addEventListener('offline',paintState);
  const overlay=document.getElementById('app-onboarding');
  const steps=[...document.querySelectorAll('[data-app-onboarding-step]')];
  const dots=[...document.querySelectorAll('[data-app-onboarding-dot]')];
  const next=document.getElementById('app-onboarding-next');
  const skip=document.getElementById('app-onboarding-skip');
  const KEY='musitu_chem_onboarding_v1';
  let index=0;
  const show=i=>{index=Math.max(0,Math.min(i,steps.length-1));steps.forEach((el,n)=>el.hidden=n!==index);dots.forEach((el,n)=>el.classList.toggle('active',n===index));if(next)next.textContent=index===steps.length-1?'Enter MUSITU':'Next'};
  const done=()=>{try{localStorage.setItem(KEY,'1')}catch{}if(overlay)overlay.hidden=true};
  let seen=false;try{seen=localStorage.getItem(KEY)==='1'}catch{}
  if(overlay){overlay.hidden=seen;show(0)}
  next?.addEventListener('click',()=>{if(index>=steps.length-1)done();else show(index+1)});
  skip?.addEventListener('click',done);
  document.querySelectorAll('[data-app-jump]').forEach(a=>a.addEventListener('click',e=>{const target=document.querySelector(a.getAttribute('href'));if(target){e.preventDefault();target.scrollIntoView({behavior:'smooth',block:'start'})}}));
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/chemistry/sw.js',{scope:'/chemistry/'}).then(r=>r.update()).catch(()=>{});
  primeOfflineShell();
})();
`;

export const APP_SHELL_CSS=String.raw`
:root{background:#07101f;color:#f7f9fc;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#07101f;color:#f7f9fc}body{min-height:100dvh;padding-bottom:calc(82px + env(safe-area-inset-bottom))}a{color:inherit;text-decoration:none}button{font:inherit}
.app-shell{min-height:100dvh;background:radial-gradient(circle at top right,rgba(56,106,255,.18),transparent 34%),#07101f}.app-topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:calc(.85rem + env(safe-area-inset-top)) 1rem .85rem;background:rgba(7,16,31,.88);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.08)}.app-brand{display:flex;align-items:center;gap:.75rem;min-width:0}.app-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:linear-gradient(145deg,#223255,#111a2d);border:1px solid rgba(255,255,255,.16);font-weight:900;font-size:1.15rem}.app-brand-copy{min-width:0}.app-brand-copy strong{display:block;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.app-brand-copy span{display:block;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#97a6bc}.app-state{flex:none;padding:.38rem .65rem;border-radius:999px;background:rgba(95,215,156,.12);border:1px solid rgba(95,215,156,.35);color:#baf4d2;font-size:.78rem;font-weight:800}
.app-main{width:min(100%,760px);margin:0 auto;padding:1rem}.app-hero{padding:1.3rem 0 1rem}.app-eyebrow{display:inline-flex;align-items:center;gap:.45rem;font-size:.78rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:#9fb2d0}.app-hero h1{font-size:clamp(2rem,9vw,3.7rem);line-height:.98;margin:.65rem 0 .8rem;letter-spacing:-.045em}.app-hero p{margin:0;color:#bcc9dc;font-size:1.03rem;line-height:1.55}.app-primary{display:flex;align-items:center;justify-content:center;min-height:54px;padding:.9rem 1rem;margin-top:1.15rem;border-radius:16px;background:#f7f9fc;color:#07101f;font-weight:900;box-shadow:0 10px 30px rgba(0,0,0,.22)}
.app-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;margin:1rem 0 1.2rem}.app-stat{padding:1rem .8rem;border-radius:18px;background:#101a2c;border:1px solid rgba(255,255,255,.08)}.app-stat b{display:block;font-size:1.1rem}.app-stat span{display:block;margin-top:.25rem;color:#8fa0b9;font-size:.8rem;line-height:1.25}
.app-section{scroll-margin-top:94px;margin:1rem 0 1.5rem}.app-section-head{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:.8rem}.app-section-head h2{margin:0;font-size:1.25rem}.app-section-head p{margin:0;color:#8798b2;font-size:.82rem}.app-card{border:1px solid rgba(255,255,255,.09);border-radius:22px;background:#101a2c;overflow:hidden}.app-card-row{display:flex;gap:1rem;align-items:flex-start;padding:1rem;border-bottom:1px solid rgba(255,255,255,.07)}.app-card-row:last-child{border-bottom:0}.app-step{display:grid;place-items:center;flex:0 0 42px;height:42px;border-radius:14px;background:#1a2943;color:#dce8ff;font-weight:900}.app-card-row h3{margin:.05rem 0 .25rem;font-size:1rem}.app-card-row p{margin:0;color:#9eacc0;line-height:1.45;font-size:.9rem}.app-actions{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.8rem}.app-action{display:flex;align-items:center;justify-content:center;min-height:50px;padding:.8rem;border-radius:15px;background:#16233a;border:1px solid rgba(255,255,255,.09);font-weight:800;text-align:center}.app-action.primary{background:#eaf0ff;color:#091324}.app-action small{font-weight:600;color:#92a2b8}
.app-note{padding:1rem;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:#9eacc0;font-size:.86rem;line-height:1.5}.app-note strong{color:#edf3ff}.app-list{margin:.25rem 0 0;padding:0;list-style:none}.app-list li{padding:.85rem 0;border-bottom:1px solid rgba(255,255,255,.07);color:#b7c4d7;line-height:1.4}.app-list li:last-child{border-bottom:0}.app-list li::before{content:"✓";display:inline-block;margin-right:.6rem;color:#8fe0b4;font-weight:900}.app-contact{margin-top:.85rem;padding:1rem;border-radius:18px;background:#101a2c;border:1px solid rgba(255,255,255,.08)}.app-contact h3{margin:0 0 .35rem}.app-contact p{margin:.25rem 0;color:#9eacc0;line-height:1.45}.app-online-note{display:inline-flex;margin-top:.7rem;padding:.35rem .55rem;border-radius:999px;background:#17243a;color:#aebbd0;font-size:.75rem;font-weight:800}
.app-nav{position:fixed;left:0;right:0;bottom:0;z-index:50;display:grid;grid-template-columns:repeat(4,1fr);padding:.55rem .55rem calc(.55rem + env(safe-area-inset-bottom));background:rgba(8,16,30,.94);backdrop-filter:blur(20px);border-top:1px solid rgba(255,255,255,.09)}.app-nav a{display:grid;place-items:center;gap:.25rem;min-height:52px;border-radius:14px;color:#8d9cb2;font-size:.7rem;font-weight:800}.app-nav a[aria-current="page"]{background:#15223a;color:#fff}.app-nav b{font-size:1.1rem;line-height:1}
.app-onboarding{position:fixed;inset:0;z-index:100;background:rgba(2,7,15,.96);display:grid;place-items:center;padding:1rem}.app-onboarding[hidden]{display:none}.app-onboarding-card{width:min(100%,520px);padding:1.4rem;border-radius:26px;background:#0f192a;border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 90px rgba(0,0,0,.48)}.app-onboarding-step{min-height:210px}.app-onboarding-step[hidden]{display:none}.app-onboarding-kicker{color:#8ea5ca;font-weight:900;letter-spacing:.12em;text-transform:uppercase;font-size:.75rem}.app-onboarding-step h2{font-size:2rem;margin:.5rem 0 .6rem}.app-onboarding-step p{color:#aebbd0;line-height:1.55}.app-dots{display:flex;gap:.4rem;margin:1rem 0}.app-dots span{height:5px;flex:1;border-radius:999px;background:#27344a}.app-dots span.active{background:#eef3ff}.app-onboarding-actions{display:grid;grid-template-columns:1fr 2fr;gap:.7rem}.app-onboarding-actions button{min-height:50px;border:0;border-radius:15px;font-weight:900}.app-onboarding-actions .skip{background:#17243a;color:#cbd6e6}.app-onboarding-actions .next{background:#f4f7fb;color:#09111f}
@media(max-width:520px){.app-grid{gap:.5rem}.app-stat{padding:.85rem .65rem}.app-stat b{font-size:1rem}.app-actions{grid-template-columns:1fr}.app-brand-copy span{font-size:.65rem}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}.app-topbar,.app-nav{backdrop-filter:none}}
`;

function nav(view){
  const item=(id,href,icon,label)=>`<a href="${href}"${view===id?' aria-current="page"':''}><b>${icon}</b><span>${label}</span></a>`;
  return `<nav class="app-nav" aria-label="App navigation">${item('home','/chemistry/app','⌂','Home')}${item('rescue','/chemistry/app?view=rescue','◫','Rescue')}${item('premium','/chemistry/app?view=premium','◇','Premium')}${item('help','/chemistry/app?view=help','?','Help')}</nav>`;
}

function homeView(){
  return `<section class="app-hero"><span class="app-eyebrow">Chemistry Rescue 2026</span><h1>Your Chemistry workspace.</h1><p>One focused place to find what needs attention, revise deliberately, and prepare for exam pressure — without the public website chrome.</p><a class="app-primary" href="/chemistry/app?view=rescue">Continue Chemistry Rescue</a></section><section class="app-grid" aria-label="MUSITU rescue method"><article class="app-stat"><b>01</b><span>Diagnose what needs attention</span></article><article class="app-stat"><b>02</b><span>Revise with focus</span></article><article class="app-stat"><b>03</b><span>Prove under pressure</span></article></section><section class="app-section"><div class="app-section-head"><h2>Quick access</h2><p>Stay inside MUSITU</p></div><div class="app-actions"><a class="app-action primary" href="/chemistry/app?view=rescue">Continue Rescue</a><a class="app-action" href="/chemistry/app?view=premium">Premium options</a><a class="app-action" href="/chemistry/app?view=help">Help &amp; support</a><a class="app-action" href="/chemistry/verify">Verify release</a></div></section><p class="app-note"><strong>Installed app mode:</strong> MUSITU runs from the same secure web origin, but the installed launch surface is separated from the public marketing site. Premium, Help and Rescue navigation stay inside the installed app surface. Payment and entitlement remain server-authoritative.</p>`;
}

function rescueView(){
  return `<section class="app-hero"><span class="app-eyebrow">Free entry</span><h1>Chemistry Rescue.</h1><p>Use the same three-step loop every time: diagnose the gap, revise with focus, then prove what survives exam pressure.</p></section><section class="app-section" id="rescue"><div class="app-section-head"><h2>Your Rescue loop</h2><p>Free entry</p></div><div class="app-card"><article class="app-card-row"><span class="app-step">1</span><div><h3>Diagnose</h3><p>Identify the Chemistry areas that deserve attention instead of revising every topic equally.</p></div></article><article class="app-card-row"><span class="app-step">2</span><div><h3>Revise</h3><p>Work through targeted revision deliberately. Free access remains available without payment.</p></div></article><article class="app-card-row"><span class="app-step">3</span><div><h3>Prove</h3><p>Use exam-style and timed practice to expose what still breaks under pressure.</p></div></article></div><div class="app-actions"><a class="app-action" href="/chemistry/app">Back home</a><a class="app-action" href="/chemistry/app?view=premium">See Premium</a></div></section>`;
}

function premiumView(){
  const features=PREMIUM_FEATURES.map(x=>`<li>${appEsc(x)}</li>`).join('');
  return `<section class="app-hero"><span class="app-eyebrow">Premium</span><h1>Unlock full mastery.</h1><p>Premium adds the complete Chemistry learning and exam-preparation workflow while keeping payment verification outside the offline shell.</p></section><section class="app-section"><div class="app-section-head"><h2>Premium includes</h2><p>No paid access preselected</p></div><div class="app-card"><div class="app-card-row"><div><ul class="app-list">${features}</ul></div></div></div><span class="app-online-note">Internet required to view current secure prices and purchase</span><div class="app-actions"><a class="app-action primary" href="/chemistry/plans">View secure plan options</a><a class="app-action" href="/chemistry/app?view=help">Need help first?</a></div></section><p class="app-note"><strong>Payment boundary:</strong> this installed page contains no cached price or entitlement decision. Current pricing, checkout, settlement verification and Premium issuance remain server-authoritative.</p>`;
}

function helpView(){
  return `<section class="app-hero"><span class="app-eyebrow">Help</span><h1>Help without leaving MUSITU.</h1><p>Use these recovery steps first. Support links only leave the app when you deliberately choose an external contact or secure web action.</p></section><section class="app-section"><div class="app-section-head"><h2>Quick recovery</h2><p>Safe first steps</p></div><div class="app-card"><article class="app-card-row"><span class="app-step">1</span><div><h3>App or install issue</h3><p>Reconnect once, open MUSITU, then retry. For installation diagnostics use the dedicated local check.</p></div></article><article class="app-card-row"><span class="app-step">2</span><div><h3>Premium or payment issue</h3><p>Do not create repeated payments. Premium remains locked until settlement is independently verified.</p></div></article><article class="app-card-row"><span class="app-step">3</span><div><h3>Privacy &amp; credentials</h3><p>Never send a password, payment PIN, OTP, private key or full payment credential to support.</p></div></article></div><div class="app-actions"><a class="app-action" href="/chemistry/install/diagnostics">Run install check</a><a class="app-action" href="/chemistry/verify">Verify release</a></div></section><section class="app-contact"><h3>Contact MUSITU support</h3><p>WhatsApp ${appEsc(SUPPORT.whatsappDisplay)}</p><a class="app-primary" href="${appEsc(SUPPORT.whatsappUrl)}">Open WhatsApp support</a></section>`;
}

function onboarding(){
  return `<section class="app-onboarding" id="app-onboarding" hidden aria-label="First launch introduction"><div class="app-onboarding-card"><article class="app-onboarding-step" data-app-onboarding-step><span class="app-onboarding-kicker">Step 1 of 3</span><h2>Diagnose</h2><p>Find the Chemistry areas that need attention before spending time revising everything.</p></article><article class="app-onboarding-step" data-app-onboarding-step hidden><span class="app-onboarding-kicker">Step 2 of 3</span><h2>Revise</h2><p>Focus your effort where it matters instead of treating every topic as equally weak.</p></article><article class="app-onboarding-step" data-app-onboarding-step hidden><span class="app-onboarding-kicker">Step 3 of 3</span><h2>Prove</h2><p>Use exam pressure to reveal what still needs work, then repeat the cycle.</p></article><div class="app-dots" aria-hidden="true"><span data-app-onboarding-dot></span><span data-app-onboarding-dot></span><span data-app-onboarding-dot></span></div><div class="app-onboarding-actions"><button class="skip" id="app-onboarding-skip" type="button">Skip</button><button class="next" id="app-onboarding-next" type="button">Next</button></div></div></section>`;
}

export function renderChemistryApp({view='home'}={}){
  const active=normalizeAppView(view);
  const name=appEsc(PRODUCT.name);
  const body=active==='rescue'?rescueView():active==='premium'?premiumView():active==='help'?helpView():homeView();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#07101f"><title>${name}</title><link rel="manifest" href="/chemistry/manifest.webmanifest"><link rel="apple-touch-icon" href="/chemistry/assets/musitu-chemistry-192.png"><link rel="stylesheet" href="/chemistry/assets/app-shell.css?v=3"><script src="/chemistry/assets/app-shell.js?v=3" defer></script></head><body><div class="app-shell"><header class="app-topbar"><div class="app-brand"><div class="app-icon" aria-hidden="true">M</div><div class="app-brand-copy"><strong>MUSITU Chemistry</strong><span>Education Nexus</span></div></div><span class="app-state" data-app-install-state>Installed</span></header><main class="app-main">${body}</main>${nav(active)}</div>${onboarding()}</body></html>`;
}

export const CHEMISTRY_APP_URL=APP_URL;
export {normalizeAppView};
