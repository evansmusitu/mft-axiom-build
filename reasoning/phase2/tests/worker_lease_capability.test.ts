import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalize } from "../../phase1/src/canonical.ts";

const H=(c:string)=>c.repeat(64);

test("worker lease capabilities are separately signed exact-bound and mutation resistant",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.prepareWorkerLeaseCapability,"function");
  assert.equal(typeof phase2.finalizeWorkerLeaseCapability,"function");
  assert.equal(typeof phase2.verifyWorkerLeaseCapability,"function");
  assert.equal(typeof phase2.workerLeaseCapabilityCoreHash,"function");
  assert.equal(typeof phase2.createStaticWorkerLeaseSigner,"function");

  const leaseKey=generateKeyPairSync("ed25519");
  const workerKey=generateKeyPairSync("ed25519");
  const signer=phase2.createStaticWorkerLeaseSigner("lease-signing:v1",leaseKey);
  const base={
    protocolVersion:"axiom.worker-lease/v1",
    workerId:"worker:a",
    workerKeyId:"worker-key:a:v1",
    poolId:"pool:trusted",
    tenantId:"tenant:a",
    jobId:"execution-job:"+H("a"),
    intentHash:H("b"),
    leaseEpoch:1,
    leaseExpiresAt:"2026-10-10T00:00:10.000Z",
    allowedActions:["HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"],
    signerKeyId:"lease-signing:v1"
  };

  const prepared=phase2.prepareWorkerLeaseCapability(base);
  assert.equal(prepared.coreHash,phase2.workerLeaseCapabilityCoreHash(base));
  const signature=sign(null,Buffer.from(canonicalize(prepared.signingPayload)),leaseKey.privateKey).toString("base64");
  const capability=phase2.finalizeWorkerLeaseCapability(prepared,leaseKey.publicKey,signature);
  assert.equal(capability.capabilityId,prepared.coreHash);
  assert.deepEqual(capability.core,base);
  assert.equal(phase2.verifyWorkerLeaseCapability(capability,leaseKey.publicKey),true);
  assert.equal(phase2.verifyWorkerLeaseCapability(capability,workerKey.publicKey),false);

  const issued=signer.issue({
    workerId:"worker:a",workerKeyId:"worker-key:a:v1",poolId:"pool:trusted",tenantId:"tenant:a",
    jobId:"execution-job:"+H("a"),intentHash:H("b"),leaseEpoch:1,
    leaseExpiresAt:"2026-10-10T00:00:10.000Z",
    allowedActions:["HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
  });
  assert.equal(issued.core.signerKeyId,"lease-signing:v1");
  assert.equal(signer.verify(issued),true);
  assert.equal(signer.trustedPublicKeyPem("lease-signing:v1")?.includes("PUBLIC KEY"),true);
  assert.equal(signer.trustedPublicKeyPem("unknown"),undefined);

  for(const mutation of [
    {workerId:"worker:b"},
    {workerKeyId:"worker-key:b:v1"},
    {poolId:"pool:other"},
    {tenantId:"tenant:b"},
    {jobId:"execution-job:"+H("c")},
    {intentHash:H("c")},
    {leaseEpoch:2},
    {leaseExpiresAt:"2026-10-10T00:00:11.000Z"},
    {signerKeyId:"lease-signing:v2"}
  ]){
    const changed={...capability,core:{...capability.core,...mutation}};
    assert.equal(phase2.verifyWorkerLeaseCapability(changed,leaseKey.publicKey),false);
  }

  assert.throws(()=>phase2.prepareWorkerLeaseCapability({...base,allowedActions:["COMPLETE","HEARTBEAT"]}),/order|canonical/i);
  assert.throws(()=>phase2.prepareWorkerLeaseCapability({...base,allowedActions:["COMPLETE","COMPLETE"]}),/duplicate|canonical/i);
  assert.throws(()=>phase2.prepareWorkerLeaseCapability({...base,allowedActions:["CLAIM"]}),/action|claim/i);
  assert.throws(()=>phase2.prepareWorkerLeaseCapability({...base,leaseEpoch:0}),/epoch/i);
  assert.throws(()=>phase2.prepareWorkerLeaseCapability({...base,intentHash:"BAD"}),/hash|digest/i);

  const mutatedPrepared=phase2.prepareWorkerLeaseCapability(base);
  mutatedPrepared.core.workerId="worker:mutated";
  const sig2=sign(null,Buffer.from(canonicalize(mutatedPrepared.signingPayload)),leaseKey.privateKey).toString("base64");
  assert.throws(()=>phase2.finalizeWorkerLeaseCapability(mutatedPrepared,leaseKey.publicKey,sig2),/integrity|core|prepared/i);

  assert.throws(
    ()=>phase2.finalizeWorkerLeaseCapability(prepared,leaseKey.publicKey,signature.replace(/=+$/,"")),
    /base64|signature/i
  );
});
