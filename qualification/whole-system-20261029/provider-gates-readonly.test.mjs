import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifySavedCancellation,inspectProviderGates} from './provider-gates-readonly-20261101.mjs';
import {sanitizedMember,readAuthorityRoles} from './authority-provider-reconcile09.mjs';
test('only an exact saved request identity and provider abort record can confirm cancellation',()=>{
  const ray='a53c044b0eda9b36';
  assert.equal(classifySavedCancellation([{requestId:ray,errorCode:3008,totalNeurons:4}]).status,'PROVIDER_ABORT_RECORD_CONFIRMED');
  assert.equal(classifySavedCancellation([{requestId:'different',errorCode:3008}]).status,'UNRESOLVED');
  assert.equal(classifySavedCancellation([{requestId:ray,errorCode:0}]).status,'PROVIDER_TERMINAL_ABORT_NOT_CONFIRMED');
  assert.equal(classifySavedCancellation([{requestId:ray,errorCode:3008},{requestId:ray,errorCode:3008}]).status,'UNRESOLVED');
});
test('missing request usage is unknown and cannot be converted to zero',()=>{
  assert.equal(classifySavedCancellation([]).final_usage,null);
  assert.equal(classifySavedCancellation([{requestId:'a53c044b0eda9b36',errorCode:3008}]).final_usage,null);
  assert.equal(classifySavedCancellation([{requestId:'a53c044b0eda9b36',errorCode:3008,totalNeurons:0}]).final_usage,0);
});
test('authority metadata retains provider role/MFA facts while excluding private identity fields',()=>{
  const value=sanitizedMember({id:'member-one',status:'accepted',user:{id:'user-one',email:'private@example.test',first_name:'Private',two_factor_authentication_enabled:true},roles:[{id:'role-one',name:'Administrator',private_value:'sensitive'}]});
  assert.equal(value.mfa_enabled,true);assert.equal(value.status,'accepted');assert.equal(value.roles[0].name,'Administrator');
  assert.match(value.user_sha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(value).includes('private@example.test'),false);assert.equal(JSON.stringify(value).includes('sensitive'),false);
  assert.equal(sanitizedMember({user:{}}).mfa_enabled,'NOT_EXPOSED');
});
test('unavailable authority metadata cannot establish custody and never dispatches a write',async()=>{
  let calls=0;const result=await readAuthorityRoles({token:'synthetic-read-credential',fetchImpl:async(_url,init)=>{calls++;assert.equal(init.method,'GET');assert.equal(init.redirect,'error');return Response.json({success:false,errors:[{code:10000}]},{status:403});}});
  assert.equal(calls,3);assert.equal(result.independent_custody_proven,false);assert.equal(result.remote_writes,0);assert.ok(Object.values(result.checks).every(x=>x.status==='UNAVAILABLE'));
});
test('saved-request reconciliation accepts a wider bounded window but rejects malformed windows before network access',async()=>{
  for(const savedWindow of [{start:'2026-11-01T15:40:00Z',end:'2026-11-03T00:00:00Z'},{start:'injected',end:'2026-11-01T20:00:00Z'}])await assert.rejects(()=>inspectProviderGates({token:'fixture',savedWindow,fetchImpl:()=>{throw Error('network must not be reached');}}),/bounded saved-request time window/);
  const result=classifySavedCancellation([{datetime:'2026-11-01T16:00:00Z',errorCode:3008,totalNeurons:0}]);assert.equal(result.status,'UNRESOLVED');assert.equal(result.final_usage,null,'a later or matching-time row without the saved identity is not proof');
});
