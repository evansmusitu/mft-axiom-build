import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './route_worker.mjs';
const H='https://axiom-customer-staging.mftintelligence.com';
test('exact HTTPS host exposes non-authoritative health only', async()=>{
 const r=await worker.fetch(new Request(H+'/_health'));
 assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
 assert.match(r.headers.get('cache-control'),/no-store/);
 const b=await r.json();assert.equal(b.stage,'host_route_only');
 for(const k of ['identity_live_qualified','customer_ownership_qualified','oauth_upgrade_qualified','release_qualified'])assert.equal(b[k],false);
});
test('all login/callback/logout routes deny actual session or OAuth authority', async()=>{
 for(const path of ['/auth/start','/auth/callback?code=dummy&state=dummy','/auth/logout']){
  for(const method of ['GET','POST']){
   const r=await worker.fetch(new Request(H+path,{method}));assert.equal(r.status,503);
   assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('location'),null);
   assert.equal((await r.json()).release_qualified,false);
  }
 }
});
test('customer data, enrollment and payments never become reachable',async()=>{
 for(const path of ['/v1/customer/me','/v1/customer/enroll','/v1/customer/billing/truth']){
  const r=await worker.fetch(new Request(H+path));assert.equal(r.status,503);
 }
});
test('other hosts cannot claim staging identity route',async()=>{
 for(const host of ['example.com','mftintelligence.com','customer.mftintelligence.com']){
  const r=await worker.fetch(new Request('https://'+host+'/_health'));
  assert.equal(r.status,421);
 }
});
test('health never accepts query strings, spoofed paths, POST or cookies',async()=>{
 for(const path of ['/_health?success=1','/_health/','/_Health']){
  const r=await worker.fetch(new Request(H+path));assert.notEqual(r.status,200);
 }
 const r=await worker.fetch(new Request(H+'/_health',{method:'POST',headers:{cookie:'session=not_a_real_session'}}));
 assert.notEqual(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
});
