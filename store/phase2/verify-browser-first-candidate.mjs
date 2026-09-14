import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

const root=process.env.CANDIDATE_MODULE_ROOT;
if(!root) throw new Error('CANDIDATE_MODULE_ROOT is required');
const worker=(await import(pathToFileURL(join(root,'worker.mjs')).href+'?verify='+Date.now())).default;
const env={STORE_RUNTIME_PUBLICATION_STATE:'production',STORE_RELEASES:{get:async()=>null}};
const ORIGIN='https://payments.mftintelligence.com';
const APP='https://payments.mftintelligence.com/chemistry/app/';
const UA={
  android:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  ios:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
  web:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
};

async function request(path,{platform='web',accept='text/html',navigate=false}={}){
  const headers={'user-agent':UA[platform],accept};
  if(navigate){headers['sec-fetch-mode']='navigate';headers['sec-fetch-dest']='document';}
  return worker.fetch(new Request(ORIGIN+path,{headers}),env,{});
}
async function html(path,platform='web'){
  const r=await request(path,{platform});
  assert.equal(r.status,200,`${platform} ${path} should be 200`);
  assert.match((r.headers.get('content-type')||''),/^text\/html/i,`${platform} ${path} must be HTML`);
  return r.text();
}
function hrefs(text){return [...text.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);}
function assertNoDirectPackageDownload(text,label){
  assert.doesNotMatch(text,/href="https?:[^"]+\.(?:apk|ipa)(?:[?#][^"]*)?"/i,`${label} exposed a direct package download`);
}
function assertBrowserFirst(text,label){
  const open=text.indexOf('href="/store/open"');
  const install=text.indexOf('href="/store/install"');
  assert.ok(open>=0,`${label} missing /store/open`);
  assert.ok(install>=0,`${label} missing /store/install`);
  assert.ok(open<install,`${label} must present Open before Install options`);
  assertNoDirectPackageDownload(text,label);
}

for(const platform of ['android','ios','web']){
  for(const path of ['/store','/store/apps/chemistry','/store/search?q=chemistry']){
    const text=await html(path,platform);
    assertBrowserFirst(text,`${platform} ${path}`);
  }
  const lite=await html('/store?lite=1',platform);
  assertBrowserFirst(lite,`${platform} low-bandwidth home`);
  assert.equal(hrefs(lite).some(h=>h.startsWith('intent://')||h.startsWith('sidestore://')),false,'low-bandwidth home must not invoke a native carrier directly');
}

{
  const r=await request('/store/open');
  assert.equal(r.status,302,'/store/open must redirect');
  assert.equal(r.headers.get('location'),APP,'/store/open must target the full browser application');
  assert.equal(r.headers.get('content-disposition'),null,'/store/open must not be a download');
}

for(const action of ['install','update','repair','reinstall']){
  const path=action==='install'?'/store/install':`/store/${action}`;
  const android=await html(path,'android');
  assert.match(android,new RegExp(`intent://app/chemistry\\?action=${action}[^\"]*package=com\\.musitu\\.store`),`Android ${action} must retain MUSITU Store handoff`);
  assert.ok(hrefs(android).includes('/store/open'),`Android ${action} missing browser fallback`);

  const ios=await html(path,'ios');
  assert.ok(hrefs(ios).some(h=>h.startsWith('sidestore://install?url=')),`iOS ${action} must retain SideStore handoff`);
  assert.ok(hrefs(ios).includes('/store/open'),`iOS ${action} missing browser fallback`);
  assertNoDirectPackageDownload(ios,`iOS ${action}`);

  const web=await html(path,'web');
  assert.ok(hrefs(web).includes('https://payments.mftintelligence.com/chemistry/install'),`Web ${action} must retain PWA install surface`);
  assert.ok(hrefs(web).includes('/store/open'),`Web ${action} missing browser launch`);
  assertNoDirectPackageDownload(web,`Web ${action}`);
}

{
  const r=await request('/store/manifest.webmanifest',{accept:'application/manifest+json'});
  assert.equal(r.status,200);
  const manifest=JSON.parse(await r.text());
  assert.equal(manifest.description,'Browser-first verified MUSITU software distribution.');
  assert.equal(manifest.start_url,'/store');
}

for(const path of ['/store/catalog.json','/store/ios/source.json','/store/web/adapter.json']){
  const machine=await request(path,{accept:'application/json'});
  assert.equal(machine.status,200);
  const raw=Buffer.from(await machine.arrayBuffer());
  const override=await request(path+'?raw=1',{accept:'text/html',navigate:true});
  assert.equal(override.status,200);
  const overrideRaw=Buffer.from(await override.arrayBuffer());
  assert.deepEqual(overrideRaw,raw,`${path} raw override must preserve exact machine bytes`);
  const human=await request(path,{accept:'text/html',navigate:true});
  assert.equal(human.status,200);
  assert.match((human.headers.get('content-type')||''),/^text\/html/i);
  const humanText=await human.text();
  assert.match(humanText,/Machine-readable endpoint/);
  assert.match(humanText,/Readable browser view\./);
}

console.log('MUSITU_STORE_BROWSER_FIRST_LOCAL_CANDIDATE=PASS');
