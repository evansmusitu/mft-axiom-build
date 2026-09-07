import test from 'node:test';
import assert from 'node:assert/strict';
import {renderChemistryApp,APP_BRIDGE_JS,APP_SHELL_JS,APP_SHELL_CSS,CHEMISTRY_APP_URL} from './app-shell.mjs';

test('installed app shell is distinct from public website chrome',()=>{
  const html=renderChemistryApp();
  assert.equal(CHEMISTRY_APP_URL,'https://payments.mftintelligence.com/chemistry/app');
  assert.notEqual(CHEMISTRY_APP_URL,'https://payments.mftintelligence.com/chemistry/rescue');
  assert.match(html,/Your Chemistry workspace/);
  assert.match(html,/class="app-topbar"/);
  assert.match(html,/class="app-nav"/);
  assert.match(html,/Diagnose/);
  assert.match(html,/Revise/);
  assert.match(html,/Prove/);
  assert.match(html,/data-app-install-state/);
  assert.match(html,/\/chemistry\/assets\/app-shell\.css\?v=1/);
  assert.match(html,/\/chemistry\/assets\/app-shell\.js\?v=1/);
  assert.match(html,/noindex,nofollow/);
  assert.doesNotMatch(html,/class="site-header"/);
  assert.doesNotMatch(html,/class="site-footer"/);
  assert.doesNotMatch(html,/Help another Chemistry student before exams/);
  assert.doesNotMatch(html,/Checking this device/);
});

test('standalone bridge moves installed rescue launches into app surface before body rendering',()=>{
  assert.match(APP_BRIDGE_JS,/display-mode: standalone/);
  assert.match(APP_BRIDGE_JS,/navigator\.standalone/);
  assert.match(APP_BRIDGE_JS,/location\.pathname==='\/chemistry\/rescue'/);
  assert.match(APP_BRIDGE_JS,/location\.replace\('\/chemistry\/app'\)/);
  assert.doesNotMatch(APP_BRIDGE_JS,/(fetch\(|sendBeacon|document\.cookie|localStorage|sessionStorage)/);
});

test('app shell onboarding stores only a bounded local completion flag',()=>{
  assert.match(APP_SHELL_JS,/musitu_chem_onboarding_v1/);
  assert.match(APP_SHELL_JS,/localStorage\.setItem\(KEY,'1'\)/);
  assert.match(APP_SHELL_JS,/serviceWorker\.register/);
  assert.doesNotMatch(APP_SHELL_JS,/(document\.cookie|sendBeacon|geolocation|getUserMedia|Notification\.requestPermission)/);
});

test('app shell styles include safe areas, bottom navigation and reduced-motion handling',()=>{
  assert.match(APP_SHELL_CSS,/safe-area-inset-top/);
  assert.match(APP_SHELL_CSS,/safe-area-inset-bottom/);
  assert.match(APP_SHELL_CSS,/position:fixed/);
  assert.match(APP_SHELL_CSS,/app-nav/);
  assert.match(APP_SHELL_CSS,/prefers-reduced-motion/);
});