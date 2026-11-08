import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../qualification/pr77_synthetic_d1_worker_20261108.mjs';

test('Cloudflare third fetch argument is execution ctx, not synthetic fixture',async()=>{
 const fixture={plan_sha256:'6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a',seed:Array(41).fill('SELECT 1'),plan:Array(89).fill('SELECT 1')};
 const original=globalThis.__AXIOM_PR77_SYNTHETIC__;
 globalThis.__AXIOM_PR77_SYNTHETIC__=fixture;
 try{
   const token='e'.repeat(64);
   const env={TOKEN:token,RUN:'axiom-pr77-synthetic-20261108-01',EXPIRES:String(Date.now()+120000),EPOCH:'synthetic'};
   const context={waitUntil(){},passThroughOnException(){}};
   const req=new Request('https://synthetic.invalid/health',{headers:{authorization:'Bearer '+token}});
   const response=await worker.fetch(req,env,context);
   assert.equal(response.status,200,'The real Worker fetch(runtimeRequest, bindings, executionContext) must read its fixed generated fixture, not interpret executionContext as SQL fixture');
   const payload=await response.json();
   assert.equal(payload.run_id,env.RUN);
   assert.equal(payload.origin,'SYNTHETIC_ONLY');
   assert.equal(payload.release_authority,false);
 }finally{
   if(original===undefined)delete globalThis.__AXIOM_PR77_SYNTHETIC__;
   else globalThis.__AXIOM_PR77_SYNTHETIC__=original;
 }
});
