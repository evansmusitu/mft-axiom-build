import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderInstall,renderInstallDiagnostics,INSTALL_HANDOFF_JS,INSTALL_DIAGNOSTICS_JS,INSTALL_CONCIERGE_CSS,INSTALL_SW_JS,
  INSTALL_CANONICAL_URL,INSTALL_DIAGNOSTICS_URL,classifyInstallContext
} from './install.mjs';

const UA={
  iphoneSafari:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ipadSafari:'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iphoneChrome:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneFacebook:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.0]',
  androidChrome:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  samsung:'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/140.0.0.0 Mobile Safari/537.36',
  androidWebView:'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36',
  edge:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
};

test('universal install renderer exposes adaptive concierge and only one canonical URL',()=>{
  const html=renderInstall();
  assert.equal(INSTALL_CANONICAL_URL,'https://payments.mftintelligence.com/chemistry/install');
  assert.match(html,/Get MUSITU on this device/);
  assert.match(html,/data-install-panel="ios-safari"/);
  assert.match(html,/data-install-panel="ios-inapp"/);
  assert.match(html,/data-install-panel="samsung"/);
  assert.match(html,/data-install-panel="android-fallback"/);
  assert.match(html,/data-install-panel="installed"/);
  assert.match(html,/Add to Home Screen/);
  assert.match(html,/Open as Web App/);
  assert.match(html,/Download verified Android APK/);
  assert.match(html,/MUSITU_Chemistry_Mastery_1\.2\.0\.apk/);
  assert.match(html,/\/chemistry\/install\/diagnostics/);
  assert.match(html,/\/chemistry\/assets\/install-concierge\.css/);
  assert.match(html,/\/chemistry\/assets\/field-experience\.js/);
});

test('platform classifier covers required customer matrix without identifiers',()=>{
  assert.equal(classifyInstallContext({ua:UA.iphoneSafari,vendor:'Apple Computer, Inc.'}),'ios-safari');
  assert.equal(classifyInstallContext({ua:UA.ipadSafari,vendor:'Apple Computer, Inc.'}),'ios-safari');
  assert.equal(classifyInstallContext({ua:UA.iphoneChrome,vendor:'Apple Computer, Inc.'}),'ios-other');
  assert.equal(classifyInstallContext({ua:UA.iphoneFacebook,vendor:'Apple Computer, Inc.'}),'ios-inapp');
  assert.equal(classifyInstallContext({ua:UA.androidChrome,vendor:'Google Inc.'}),'android-chrome');
  assert.equal(classifyInstallContext({ua:UA.samsung,vendor:'Google Inc.'}),'samsung');
  assert.equal(classifyInstallContext({ua:UA.androidWebView,vendor:'Google Inc.'}),'android-inapp');
  assert.equal(classifyInstallContext({ua:UA.edge,vendor:'Google Inc.'}),'desktop-edge');
  assert.equal(classifyInstallContext({ua:UA.edge,vendor:'Google Inc.',standalone:true}),'installed');
});

test('install handoff uses trusted browser prompt, adaptive fallback and privacy-safe aggregate events',()=>{
  for(const marker of ['beforeinstallprompt','deferred.prompt()','appinstalled','display-mode: standalone','install_view','install_prompt_available','install_started','install_completed','install_fallback','install_help_needed','serviceWorker.register'])assert.match(INSTALL_HANDOFF_JS,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(INSTALL_HANDOFF_JS,/navigator\.clipboard\.writeText/);
  assert.doesNotMatch(INSTALL_HANDOFF_JS,/(document\.cookie|localStorage|sessionStorage|pushManager|Notification\.requestPermission|geolocation|getUserMedia)/);
});

test('hidden diagnostics surface checks platform, prompt, manifest, assets, rescue and service worker',()=>{
  const html=renderInstallDiagnostics();
  assert.equal(INSTALL_DIAGNOSTICS_URL,'https://payments.mftintelligence.com/chemistry/install/diagnostics');
  assert.match(html,/noindex,nofollow/);
  assert.match(html,/MUSITU installation check/);
  assert.match(html,/does not send device identifiers/);
  for(const marker of ['manifest','install-js','css','icon','rescue','sw','prompt'])assert.match(html,new RegExp(`data-diag="${marker}"`));
  assert.doesNotMatch(INSTALL_DIAGNOSTICS_JS,/(sendBeacon|document\.cookie|localStorage|sessionStorage)/);
});

test('service worker provides bounded offline shell and never caches payment or telemetry routes',()=>{
  assert.match(INSTALL_SW_JS,/musitu-chemistry-install-v2/);
  assert.match(INSTALL_SW_JS,/\/chemistry\/rescue\?src=direct/);
  assert.match(INSTALL_SW_JS,/checkout\|return\|claim\|telemetry\|plans/);
  assert.match(INSTALL_SW_JS,/caches\.keys/);
  assert.match(INSTALL_SW_JS,/self\.clients\.claim/);
});

test('concierge CSS contains full-screen coach and first-launch onboarding states',()=>{
  assert.match(INSTALL_CONCIERGE_CSS,/install-concierge/);
  assert.match(INSTALL_CONCIERGE_CSS,/ios-coach/);
  assert.match(INSTALL_CONCIERGE_CSS,/safari-bar/);
  assert.match(INSTALL_CONCIERGE_CSS,/install-onboarding/);
  assert.match(INSTALL_CONCIERGE_CSS,/prefers-reduced-motion/);
});
