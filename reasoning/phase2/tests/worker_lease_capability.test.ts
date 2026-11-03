import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalize } from "../../phase1/src/canonical.ts";
import {
  prepareWorkerLeaseCapability, finalizeWorkerLeaseCapability, verifyWorkerLeaseCapability,
  workerLeaseCapabilityHash, createStaticWorkerLeaseSigner, type WorkerLeaseCapabilityCore
} from "../src/worker_lease_capability.ts";
const fixture=()=>{
  const keys=generateKeyPairSync("ed25519");
  const core:WorkerLeaseCapabilityCore={
    protocolVersion:"axiom.worker-lease/v1",workerId:"worker:alpha",
    workerKeyId:"worker-key:alpha:v1",poolId:"pool:secure",
    tenantId:"tenant:one",jobId:"execution-job:abc",intentHash:"a".repeat(64),
    leaseEpoch:7,leaseExpiresAt:"2026-10-09T16:00:10.000Z",
    allowedActions:["HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"],
    signerKeyId:"lease-key:one"
  };
  return {core,keys};
};
test("lease capability binds exact worker, pool, tenant, intent, epoch, expiry and allowed operations",()=>{
  const {core,keys}=fixture();
  const signer=createStaticWorkerLeaseSigner("lease-key:one",keys);
  const capability=signer.issue(core);
  assert.deepEqual(capability.core,core);
  assert.equal(capability.capabilityId,workerLeaseCapabilityHash(capability));
  assert.equal(verifyWorkerLeaseCapability(capability,{"lease-key:one":keys.publicKey}),true);
  assert.equal(signer.trustedPublicKeyPem("lease-key:one")!==undefined,true);
  assert.equal(signer.identity.protocolVersion,"axiom.worker-lease-signer/v1");
  assert.equal(signer.identity.keyId,"lease-key:one");
});
test("every authority-bearing lease field is signature bound",()=>{
  const {core,keys}=fixture();
  const signer=createStaticWorkerLeaseSigner("lease-key:one",keys);
  const original=signer.issue(core);
  const changes=[
    {workerId:"worker:attacker"},{workerKeyId:"worker-key:other"},
    {poolId:"pool:other"},{tenantId:"tenant:other"},
    {jobId:"job:other"},{intentHash:"b".repeat(64)},
    {leaseEpoch:8},{leaseExpiresAt:"2026-10-09T16:00:11.000Z"},
    {allowedActions:["RELEASE"] as WorkerLeaseCapabilityCore["allowedActions"]},
    {signerKeyId:"lease-key:other"}
  ];
  for(const change of changes)assert.equal(
    verifyWorkerLeaseCapability({...original,core:{...original.core,...change}},{"lease-key:one":keys.publicKey}),false
  );
});
test("different trust ring or wrong key and malformed signatures fail closed",()=>{
  const {core,keys}=fixture();
  const attacker=generateKeyPairSync("ed25519");
  const signer=createStaticWorkerLeaseSigner("lease-key:one",keys);
  const capability=signer.issue(core);
  assert.equal(verifyWorkerLeaseCapability(capability,{"lease-key:one":attacker.publicKey}),false);
  assert.equal(verifyWorkerLeaseCapability(capability,{"lease-key:other":keys.publicKey}),false);
  for(const signatureBase64 of ["short",capability.signatureBase64+"=",capability.signatureBase64.slice(1)])
    assert.equal(verifyWorkerLeaseCapability({...capability,signatureBase64},{"lease-key:one":keys.publicKey}),false);
});
test("prepared lease capability cannot be changed between preparation and finalization",()=>{
  const {core,keys}=fixture();
  const prepared=prepareWorkerLeaseCapability(core);
  const signature=sign(null,Buffer.from(canonicalize(prepared.signingPayload)),keys.privateKey).toString("base64");
  const certificate=finalizeWorkerLeaseCapability(prepared,keys.publicKey,signature);
  assert.equal(verifyWorkerLeaseCapability(certificate,{"lease-key:one":keys.publicKey}),true);
  const mutated=structuredClone(prepared);
  mutated.core.leaseEpoch+=1;
  assert.throws(()=>finalizeWorkerLeaseCapability(mutated,keys.publicKey,signature));
  const twice=finalizeWorkerLeaseCapability(prepared,keys.publicKey,signature);
  assert.deepEqual(certificate,twice);
});
test("lease capability parser rejects duplicate, reordered, unknown or missing actions",()=>{
  const {core}=fixture();
  assert.throws(()=>prepareWorkerLeaseCapability({...core,allowedActions:["HEARTBEAT","HEARTBEAT"]}));
  assert.throws(()=>prepareWorkerLeaseCapability({...core,allowedActions:["COMPLETE","RELEASE"]}));
  assert.throws(()=>prepareWorkerLeaseCapability({...core,allowedActions:[]}));
  assert.throws(()=>prepareWorkerLeaseCapability({...core,leaseEpoch:0}));
  assert.throws(()=>prepareWorkerLeaseCapability({...core,intentHash:"not-hash"}));
});
