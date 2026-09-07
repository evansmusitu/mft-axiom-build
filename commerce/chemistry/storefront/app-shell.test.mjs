import test from 'node:test';
import assert from 'node:assert/strict';
import {renderChemistryApp,APP_BRIDGE_JS,APP_SHELL_JS,APP_SHELL_CSS,CHEMISTRY_APP_URL,normalizeAppView} from './app-shell.mjs';

test('installed app shell is distinct from public website chrome and keeps primary navigation internal',()=>{
  const html=renderChemistryApp();
  assert.equal(CHEMISTRY_APP_URL,'https://payments.mftintelligence.com/chemistry/app');
  assert.notEqual(CHEMISTRY_APP_URL,'https://payments.mftintelligence.com/chemistry/rescue');
  assert.match(html,/Your Chemistry workspace/);
  assert.match(html,/class="app-topbar"/);
  assert.match(html,/class="app-nav"/);
  assert.match(html,/\/chemistry\/app\?view=rescue/);
  assert.match(html,/\/chemistry\/app\?view=premium/);
  assert.match(html,/\/chemistry\/app\?view=help/);
  assert.match(html,/data-app-install-state/);
  assert.match(html,/\/chemistry\/assets\/app-shell\.css\?v=3/);
  assert.match(html,/\/chemistry\/assets\/app-shell\.js\?v=3/);
  assert.match(html,/noindex,nofollow/);
  assert.match(html,/Premium, Help and Rescue navigation stay inside the installed app surface/);
  assert.doesNotMatch(html,/class="site-header"/);
  assert.doesNotMatch(html,/class="site-footer"/);
  assert.doesNotMatch(html,/Checking this device/);
});

test('premium and help app views remain in the dark installed shell instead of public pages',()=>{
  const premium=renderChemistryApp({view:'premium'});
  const help=renderChemistryApp({view:'help'});
  assert.match(premium,/Unlock full mastery/);
  assert.match(premium,/Premium includes/);
  assert.match(premium,/aria-current="page"><b>◇<\/b><span>Premium<\/span>/);
  assert.match(premium,/View secure plan options/);
  assert.doesNotMatch(premium,/class="site-header"|class="site-footer"/);
  assert.match(help,/Help without leaving MUSITU/);
  assert.match(help,/Contact MUSITU support/);
  assert.match(help,/aria-current="page"><b>\?<\/b><span>Help<\/span>/);
  assert.doesNotMatch(help,/class="site-header"|class="site-footer"/);
  assert.equal(normalizeAppView('unknown'),'home');
});

test('standalone bridge moves installed rescue launches into app surface before body rendering',()=>{
  assert.match(APP_BRIDGE_JS,/display-mode: standalone/);
  assert.match(APP_BRIDGE_JS,/navigator\.standalone/);
  assert.match(APP_BRIDGE_JS,/location\.pathname==='\/chemistry\/rescue'/);
  assert.match(APP_BRIDGE_JS,/location\.replace\('\/chemistry\/app'\)/);
  assert.doesNotMatch(APP_BRIDGE_JS,/(fetch\(|sendBeacon|document\.cookie|localStorage|sessionStorage)/);
});

test('app shell primes bounded internal views only and never caches payment authority',()=>{
  assert.match(APP_SHELL_JS,/musitu_chem_onboarding_v1/);
  assert.match(APP_SHELL_JS,/localStorage\.setItem\(KEY,'1'\)/);
  assert.match(APP_SHELL_JS,/serviceWorker\.register/);
  assert.match(APP_SHELL_JS,/musitu-chemistry-app-shell-v3/);
  assert.match(APP_SHELL_JS,/primeOfflineShell/);
  assert.match(APP_SHELL_JS,/\/chemistry\/app\?view=premium/);
  assert.match(APP_SHELL_JS,/\/chemistry\/app\?view=help/);
  assert.match(APP_SHELL_JS,/app-shell\.css\?v=3/);
  assert.match(APP_SHELL_JS,/app-shell\.js\?v=3/);
  assert.match(APP_SHELL_JS,/Offline ready/);
  assert.doesNotMatch(APP_SHELL_JS,/(\/chemistry\/(checkout|return|claim|telemetry|plans)|document\.cookie|sendBeacon|geolocation|getUserMedia|Notification\.requestPermission)/);
});

test('app shell styles include safe areas, bottom navigation and reduced-motion handling',()=>{
  assert.match(APP_SHELL_CSS,/safe-area-inset-top/);
  assert.match(APP_SHELL_CSS,/safe-area-inset-bottom/);
  assert.match(APP_SHELL_CSS,/position:fixed/);
  assert.match(APP_SHELL_CSS,/app-nav/);
  assert.match(APP_SHELL_CSS,/prefers-reduced-motion/);
});
