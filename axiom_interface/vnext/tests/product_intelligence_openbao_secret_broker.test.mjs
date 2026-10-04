import assert from 'node:assert/strict';
import test from 'node:test';
import {OPENBAO_SECRET_BROKER_DESCRIPTOR,createOpenBaoSecretBroker} from '../product_intelligence/backends/openbao_secret_broker.js';

const NOW=Date.parse('2026-10-04T17:50:00Z');
function client(overrides={}){const calls=[];return {calls,async issueLease(input){calls.push({kind:'issue',input:structuredClone(input)});return {lease_id:'lease_12345678',credential_handle:'handle_12345678',expires_at:new Date(NOW+120000).toISOString(),renewable:false,...overrides.issue};},async revokeLease(input){calls.push({kind:'revoke',input:structuredClone(input)});return {status:'REVOKED',...overrides.revoke};},async health(){return {status:'UP'};}};}
const req={projectId:'project_12345678',workloadIdentityId:'agent_workload_12345678',operation:'repo.mutate',secretRef:'kv/axiom/github',purpose:'one governed repository write',ttlSeconds:120,requestId:'request_12345678'};

test('OpenBao SecretBroker pins Phase-1.5 baseline and forbids plaintext/authority roles',()=>{
  assert.equal(OPENBAO_SECRET_BROKER_DESCRIPTOR.kind,'SecretBroker');
  assert.equal(OPENBAO_SECRET_BROKER_DESCRIPTOR.provider,'openbao');
  assert.equal(OPENBAO_SECRET_BROKER_DESCRIPTOR.provider_baseline,'2.7.1');
  assert.equal(OPENBAO_SECRET_BROKER_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(OPENBAO_SECRET_BROKER_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(OPENBAO_SECRET_BROKER_DESCRIPTOR.max_lease_seconds,300);
  assert.equal(OPENBAO_SECRET_BROKER_DESCRIPTOR.plaintext_secret_release,false);
});

test('issue returns only an opaque short-lived operation-scoped lease',async()=>{
  const c=client();const broker=createOpenBaoSecretBroker({client:c,clock:()=>NOW});
  const lease=await broker.issue(req);
  assert.equal(lease.project_id,req.projectId);assert.equal(lease.workload_identity_id,req.workloadIdentityId);assert.equal(lease.operation,req.operation);
  assert.equal(lease.lease_id,'lease_12345678');assert.equal(lease.credential_handle,'handle_12345678');assert.equal(lease.plaintext_secret_released,false);
  assert.equal(lease.identity_authority,false);assert.equal(lease.authorization_authority,false);assert.equal(lease.production_authority,false);
  assert.equal(c.calls[0].input.ttl_seconds,120);assert.equal(c.calls[0].input.secret_ref,'kv/axiom/github');
});

test('lease duration is bounded to 300 seconds and provider overlong expiry fails closed',async()=>{
  const broker=createOpenBaoSecretBroker({client:client(),clock:()=>NOW});
  await assert.rejects(()=>broker.issue({...req,ttlSeconds:301}),/ttlSeconds must be 1..300/);
  const bad=createOpenBaoSecretBroker({client:client({issue:{expires_at:new Date(NOW+600000).toISOString()}}),clock:()=>NOW});
  await assert.rejects(()=>bad.issue(req),/lease expiry exceeds operation scope/);
});

test('provider plaintext credential material is rejected rather than surfaced to AXIOM context',async()=>{
  for(const extra of [{secret:'raw'},{token:'raw'},{api_key:'raw'}]){
    const broker=createOpenBaoSecretBroker({client:client({issue:extra}),clock:()=>NOW});
    await assert.rejects(()=>broker.issue(req),/forbidden plaintext credential material/);
  }
});

test('revocation must be positively confirmed and remains mechanism-only',async()=>{
  const c=client();const broker=createOpenBaoSecretBroker({client:c,clock:()=>NOW});
  const revoked=await broker.revoke({projectId:req.projectId,workloadIdentityId:req.workloadIdentityId,leaseId:'lease_12345678',requestId:'request_revoke_12345678'});
  assert.equal(revoked.status,'REVOKED');assert.equal(revoked.authority_effect,'NONE');
  const bad=createOpenBaoSecretBroker({client:client({revoke:{status:'UNKNOWN'}}),clock:()=>NOW});
  await assert.rejects(()=>bad.revoke({projectId:req.projectId,workloadIdentityId:req.workloadIdentityId,leaseId:'lease_12345678',requestId:'request_revoke_12345678'}),/revocation not confirmed/);
});

test('OpenBao health is provider health only and cannot certify AXIOM',async()=>{
  const health=await createOpenBaoSecretBroker({client:client(),clock:()=>NOW}).health();
  assert.equal(health.provider_status,'UP');assert.equal(health.provider_version,'2.7.1');assert.equal(health.axiom_authority,'NONE');assert.equal(health.axiom_certification,'NOT_PROVEN');
});
