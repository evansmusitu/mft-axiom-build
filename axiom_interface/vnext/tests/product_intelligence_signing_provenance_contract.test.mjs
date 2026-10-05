import assert from 'node:assert/strict';
import test from 'node:test';
import {SIGNING_PROVENANCE_PROFILE,createSlsaProvenanceStatement,createCosignProvenanceSigner} from '../product_intelligence/signing_provenance.js';
import {NOW,scope,digest,statement,signerClient} from './signing_provenance_test_fixture.mjs';

test('profile pins cosign/in-toto/SLSA and grants no release or certification authority',()=>{
  assert.deepEqual([SIGNING_PROVENANCE_PROFILE.cosign_version,SIGNING_PROVENANCE_PROFILE.in_toto_version,SIGNING_PROVENANCE_PROFILE.statement_type,SIGNING_PROVENANCE_PROFILE.predicate_type],['3.1.3','3.1.0','https://in-toto.io/Statement/v1','https://slsa.dev/provenance/v1']);
  assert.equal(SIGNING_PROVENANCE_PROFILE.semantic_owner,'AXIOM'); assert.equal(SIGNING_PROVENANCE_PROFILE.provider_authority,'MECHANISM_ONLY');
  assert.equal(SIGNING_PROVENANCE_PROFILE.legacy_bundle_allowed,false); assert.equal(SIGNING_PROVENANCE_PROFILE.release_authority,false); assert.equal(SIGNING_PROVENANCE_PROFILE.certification_authority,false); assert.equal(SIGNING_PROVENANCE_PROFILE.live_runtime_qualification,'NOT_PROVEN');
});

test('SLSA provenance binds exact project/work identity, artifact digest, builder and dependencies',()=>{
  const p=statement();
  assert.equal(p._type,'https://in-toto.io/Statement/v1'); assert.equal(p.predicateType,'https://slsa.dev/provenance/v1');
  assert.deepEqual(p.subject,[{name:'artifact.tar.zst',digest:{sha256:digest}}]);
  assert.equal(p.predicate.buildDefinition.externalParameters.project_id,scope.projectId); assert.equal(p.predicate.buildDefinition.externalParameters.work_id,scope.workId);
  assert.equal(p.predicate.buildDefinition.resolvedDependencies[0].digest.sha256,'b'.repeat(64)); assert.equal(p.predicate.runDetails.builder.id,'agent_builder_12345678'); assert.equal(p.predicate.runDetails.metadata.invocationId,'build_12345678');
});

test('provenance rejects malformed hashes and credential-bearing parameters before signing',()=>{
  assert.throws(()=>createSlsaProvenanceStatement({...scope,artifactName:'x',artifactDigestSha256:'bad',builderIdentityId:'builder_12345678',invocationId:'build_12345678'}),/sha256/);
  assert.throws(()=>createSlsaProvenanceStatement({...scope,artifactName:'x',artifactDigestSha256:digest,builderIdentityId:'builder_12345678',invocationId:'build_12345678',externalParameters:{nested:{api_key:'raw'}}}),e=>e?.name==='SecurityError'&&/credential material/.test(e.message));
});

test('health requires exact mechanism versions but never promotes health to runtime qualification',async()=>{
  const s=createCosignProvenanceSigner({client:signerClient(),clock:()=>NOW}); const good=await s.health(); assert.deepEqual([good.status,good.cosign_version,good.in_toto_version,good.live_runtime_qualification],['PASS','3.1.3','3.1.0','NOT_PROVEN']);
  const bad=createCosignProvenanceSigner({client:signerClient({health:{cosign_version:'3.1.2'}}),clock:()=>NOW}); const r=await bad.health(); assert.equal(r.status,'FAIL'); assert.equal(r.live_runtime_qualification,'NOT_PROVEN');
});
