import test from 'node:test';
import assert from 'node:assert/strict';
import {FA16_BOUNDARY,FA16_PREEXISTING_PHONE_EVIDENCE,FA16BoundaryError,FA16OfflineQueue,FA16ReconnectSupervisor,evaluatePWAInstallState,evaluateRealDeviceEvidence,sha256} from '../fa16_pwa_engine.js';

const instant=new Date('2026-09-16T06:00:00.000Z');
const queue=()=>new FA16OfflineQueue({clock:()=>instant,idFactory:prefix=>`${prefix}:fixed`});
const input=()=>({kind:'SUPERVISION_NOTE',risk_class:'S1',payload:{work_id:'work-1',note:'Review the verified result.'},authority_snapshot:{actor_id:'user-1',project_id:'project-1',scopes:['mobile.supervision.note'],max_risk_class:'S1'},action_id:'action-1',idempotency_key:'idem-1'});
async function rejectsCode(fn,code){await assert.rejects(fn,error=>error instanceof FA16BoundaryError&&error.code===code);}

test('canonical SHA-256 does not depend on object insertion order',async()=>{
  assert.equal(await sha256({b:2,a:{d:4,c:3}}),await sha256({a:{c:3,d:4},b:2}));
});

test('queue accepts an allow-listed local S1 draft and binds preview plus authority',async()=>{
  const q=queue();const preview=await q.prepare(input());const record=await q.enqueue(preview,preview.preview_sha256);
  assert.equal(record.status,'QUEUED');assert.equal(record.external,false);assert.match(record.envelope_sha256,/^[a-f0-9]{64}$/);assert.match(record.authority_sha256,/^[a-f0-9]{64}$/);assert.equal(await q.verifyRecord(record),true);
});

test('queue rejects high-risk, external, public, destructive, unknown-field and secret-bearing work',async()=>{
  const q=queue();
  await rejectsCode(()=>q.prepare({...input(),risk_class:'S2'}),'RISK_NOT_OFFLINE_SAFE');
  await rejectsCode(()=>q.prepare({...input(),external:true}),'CONSEQUENTIAL_OFFLINE_ACTION');
  await rejectsCode(()=>q.prepare({...input(),public_effect:true}),'CONSEQUENTIAL_OFFLINE_ACTION');
  await rejectsCode(()=>q.prepare({...input(),destructive:true}),'CONSEQUENTIAL_OFFLINE_ACTION');
  await rejectsCode(()=>q.prepare({...input(),payload:{...input().payload,url:'https://example.test'}}),'PAYLOAD_FIELDS');
  await rejectsCode(()=>q.prepare({...input(),payload:{work_id:'work-1',note:'Bearer abc.def.ghi'}}),'SECRET_VALUE');
  await rejectsCode(()=>q.prepare({...input(),payload:{work_id:'work-1',note:'github_pat_1234567890abcdefghijklmnopqrstuvwxyz1234567890'}}),'SECRET_VALUE');
});

test('stale preview and tampered queue records fail closed',async()=>{
  const q=queue();const preview=await q.prepare(input());
  await rejectsCode(()=>q.enqueue({...preview,payload:{...preview.payload,note:'changed'}},preview.preview_sha256),'PREVIEW_MISMATCH');
  const record=await q.enqueue(preview,preview.preview_sha256);const tampered=structuredClone(record);tampered.payload.note='changed after persistence';
  const fresh=queue();await rejectsCode(()=>fresh.hydrate([tampered]),'RECORD_TAMPER');
  const authorityTampered=structuredClone(record);authorityTampered.authority_snapshot.scopes.push('mobile.external');
  await rejectsCode(()=>fresh.hydrate([authorityTampered]),'AUTHORITY_TAMPER');
});

test('offline replay defers; online replay requires exact policy revalidation and is idempotent',async()=>{
  const q=queue();const preview=await q.prepare(input());const record=await q.enqueue(preview,preview.preview_sha256);
  assert.equal((await q.replay(record.action_id,{online:false})).status,'DEFERRED_OFFLINE');
  assert.equal((await q.replay(record.action_id,{online:true})).status,'AWAITING_POLICY_REVALIDATION');
  assert.equal((await q.replay(record.action_id,{online:true,policyRevalidate:async()=>({authorized:true,scope:'wrong',authority_sha256:record.authority_sha256})})).status,'BLOCKED_POLICY_REVALIDATION');
  let applied=0;const options={online:true,policyRevalidate:async()=>({authorized:true,scope:record.scope,authority_sha256:record.authority_sha256}),applyLocal:async()=>{applied+=1;return {stored:true};}};
  const receipt=await q.replay(record.action_id,options);const duplicate=await q.replay(record.action_id,options);
  assert.equal(receipt.status,'COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT');assert.equal(receipt.external_side_effect,false);assert.equal(duplicate.receipt_sha256,receipt.receipt_sha256);assert.equal(applied,1);
});

test('browser online signal is not accepted without a successful origin probe',async()=>{
  const q=queue();const supervisor=new FA16ReconnectSupervisor({queue:q});
  assert.equal((await supervisor.reconnect({browser_online:true})).state,'ONLINE_SIGNAL_UNVERIFIED');
  assert.equal((await supervisor.reconnect({browser_online:true,probe:async()=>false})).state,'OFFLINE_UNREACHABLE');
  assert.equal((await supervisor.reconnect({browser_online:false})).state,'OFFLINE');
});

test('verified reconnect replays queued local work but never produces an external side effect',async()=>{
  const q=queue();const preview=await q.prepare(input());const record=await q.enqueue(preview,preview.preview_sha256);const supervisor=new FA16ReconnectSupervisor({queue:q});
  const result=await supervisor.reconnect({browser_online:true,probe:async()=>true,policyRevalidate:async row=>({authorized:true,scope:row.scope,authority_sha256:row.authority_sha256}),applyLocal:async()=>({stored:true})});
  assert.equal(result.state,'ONLINE_SYNCED');assert.equal(result.receipts[0].status,'COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT');assert.equal(result.receipts[0].external_side_effect,false);
});

test('PWA installation is not claimed from service-worker control or prompt availability',()=>{
  assert.deepEqual(evaluatePWAInstallState({service_worker_controlled:true}),{status:'PWA_SHELL_ACTIVE_INSTALL_NOT_PROVEN',installed:false,prompt_allowed:false});
  assert.deepEqual(evaluatePWAInstallState({prompt_available:true}),{status:'INSTALL_PROMPT_READY',installed:false,prompt_allowed:true});
  assert.equal(evaluatePWAInstallState({appinstalled_event:true}).installed,true);
});

test('authoritative phone evidence is preserved while tablet remains customer-deferred',async()=>{
  assert.equal(FA16_BOUNDARY.realDeviceStatus,'REAL_PHONE_EVIDENCED_TABLET_PENDING_CUSTOMER');
  assert.equal(FA16_BOUNDARY.phoneEvidenceSha256,'03478e2f17eb82f68417c826e86c29a1fed716d57d5fbe1e81f4d5f1c49a42f6');
  assert.equal(FA16_PREEXISTING_PHONE_EVIDENCE.status,'EVIDENCED');
  const result=await evaluateRealDeviceEvidence([]);
  assert.equal(result.status,'REAL_PHONE_EVIDENCED_TABLET_PENDING_CUSTOMER');assert.equal(result.phase_exit_earned,false);assert.equal(result.phase_progression_authorized,true);
  assert.deepEqual(result.verified_scenarios,['PHONE_PORTRAIT','OFFLINE_RELOAD','RECONNECT_REPLAY']);assert.deepEqual(result.missing_scenarios,['TABLET_PORTRAIT']);
  assert.equal(result.tablet_evidence,'DEFERRED_PENDING_FUTURE_CUSTOMER');
});

test('emulated or self-declared tablet evidence cannot close the deferred gate',async()=>{
  const tablet={scenario:'TABLET_PORTRAIT',evidence_origin:'PHYSICAL_DEVICE',capture_mode:'DIRECT_DEVICE_CAPTURE',emulated:false,artifact_sha256:'a'.repeat(64),device_pseudonym:'customer-tablet-1',observed_at:'2026-09-16T06:00:00Z'};
  const noVerifier=await evaluateRealDeviceEvidence([tablet]);assert.equal(noVerifier.status,'REAL_PHONE_EVIDENCED_TABLET_PENDING_CUSTOMER');assert.equal(noVerifier.phase_exit_earned,false);assert.deepEqual(noVerifier.rejected_scenarios,['TABLET_PORTRAIT']);
  const emulated=await evaluateRealDeviceEvidence([{...tablet,emulated:true}],{verifyAttestation:async()=>true});assert.equal(emulated.phase_exit_earned,false);assert.deepEqual(emulated.rejected_scenarios,['TABLET_PORTRAIT']);
  const externallyVerified=await evaluateRealDeviceEvidence([tablet],{verifyAttestation:async()=>true});assert.equal(externallyVerified.status,'REAL_DEVICE_MATRIX_EXTERNALLY_VERIFIED');assert.equal(externallyVerified.phase_exit_earned,true);assert.equal(externallyVerified.tablet_evidence,'EXTERNALLY_VERIFIED');
});
