import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const ORIGIN='https://payments.mftintelligence.com';
const request=(path)=>worker.fetch(new Request(ORIGIN+path),{},{});
test('installable Store manifest supplies distinct same-origin 192px and 512px PNG icons',async()=>{
  const res=await request('/store/manifest.webmanifest');
  assert.equal(res.status,200);
  const manifest=await res.json();
  assert.equal(manifest.start_url,'/store/');
  assert.equal(manifest.id,'/store/');
  assert.equal(manifest.scope,'/store/');
  const required=['192x192','512x512'];
  assert.ok(Array.isArray(manifest.icons),'installable PWA manifest requires its own icons');
  assert.equal(manifest.icons.length>=2,true);
  for(const size of required){
    const icon=manifest.icons.find(i=>i.sizes===size&&i.type==='image/png');
    assert.ok(icon,'missing required '+size+' install icon');
    assert.match(icon.src,/^\/store\/assets\/icon-(192|512)\.png$/);
    assert.equal(icon.purpose,'any maskable');
  }
});
test('Chromium receives valid separately sized PNG binaries with fail-closed MIME',async()=>{
  for(const side of [192,512]){
    const response=await request('/store/assets/icon-'+side+'.png');
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type')||'',/^image\/png/);
    assert.match(response.headers.get('x-content-type-options')||'',/nosniff/);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16),side);
    assert.equal(bytes.readUInt32BE(20),side);
    assert.ok(bytes.length>100 && bytes.length<200000);
  }
});
test('unknown icon paths never alias valid installability assets',async()=>{
  for(const path of ['/store/assets/icon-192.jpg','/store/assets/icon-400.png','/store/assets/icon-512.png.bak']){
    const res=await request(path);
    assert.equal(res.status,404);
  }
});
