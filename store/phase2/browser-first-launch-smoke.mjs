// Route-level browser-first launch contract.
// CI generates generated-data.mjs from committed signed Store metadata before this runs.
import assert from 'node:assert/strict';
import worker from '../phase1/web-surface/worker.mjs';

const origin='https://payments.mftintelligence.com';
async function get(path,headers={}){
  return worker.fetch(new Request(origin+path,{headers}),{},{});
}

const open=await get('/store/open');
assert.equal(open.status,302,'/store/open must redirect into the browser application');
const location=open.headers.get('location')||'';
assert.equal(location,'https://payments.mftintelligence.com/chemistry/app/');
assert.doesNotMatch(location,/\.(?:apk|ipa|zip|exe|msi)(?:$|\?)/i,'browser launch must not target an installer/package');
assert.equal(open.headers.get('content-disposition'),null,'browser launch must never be an attachment response');

const home=await get('/store');
assert.equal(home.status,200);
const homeHtml=await home.text();
assert.match(homeHtml,/href="\/store\/open"/);
assert.match(homeHtml,/Open MUSITU Chemistry Mastery/);
assert.match(homeHtml,/href="\/store\/install"[^>]*>Install options<\/a>/);

const webInstall=await get('/store/install?platform=web',{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
assert.equal(webInstall.status,200);
const webHtml=await webInstall.text();
assert.match(webHtml,/href="\/store\/open"[^>]*>Open in browser<\/a>/);
assert.match(webHtml,/href="https:\/\/payments\.mftintelligence\.com\/chemistry\/install"[^>]*>Install Web App<\/a>/);
assert.doesNotMatch(webHtml,/href="[^"]+\.(?:apk|ipa|zip|exe|msi)"/i,'web launch/install surface must not expose native package downloads');

const android=await get('/store/install?platform=android',{'user-agent':'Mozilla/5.0 (Linux; Android 14)'});
const androidHtml=await android.text();
assert.match(androidHtml,/intent:\/\/app\/chemistry\?action=install/);
assert.match(androidHtml,/package=com\.musitu\.store/);
assert.match(androidHtml,/href="\/store\/open"[^>]*>Open in browser<\/a>/);

const ios=await get('/store/install?platform=ios',{'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'});
const iosHtml=await ios.text();
assert.match(iosHtml,/sidestore:\/\/install\?url=/);
assert.match(iosHtml,/href="\/store\/open"[^>]*>Open in browser<\/a>/);
assert.doesNotMatch(iosHtml,/href="https?:[^"]+\.ipa/i);

const lite=await get('/store?lite=1');
assert.equal(lite.status,200);
const liteHtml=await lite.text();
assert.match(liteHtml,/href="\/store\/open">Open app<\/a>/);
assert.match(liteHtml,/href="\/store\/install">Install options<\/a>/);

const manifestResponse=await get('/store/manifest.webmanifest');
assert.equal(manifestResponse.status,200);
const manifest=await manifestResponse.json();
assert.equal(manifest.start_url,'/store');
assert.equal(manifest.scope,'/store/');
assert.equal(manifest.display,'standalone');

console.log('browser-first-launch-smoke: PASS');
