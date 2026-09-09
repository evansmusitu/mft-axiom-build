import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

async function get(path,env={}){
  return worker.fetch(new Request('https://payments.mftintelligence.com'+path),env,{});
}

for (const path of [
  '/store/bootstrap/MUSITU_Store_1.0.1.apk',
  '/store/bootstrap/MUSITU_Store_1.0.0.apk',
]) {
  test(`${path} is a recognized release route that fails closed without R2`, async()=>{
    const r=await get(path);
    assert.equal(r.status,503);
    assert.equal(r.headers.get('cache-control'),'no-store');
    assert.match(await r.text(),/release asset unavailable/i);
  });
}

test('1.0.1 route rejects corrupt R2 bytes rather than serving them',async()=>{
  const env={STORE_RELEASES:{get:async()=>({arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})}};
  const r=await get('/store/bootstrap/MUSITU_Store_1.0.1.apk',env);
  assert.equal(r.status,503);
  assert.match(await r.text(),/integrity verification failed/i);
});
