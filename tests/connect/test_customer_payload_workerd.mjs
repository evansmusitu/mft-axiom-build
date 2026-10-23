/** Cloudflare workerd HTTP transport checks; no network or production bindings. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Miniflare} from 'miniflare';

const source = readFileSync(new URL('../../connect/customer_payload.mjs', import.meta.url), 'utf8');
const SCRIPT = source.replace(/^export /gm, '') + `
export default {
  async fetch(request) {
    const result = await readBoundedCustomerJson(request);
    return Response.json(result, {status:result.ok ? 200 : result.status});
  }
};
`;
async function makeWorker(){
  return new Miniflare({
    modules:true, compatibilityDate:'2026-07-01', cf:false,
    script:SCRIPT,
  });
}
test('workerd streaming customer payload accepts a valid JSON object', {timeout:30000}, async ()=>{
  const mf=await makeWorker();
  try {
    const response=await mf.dispatchFetch('https://isolated.test/v1/customer/plan',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:'{"rows":[],"budget":7}',
    });
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,body:{rows:[],budget:7}});
  } finally {await mf.dispose();}
});
test('workerd refuses oversized customer JSON without forwarding any parsed object', {timeout:30000}, async ()=>{
  const mf=await makeWorker();
  try {
    const response=await mf.dispatchFetch('https://isolated.test/v1/customer/plan',{
      method:'POST',
      headers:{'content-type':'application/json'},
      // Exceed the 64-KiB byte cap by a narrow margin. A much larger
      // upload can race the local workerd HTTP client's early 413 response
      // and cause ECONNRESET during upload, obscuring the assertion.
      body:JSON.stringify({note:'🛡️'.repeat(9400)}),
    });
    assert.equal(response.status,413);
    assert.deepEqual(await response.json(),{ok:false,status:413,error:'PAYLOAD_TOO_LARGE'});
  } finally {await mf.dispose();}
});


test('workerd refuses nested or escaped duplicate object properties', {timeout:30000}, async ()=>{
  const mf=await makeWorker();
  try {
    for (const body of [
      '{"rows":[{"hazard":"a","hazard":"b"}]}',
      '{"\\u0062udget":2,"budget":3}',
    ]) {
      const response=await mf.dispatchFetch('https://isolated.test/v1/customer/plan',{
        method:'POST', headers:{'content-type':'application/json'}, body,
      });
      assert.equal(response.status,400);
      assert.deepEqual(await response.json(),{ok:false,status:400,error:'DUPLICATE_JSON_KEY'});
    }
  } finally {await mf.dispose();}
});

test('workerd allows repeated keys in distinct objects', {timeout:30000}, async ()=>{
  const mf=await makeWorker();
  try {
    const response=await mf.dispatchFetch('https://isolated.test/v1/customer/plan',{
      method:'POST', headers:{'content-type':'application/json'},
      body:'{"rows":[{"hazard":"a"},{"hazard":"b"}]}',
    });
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.ok,true);
    assert.deepEqual(result.body.rows.map(r=>r.hazard),['a','b']);
  } finally {await mf.dispose();}
});
