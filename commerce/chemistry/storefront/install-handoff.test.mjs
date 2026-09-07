import test from 'node:test';
import assert from 'node:assert/strict';
import {renderInstall,INSTALL_HANDOFF_JS,INSTALL_CANONICAL_URL} from './install.mjs';

test('zero-cost install handoff is browser-native first and APK fallback second',()=>{
  const html=renderInstall();
  assert.equal(INSTALL_CANONICAL_URL,'https://payments.mftintelligence.com/chemistry/install');
  assert.match(html,/Install MUSITU Chemistry/);
  assert.match(html,/id="install-musitu"/);
  assert.match(html,/browser-native install first/i);
  assert.match(html,/Download verified Android APK/);
  assert.match(html,/MUSITU_Chemistry_Mastery_1\.2\.0\.apk/);
  assert.match(html,/055b63f271c18faab540985faefb970f472ea55ba9cb3495db459797902b790d/);
  assert.match(html,/d4455ac3ec74a6d7cd7993ca640f554a83bba95dfd01ef508f7637b6bc72c0d8/);
  assert.match(html,/<link rel="manifest" href="\/chemistry\/manifest\.webmanifest">/);
  assert.match(html,/<link rel="canonical" href="https:\/\/payments\.mftintelligence\.com\/chemistry\/install">/);
  assert.match(html,/\/chemistry\/assets\/install-handoff\.js/);
  assert.doesNotMatch(html,/silently install the Android APK[^<]*yes/i);
});

test('install handoff script uses native browser prompt without tracking or privileged APIs',()=>{
  assert.match(INSTALL_HANDOFF_JS,/beforeinstallprompt/);
  assert.match(INSTALL_HANDOFF_JS,/deferred\.prompt\(\)/);
  assert.match(INSTALL_HANDOFF_JS,/appinstalled/);
  assert.match(INSTALL_HANDOFF_JS,/display-mode: standalone/);
  assert.match(INSTALL_HANDOFF_JS,/Install app/);
  assert.match(INSTALL_HANDOFF_JS,/Add to Home screen/);
  assert.doesNotMatch(INSTALL_HANDOFF_JS,/(document\.cookie|localStorage|sessionStorage|pushManager|Notification\.requestPermission|geolocation|getUserMedia)/);
});
