import test from 'node:test';
import assert from 'node:assert/strict';
import {safeQuotaOutcome,OperationDenied} from '../src/admission.mjs';
class QuotaDenied extends Error {constructor(code){super(code);this.name='Denied';}}

test('known independently signed workload denial returns explicit no-dispatch receipt',async()=>{
  const result=await safeQuotaOutcome(async()=>{throw new OperationDenied('WORKLOAD_SIGNATURE_INVALID');},[OperationDenied,QuotaDenied]);
  assert.deepEqual(result,{status:'DENIED',dispatch_allowed:false,reason:'WORKLOAD_SIGNATURE_INVALID'});
});
test('known quota-cap denial returns explicit no-dispatch receipt',async()=>{
  const result=await safeQuotaOutcome(async()=>{throw new QuotaDenied('ACCOUNT_DAILY_CAPACITY_EXHAUSTED');},[OperationDenied,QuotaDenied]);
  assert.equal(result.dispatch_allowed,false);assert.equal(result.reason,'ACCOUNT_DAILY_CAPACITY_EXHAUSTED');
});
test('unknown runtime fault is never hidden as denial',async()=>{
  await assert.rejects(()=>safeQuotaOutcome(async()=>{throw new TypeError('database-corruption');},[OperationDenied,QuotaDenied]),/database-corruption/);
});
test('authorized positive receipt is not changed',async()=>{
  const receipt={status:'RESERVED',dispatch_allowed:true,remaining:400};
  assert.equal(await safeQuotaOutcome(async()=>receipt,[OperationDenied,QuotaDenied]),receipt);
});
