import assert from 'node:assert/strict';
import test from 'node:test';
import {createCosignProvenanceSigner} from '../product_intelligence/signing_provenance.js';
import {NOW,scope,digest,statement,lease,signerClient} from './signing_provenance_test_fixture.mjs';

test('signer accepts only an opaque short-lived SecretBroker handle and binds signature to digest+statement',async()=>{
  const c=signerClient(), s=createCosignProvenanceSigner({client:c,clock:()=>NOW}); const p=statement();
  const r=await s.sign({...scope,artifactName:'artifact.tar.zst',artifactDigestSha256:digest,statement:p,workloadIdentityId:'agent_signer_12345678',credentialLease:lease(),requestId:'sign_request_12345678'});
  assert.deepEqual([r.artifact_digest_sha256,r.bundle_sha256,r.signature_sha256,r.signer_workload_identity_id,r.independent_verification,r.authority_effect,r.release_authority],[digest,'c'.repeat(64),'d'.repeat(64),'agent_signer_12345678','NOT_PROVEN','NONE',false]);
  assert.equal(c.calls.length,1); assert.equal(c.calls[0].credential_handle,'handle_12345678'); assert.equal(c.calls[0].artifact_digest_sha256,digest); assert.equal(c.calls[0].statement_sha256,r.statement_sha256); assert.equal(c.calls[0].cosign_version,'3.1.3'); assert.equal(c.calls[0].in_toto_version,'3.1.0');
  assert.equal(JSON.stringify(c.calls[0]).includes('kv/axiom/signing'),false); assert.equal(JSON.stringify(c.calls[0]).includes('private_key'),false);
});

test('signer fails closed on expired/cross-project leases, plaintext credentials, legacy bundles and provider authority claims',async()=>{
  const p=statement(), base={...scope,artifactName:'artifact.tar.zst',artifactDigestSha256:digest,statement:p,workloadIdentityId:'agent_signer_12345678',requestId:'sign_request_12345678'};
  const s=createCosignProvenanceSigner({client:signerClient(),clock:()=>NOW});
  await assert.rejects(()=>s.sign({...base,credentialLease:{...lease(),expires_at:new Date(NOW-1).toISOString()}}),/expired/);
  await assert.rejects(()=>s.sign({...base,credentialLease:{...lease(),project_id:'project_other'}}),/cross-project/);
  await assert.rejects(()=>s.sign({...base,credentialLease:{...lease(),private_key:'raw'}}),e=>e?.name==='SecurityError');
  await assert.rejects(()=>createCosignProvenanceSigner({client:signerClient({sign:{bundle_format:'LEGACY_JSON'}}),clock:()=>NOW}).sign({...base,credentialLease:lease()}),/bundle format/);
  await assert.rejects(()=>createCosignProvenanceSigner({client:signerClient({sign:{release_authority:true}}),clock:()=>NOW}).sign({...base,credentialLease:lease()}),/forbidden authority/);
});

test('signer rejects provenance whose subject or project/work binding does not match requested artifact',async()=>{
  const s=createCosignProvenanceSigner({client:signerClient(),clock:()=>NOW}); const p=statement(); const base={...scope,artifactName:'artifact.tar.zst',artifactDigestSha256:digest,workloadIdentityId:'agent_signer_12345678',credentialLease:lease(),requestId:'sign_request_12345678'};
  await assert.rejects(()=>s.sign({...base,artifactDigestSha256:'e'.repeat(64),statement:p}),/subject digest mismatch/);
  const other=structuredClone(p); other.predicate.buildDefinition.externalParameters.project_id='project_other';
  await assert.rejects(()=>s.sign({...base,statement:other}),/project\/work binding mismatch/);
});
