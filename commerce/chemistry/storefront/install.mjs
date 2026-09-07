import {PRODUCT,RELEASE,SUPPORT} from './content.mjs';

export const INSTALL_CANONICAL_URL='https://payments.mftintelligence.com/chemistry/install';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const INSTALL_HANDOFF_JS=String.raw`
(()=>{
  'use strict';
  const button=document.getElementById('install-musitu');
  const status=document.querySelector('[data-install-status]');
  const help=document.querySelector('[data-install-help]');
  if(!button)return;
  let deferred=null;
  const standalone=()=>window.matchMedia?.('(display-mode: standalone)').matches===true||window.navigator.standalone===true;
  const ua=String(navigator.userAgent||'').toLowerCase();
  const ios=/iphone|ipad|ipod/.test(ua);
  const android=/android/.test(ua);
  const set=(s,h='')=>{if(status)status.textContent=s;if(help&&h)help.textContent=h;};
  const fallback=()=>{
    if(standalone()){
      button.hidden=true;
      set('MUSITU is installed on this device.','Open it from your home screen or app list.');
      return;
    }
    if(ios){
      button.hidden=true;
      set('Install from Safari.','Tap Share, then Add to Home Screen.');
      return;
    }
    if(android){
      set('Ready for Android installation.','If the Install button does not appear, open the browser menu and choose Install app or Add to Home screen.');
      return;
    }
    set('Install from your browser.','Use your browser menu and choose Install app or Add to Home screen when available.');
  };
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    deferred=e;
    button.hidden=false;
    button.disabled=false;
    set('Ready to install.','Tap Install MUSITU. Your browser will show its native installation confirmation.');
  });
  button.addEventListener('click',async()=>{
    if(!deferred){fallback();return;}
    button.disabled=true;
    try{
      await deferred.prompt();
      const choice=await deferred.userChoice;
      if(choice?.outcome==='accepted')set('Installation accepted.','MUSITU will appear on your device when installation completes.');
      else set('Installation not completed.','You can tap Install MUSITU again whenever you are ready.');
    }finally{
      deferred=null;
      button.disabled=false;
    }
  });
  window.addEventListener('appinstalled',()=>{
    deferred=null;
    button.hidden=true;
    set('MUSITU installed successfully.','Open it from your home screen or app list.');
  });
  fallback();
})();
`;

export function renderInstall(){
  const apk=`/chemistry/download/${RELEASE.apk}`;
  const structured=JSON.stringify({
    '@context':'https://schema.org',
    '@type':'SoftwareApplication',
    name:PRODUCT.name,
    applicationCategory:'EducationalApplication',
    operatingSystem:'Android, Web',
    url:INSTALL_CANONICAL_URL,
    softwareVersion:RELEASE.version,
    offers:{'@type':'Offer',price:'0',priceCurrency:'USD'}
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Install MUSITU Chemistry Mastery</title><meta name="description" content="Install the MUSITU Chemistry web experience without a Play Store account, with the verified Android APK available as a fallback."><meta name="robots" content="index,follow,max-image-preview:large"><meta name="theme-color" content="#18223A"><link rel="canonical" href="${INSTALL_CANONICAL_URL}"><link rel="manifest" href="/chemistry/manifest.webmanifest"><link rel="apple-touch-icon" href="/chemistry/assets/musitu-chemistry-192.png"><script type="application/ld+json">${structured}</script><link rel="stylesheet" href="/chemistry/assets/storefront.css?v=3"><script src="/chemistry/assets/install-handoff.js" defer></script></head><body><a class="skip-link" href="#main">Skip to main content</a><header class="site-header"><div class="wrap"><nav class="nav" aria-label="Primary"><a class="brand" href="/chemistry/">MUSITU<span>EDUCATION NEXUS</span></a><div class="nav-links"><a href="/chemistry/rescue">Chemistry Rescue</a><a href="/chemistry/install" aria-current="page">Install</a><a href="/chemistry/plans">Plans</a><a href="/chemistry/support">Support</a></div></nav></div></header><main id="main" tabindex="-1"><section class="hero"><div class="wrap"><span class="eyebrow">Zero-cost install path · Android + modern browsers</span><h1>Install MUSITU Chemistry</h1><p class="lead"><strong>Use the browser-native install first. Keep the verified APK only as a fallback.</strong></p><p>This route avoids the Google Play Console fee while giving supported devices a normal browser installation prompt and automatic web updates.</p><div class="cta-row"><button class="button" id="install-musitu" type="button">Install MUSITU</button><a class="button secondary" href="${apk}">Download verified Android APK</a></div><p class="microcopy" data-install-status>Checking installation support…</p><p class="microcopy" data-install-help>The browser-native install does not silently install the Android APK. Android protects manual APK installation by design.</p></div></section><section class="section"><div class="wrap"><h2>Recommended installation</h2><div class="journey-grid"><article><span>1</span><h3>Open</h3><p>Use Chrome or another install-capable browser on Android and stay on this MUSITU page.</p></article><article><span>2</span><h3>Install</h3><p>Tap <strong>Install MUSITU</strong>. If your browser does not show the button, open its menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p></article><article><span>3</span><h3>Update automatically</h3><p>The installed web experience loads the current MUSITU site, so web updates do not require downloading a replacement APK.</p></article></div></div></section><section class="section"><div class="wrap"><div class="panel"><h2>Need the native Android APK?</h2><p>The verified native release remains available for devices where you specifically need the APK. Manual Android installation may require the user to approve installation from the browser or file manager.</p><ul class="checklist"><li>Version: ${esc(RELEASE.version)}</li><li>Size: ${esc(RELEASE.sizeText)}</li><li>SHA-256: <code>${esc(RELEASE.sha256)}</code></li><li>Android signing certificate SHA-256: <code>${esc(RELEASE.androidCertSha256)}</code></li></ul><p><a class="button secondary" href="${apk}">Download ${esc(RELEASE.apk)}</a></p><p class="microcopy">If Android reports “App not installed”, use the browser-installed MUSITU experience immediately and contact support before removing an older app, so existing local data is not lost unnecessarily.</p></div></div></section><section class="section"><div class="wrap"><div class="panel"><h2>Installation help</h2><p>Support is available if a device still refuses the native APK.</p><p><a class="button tertiary" href="${esc(SUPPORT.whatsappUrl)}" rel="noopener noreferrer">WhatsApp MUSITU support</a></p></div></div></section></main><footer class="site-footer"><div class="wrap"><strong>${esc(PRODUCT.name)}</strong> · ${esc(PRODUCT.family)}<br><span>Browser installation is the primary zero-cost distribution path until a Google Play release is available.</span><div class="footer-links"><a href="/chemistry/privacy">Privacy</a><a href="/chemistry/terms">Terms</a><a href="/chemistry/support">Support</a><a href="/chemistry/verify">Verify release</a></div></div></footer></body></html>`;
}
