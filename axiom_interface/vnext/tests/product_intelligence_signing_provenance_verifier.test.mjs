import assert from 'node:assert/strict';
import test from 'node:test';
import {createCosignProvenanceSigner,createIndependentCosignProvenanceVerifier} from '../product_intelligence/signing_provenance.js';
import {NOW,scope,digest,statement,lease,signerClient,verifierClient} from './signing_provenance_test_fixture.mjs';
async function signed(){const p=statement();return {p,s:await createCosignProvenanceSigner({client:signerClient(),clock:()=>NOW}).sign({...scope,artifactName:'artifact.tar.zst',artifactDigestSha256:digest,statement:p,workloadIdentityId:'agent_signer_12345678',credentialLease:lease(),requestId:'sign_request_12345678'})};}

test('independent verifier must differ from builder/signer and fails closed on tamper or verification mismatch',async()=>{
  const {p,s}=await signed();
  for(const verifierWorkloadIdentityId of ['agent_builder_12345678','agent_signer_12345678']){
    const v=createIndependentCosignProvenanceVerifier({client:verifierClient(),verifierWorkloadIdentityId});
    await assert.rejects(()=>v.verify({...scope,artifactDigestSha256:digest,statement:p,signedEvidence:s}),/independent verifier must differ/);
  }
  const verifier=createIndependentCosignProvenanceVerifier({client:verifierClient(),verifierWorkloadIdentityId:'agent_verifier_12345678'});
  await assert.rejects(()=>verifier.verify({...scope,artifactDigestSha256:'e'.repeat(64),statement:p,signedEvidence:s}),/artifact digest mismatch/);
  const tampered=structuredClone(p); tampered.predicate.buildDefinition.externalParameters.target='tampered-target';
  await assert.rejects(()=>verifier.verify({...scope,artifactDigestSha256:digest,statement:tampered,signedEvidence:s}),/statement digest mismatch/);
  await assert.rejects(()=>verifier.verify({...scope,artifactDigestSha256:digest,statement:p,signedEvidence:{...s,builder_identity_id:'agent_other_builder_12345678'}}),/builder identity mismatch/);
  const v2=createIndependentCosignProvenanceVerifier({client:verifierClient({verify:{bundle_sha256:'f'.repeat(64)}}),verifierWorkloadIdentityId:'agent_verifier_12345678'});
  await assert.rejects(()=>v2.verify({...scope,artifactDigestSha256:digest,statement:p,signedEvidence:s}),/verification bundle digest mismatch/);
});

test('verifier rejects provider denial and provider authority claims instead of manufacturing PASS',async()=>{
  const {p,s}=await signed();
  const denied=createIndependentCosignProvenanceVerifier({client:verifierClient({verify:{verified:false}}),verifierWorkloadIdentityId:'agent_verifier_12345678'});
  await assert.rejects(()=>denied.verify({...scope,artifactDigestSha256:digest,statement:p,signedEvidence:s}),/verification failed/);
  const authority=createIndependentCosignProvenanceVerifier({client:verifierClient({verify:{release_authority:true}}),verifierWorkloadIdentityId:'agent_verifier_12345678'});
  await assert.rejects(()=>authority.verify({...scope,artifactDigestSha256:digest,statement:p,signedEvidence:s}),/forbidden authority/);
});

test('independent verification PASS remains verification-only and cannot grant release/production authority',async()=>{
  const {p,s}=await signed(); const c=verifierClient();
  const r=await createIndependentCosignProvenanceVerifier({client:c,verifierWorkloadIdentityId:'agent_verifier_12345678'}).verify({...scope,artifactDigestSha256:digest,statement:p,signedEvidence:s});
  assert.deepEqual([r.status,r.independent_verification,r.actor_id,r.artifact_sha256,r.authority_effect,r.release_authority,r.production_authority,r.certification_authority],['PASS','PASS','agent_verifier_12345678',digest,'VERIFICATION_ONLY',false,false,false]);
  assert.equal(c.calls[0].bundle_format,'SIGSTORE_BUNDLE_V3'); assert.equal(c.calls[0].legacy_bundle_allowed,false);
});
