import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
import test from 'node:test';
import {assessMmfSharedPaynowReadback} from '../src/commercial/paynow-binding-evidence.mjs';
const audit=JSON.parse(readFileSync(new URL('../docs/2026-10-11-paynow-real-authority-readonly.json',import.meta.url),'utf8'));
test('real shared merchant is confirmed without confusing FMI checkout with MMF billing',()=>{
 const result=assessMmfSharedPaynowReadback(audit,{nowMs:Date.parse('2026-10-11T06:34:00Z')});
 assert.equal(result.sharedMerchantStack,'READ_ONLY_VERIFIED');
 assert.equal(result.fmiPaymentIsolationPreserved,true);
 assert.equal(result.mmfBillingStatus,'BLOCKED_MMF_BINDING_ABSENT');
 assert.equal(result.mayInitiateCheckout,false);
 assert.equal(result.mayAcceptRealMoney,false);
 assert.equal(result.maySendCustomerMail,false);
 assert.ok(result.missing.includes('MMF_SCOPED_AUTHORITY'));
 assert.ok(result.missing.includes('MMF_SCOPED_BILLING_WORKER'));
});
test('readback fails closed for invented MMF product routes and stale/incomplete evidence',()=>{
 const malformed=[
  {}, {...audit,account_verified:false}, {...audit,cloudflare_mutations:true},
  {...audit,workers:[]}, {...audit,workers:[...audit.workers,audit.workers[0]]},
  {...audit,workers:audit.workers.map(w=>({...w,source_sha256:'x'}))},
  {...audit,raw_merchant_secrets_exposed:true},
  {...audit,observedAtUtc:'2026-10-09T06:33:04.636Z'},
 ];
 for(const x of malformed)assert.throws(()=>assessMmfSharedPaynowReadback(x,{nowMs:Date.parse('2026-10-11T06:34:00Z')}),/READBACK_DENIED/);
});
