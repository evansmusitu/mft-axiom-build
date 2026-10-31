import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runPrivatePaynowTestingReview} from './paynow-testing-review-cli.mjs';

const ledgerInput={integration_id:'27721',testing:true,reference:'STORE-0123456789ABCDEF',amount:'1.00',pollurl:'https://www.paynow.co.zw/Interface/CheckPayment/?guid=11111111-2222-3333-4444-555555555555'};
const callback='reference=STORE-0123456789ABCDEF&status=Created&hash='+('A'.repeat(128));
const safeEnv=()=>({STORE_PAYNOW_ID:'27721',STORE_PAYNOW_MODE:'testing',STORE_CHECKOUT_ENABLED:'false',STORE_CALLBACKS_CERTIFIED:'false',STORE_ENTITLEMENTS_ENABLED:'false',STORE_PUBLISHER_PAYOUTS_ENABLED:'false',STORE_FIRST_PARTY_ONLY:'true',STORE_PAYNOW_INTEGRATION_KEY:'local-disposable-secret-not-real',STORE_TEST_REVIEW_APPROVED:'true'});
function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'store-testing-review-'));
 chmodSync(dir,0o700);
 const ledger=join(dir,'ledger');mkdirSync(ledger,{mode:0o700});
 const order=join(dir,'order.json'),cb=join(dir,'callback.txt');
 writeFileSync(order,JSON.stringify(ledgerInput)+'\n',{mode:0o600});
 writeFileSync(cb,callback,{mode:0o600});
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return {dir,order,cb,ledger,args:['--order',order,'--callback',cb,'--ledger',ledger]};
}
test('blocks testing review if checkout is enabled, before any provider contact',async t=>{
 const f=setup(t);let requests=0;
 await assert.rejects(runPrivatePaynowTestingReview({args:f.args,env:{...safeEnv(),STORE_CHECKOUT_ENABLED:'true'},reviewImpl:async()=>{requests++;}}),/private|disabled|not authorized|gate/i);
 assert.equal(requests,0);
});

test('valid private review invokes pinned provider review exactly once and cannot issue entitlement',async t=>{
 const f=setup(t);let seen=[];
 const r=await runPrivatePaynowTestingReview({args:f.args,env:safeEnv(),reviewImpl:async x=>{
  seen.push(x);
  return {state:'REVIEW_RECORDED_PRIVATE_ONLY',eventCount:1,
   manualReviewLocked:true,entitlementGranted:false,
   publisherSettlementAuthorized:false,refundFinalized:false};
 }});
 assert.equal(seen.length,1);
 assert.equal(seen[0].order.reference,ledgerInput.reference);
 assert.equal(seen[0].callbackBody,callback);
 assert.equal(seen[0].ledgerDirectory,f.ledger);
 assert.equal(r.code,'STORE_PAYNOW_27721_TESTING_REVIEW_RECORDED');
 assert.equal(r.entitlementGranted,false);
 assert.equal(r.publisherSettlementAuthorized,false);
 assert.equal(r.realMoneyCertified,false);
 assert.equal(r.phase1Accepted,false);
 assert.equal(JSON.stringify(r).includes(safeEnv().STORE_PAYNOW_INTEGRATION_KEY),false);
});

test('all financial flags, wrong merchant or nonapproved review fail before provider call',async t=>{
 const f=setup(t);let called=0;
 for(const [key,value] of [
  ['STORE_PAYNOW_ID','99999'],['STORE_PAYNOW_MODE','live'],
  ['STORE_FIRST_PARTY_ONLY','false'],['STORE_TEST_REVIEW_APPROVED','false'],
  ['STORE_CHECKOUT_ENABLED','true'],['STORE_CALLBACKS_CERTIFIED','true'],
  ['STORE_ENTITLEMENTS_ENABLED','true'],['STORE_PUBLISHER_PAYOUTS_ENABLED','true'],
  ['STORE_PAYNOW_INTEGRATION_KEY','short']
 ]){
  await assert.rejects(runPrivatePaynowTestingReview({args:f.args,
    env:{...safeEnv(),[key]:value},reviewImpl:async()=>{called++;}}),/denied/);
 }
 assert.equal(called,0);
});

test('malformed, extra, duplicate or unsupported arguments fail before provider contact',async t=>{
 const f=setup(t);let called=0;
 for(const args of [[],['--order',f.order],
  ['--order',f.order,'--callback',f.cb,'--callback',f.cb],
  ['--order',f.order,'--callback',f.cb,'--ledger',f.ledger,'--merchant-key','secret'],
  ['--order',f.order,'--callback',f.cb,'--ledger',f.order],
  ['--order','order.json','--callback',f.cb,'--ledger',f.ledger]]){
  await assert.rejects(runPrivatePaynowTestingReview({args,env:safeEnv(),reviewImpl:async()=>{called++;}}),/denied/);
 }
 assert.equal(called,0);
});

test('no access to loosely protected order or callback, or symlink',async t=>{
 const f=setup(t);let called=0;
 chmodSync(f.order,0o644);
 await assert.rejects(runPrivatePaynowTestingReview({args:f.args,env:safeEnv(),reviewImpl:async()=>{called++;}}),/denied/);
 chmodSync(f.order,0o600);
 const link=join(f.dir,'order-link');symlinkSync(f.order,link);
 await assert.rejects(runPrivatePaynowTestingReview({args:['--order',link,'--callback',f.cb,'--ledger',f.ledger],env:safeEnv(),reviewImpl:async()=>{called++;}}),/denied/);
 assert.equal(called,0);
});

test('only matching signed-order shape and capped TESTING amount reach provider',async t=>{
 const f=setup(t);let called=0;
 for(const change of [{integration_id:'999'},{testing:false},{reference:'OTHER-1234567890123456'},
  {amount:'100.00'},{amount:'0.00'},{pollurl:123},{entitlementGranted:true}]){
  writeFileSync(f.order,JSON.stringify({...ledgerInput,...change})+'\n',{mode:0o600});
  await assert.rejects(runPrivatePaynowTestingReview({args:f.args,env:safeEnv(),reviewImpl:async()=>{called++;}}),/denied/);
 }
 assert.equal(called,0);
});

test('refuses success claims from a provider reviewer returning payment powers',async t=>{
 const f=setup(t);
 await assert.rejects(runPrivatePaynowTestingReview({args:f.args,env:safeEnv(),
  reviewImpl:async()=>({state:'REVIEW_RECORDED_PRIVATE_ONLY',eventCount:1,
   manualReviewLocked:false,entitlementGranted:true,
   publisherSettlementAuthorized:false,refundFinalized:false})}),/denied/);
});

test('injection forbidden unless CI=true',async t=>{
 const f=setup(t);const before=process.env.CI;
 process.env.CI='false';
 try{await assert.rejects(runPrivatePaynowTestingReview({args:f.args,env:safeEnv(),
    reviewImpl:async()=>({})}),/denied/);}
 finally{if(before===undefined)delete process.env.CI;else process.env.CI=before;}
});
