import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createProtectedRuntimeBridge} from '../../ops/axiom_runtime_bridge.mjs';

// Independent reference for this known JSON vector (no production hash helper).
const digest=createHash('sha256').update('{"ok":true,"result":{"value":42}}').digest('hex');
function fixture({value=42,customer='tenant-a',op='arithmetic.evaluate',hash=digest}={}){
  const writes=[];
  const db={prepare(sql){return {bind(...v){return {run:async()=>{writes.push(sql);return {success:true};},first:async()=>({request_id:v[0],operation:'arithmetic.evaluate',http_status:200,compute_units:1,result_sha256:digest})};}};}};
  const service={fetch:async(_url,init)=>Response.json({ok:true,result:{value},axiom:{usage:'excluded transport metadata'},receipt:{customer_id:customer,request_id:init.headers['x-musitu-request-id'],operation:op,result_sha256:hash}})};
  return {writes,bridge:createProtectedRuntimeBridge({db,service,tokenFactory:()=> 'delegated_fixture_token_abcdefghijklmnopqrstuvwxyz0123456789'})};
}
const input={customer_id:'tenant-a',operation:'arithmetic.evaluate',args:{expression:'40+2'},request_id:'request-a'};
test('protected result must match actual canonical response and trusted scoped ledger',async()=>{
  const f=fixture();const r=await f.bridge.execute(input);
  assert.equal(r.result.value,42);assert.equal(r.receipt.result_commitment_verified,true);
  assert.equal(r.receipt.result_sha256,digest);
});
test('changed result, tenant, operation or receipt digest is rejected and delegated key cleaned',async()=>{
  for(const options of [{value:999},{customer:'tenant-b'},{op:'finance.npv'},{hash:'a'.repeat(64)}]){
    const f=fixture(options);
    await assert.rejects(()=>f.bridge.execute(input),/commitment mismatch|receipt identity mismatch/);
    assert.ok(f.writes.some(s=>s.startsWith('DELETE FROM api_keys')));
  }
});
