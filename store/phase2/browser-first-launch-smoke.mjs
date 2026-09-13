// Browser-first launch contract. CI generates generated-data.mjs from committed signed Store metadata before this runs.
import assert from 'node:assert/strict';
import worker from '../phase1/web-surface/worker.mjs';
import {renderHome, renderApp, renderInstall} from '../phase1/web-surface/render.mjs';
import {CATALOG} from '../phase1/web-surface/generated-data.mjs';

const origin = 'https://payments.mftintelligence.com';
const request = (path, ua = 'Mozilla/5.0') => new Request(`${origin}${path}`, {headers: {'user-agent': ua}});

const home = renderHome(request('/store'));
assert.match(home, /href="\/store\/open"/);
assert.match(home, /Open MUSITU Chemistry Mastery/);
assert.match(
  home,
  /href="\/store\/open"[^>]*>Open MUSITU Chemistry Mastery<\/a>.*href="\/store\/install"[^>]*>Install options<\/a>/s,
  'The customer-facing Store action group must present browser launch before install options'
);

const appPage = renderApp(request('/store/apps/chemistry'));
assert.match(appPage, /href="\/store\/open"/);
assert.match(appPage, /Install options/);

const webInstall = renderInstall(request('/store/install?platform=web'));
assert.match(webInstall, /Open in browser/);
assert.match(webInstall, /href="\/store\/open"/);
assert.match(webInstall, /Install Web App/);
assert.doesNotMatch(webInstall, /\.apk|\.ipa/i, 'Web/PWA install page must not expose native package downloads');

const androidInstall = renderInstall(request('/store/install?platform=android', 'Mozilla/5.0 (Linux; Android 14)'));
assert.match(androidInstall, /intent:\/\/app\/chemistry/);
assert.match(androidInstall, /com\.musitu\.store/);
assert.match(androidInstall, /href="\/store\/open"/);

const iosInstall = renderInstall(request('/store/install?platform=ios', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'));
assert.match(iosInstall, /sidestore:\/\/install/);
assert.match(iosInstall, /href="\/store\/open"/);

const openResponse = await worker.fetch(request('/store/open'), {});
assert.equal(openResponse.status, 302);
assert.equal(openResponse.headers.get('location'), CATALOG.apps[0].releases[0].web.appURL);
assert.equal(openResponse.headers.get('content-disposition'), null, 'Browser launch must never be an attachment response');

const liteResponse = await worker.fetch(request('/store?lite=1'), {});
assert.equal(liteResponse.status, 200);
const lite = await liteResponse.text();
assert.match(lite, /href="\/store\/open">Open app<\/a>/);
assert.match(lite, /href="\/store\/install">Install options<\/a>/);

const manifestResponse = await worker.fetch(request('/store/manifest.webmanifest'), {});
assert.equal(manifestResponse.status, 200);
const manifest = await manifestResponse.json();
assert.equal(manifest.start_url, '/store');
assert.equal(manifest.scope, '/store/');
assert.equal(manifest.display, 'standalone');

console.log('browser-first-launch-smoke: PASS');
