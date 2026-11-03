import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import {
  createWorkerTrustRecord, StaticWorkerTrustStore, WorkerRequestAuthenticator,
  workerRequestSigningPayload, type WorkerRequestProof
} from "../src/worker_authentication.ts";

const now="2026-10-09T16:00:00.000Z";
const pair=()=>generateKeyPairSync("ed25519");
function fixture(overrides:Record<string,unknown>={}){
  const {privateKey,publicKey}=pair();
  const pem=publicKey.export({format:"pem",type:"spki"}).toString();
  const record=createWorkerTrustRecord({
    workerId:"worker:alpha",keyId:"worker-key:alpha:1",poolId:"pool:trusted",
    publicKeyPem:pem,status:"ACTIVE",allowedActions:["CLAIM","HEARTBEAT","COMPLETE","RELEASE","FAIL_TERMINAL"],maxLeaseMs:60000,
    ...overrides
  });
  const store=new StaticWorkerTrustStore([record]);
  const auth=new WorkerRequestAuthenticator(store,{maxAgeMs:30000,futureSkewMs:5000});
  function proof(changes:Partial<WorkerRequestProof>={}):WorkerRequestProof {
    const base={protocolVersion:"axiom.worker-request/v1" as const,workerId:"worker:alpha",
      keyId:"worker-key:alpha:1",requestId:"req:once",action:"CLAIM" as const,
      bodyHash:hashJson({leaseMs:10000}),issuedAt:now,...changes};
    return {...base,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(base))),privateKey).toString("base64")};
  }
  return {record,store,auth,proof,pem};
}
test("worker Ed25519 proof establishes server-owned worker identity, policy and pool",()=>{
  const f=fixture();
  const request=f.proof();
  const worker=f.auth.authenticate(request,{action:"CLAIM",bodyHash:request.bodyHash},now);
  assert.equal(worker.identity.workerId,"worker:alpha");
  assert.equal(worker.identity.poolId,"pool:trusted");
  assert.equal(worker.maxLeaseMs,60000);
  assert.ok(worker.allowedActions.includes("CLAIM"));
  assert.match(worker.identity.publicKeySha256,/^[0-9a-f]{64}$/);
  assert.equal(worker.identity.publicKeySha256,sha256Hex(createPublicKey(f.pem).export({format:"der",type:"spki"})));
  assert.equal(worker.requestId,"req:once");
  assert.ok(Object.isFrozen(f.record));
  assert.ok(Object.isFrozen(f.record.identity));
});
test("unregistered, substituted and revoked worker keys fail closed",()=>{
  const f=fixture();
  const request=f.proof();
  const wrong=pair();
  const wrongRequest={...request,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(request))),wrong.privateKey).toString("base64")};
  assert.throws(()=>f.auth.authenticate(wrongRequest,{action:"CLAIM",bodyHash:request.bodyHash},now));
  assert.throws(()=>f.auth.authenticate({...request,workerId:"worker:unknown"},{action:"CLAIM",bodyHash:request.bodyHash},now));
  const revoked=fixture({status:"REVOKED"});
  const signed=revoked.proof();
  assert.throws(()=>revoked.auth.authenticate(signed,{action:"CLAIM",bodyHash:signed.bodyHash},now));
});
test("proof covers action, route job, body hash, request id and timestamp",()=>{
  const f=fixture();
  const req=f.proof({targetJobId:"job:one",action:"HEARTBEAT"});
  const expected={action:"HEARTBEAT" as const,targetJobId:"job:one",bodyHash:req.bodyHash};
  f.auth.authenticate(req,expected,now);
  for(const changes of [
    {action:"COMPLETE" as const},{targetJobId:"job:two"},
    {bodyHash:hashJson({leaseMs:20000})},{requestId:"req:two"},
    {issuedAt:"2026-10-09T16:00:01.000Z"}
  ])assert.throws(()=>f.auth.authenticate({...req,...changes},expected,now));
  assert.throws(()=>f.auth.authenticate(req,{...expected,action:"COMPLETE"},now));
});
test("proof rejects stale, future, noncanonical and malformed signatures or trust",()=>{
  const f=fixture();
  const stale=f.proof({issuedAt:"2026-10-09T15:59:29.000Z"});
  assert.throws(()=>f.auth.authenticate(stale,{action:"CLAIM",bodyHash:stale.bodyHash},now));
  const future=f.proof({issuedAt:"2026-10-09T16:00:06.000Z"});
  assert.throws(()=>f.auth.authenticate(future,{action:"CLAIM",bodyHash:future.bodyHash},now));
  const valid=f.proof();
  for(const signatureBase64 of ["bad","",valid.signatureBase64+"=",valid.signatureBase64.slice(0,4)])
    assert.throws(()=>f.auth.authenticate({...valid,signatureBase64},{action:"CLAIM",bodyHash:valid.bodyHash},now));
  assert.throws(()=>f.auth.authenticate(f.proof({issuedAt:"2026-10-09T16:00:00Z"}),{action:"CLAIM",bodyHash:valid.bodyHash},now));
  assert.throws(()=>createWorkerTrustRecord({
    workerId:"worker:bad",keyId:"k",poolId:"p",publicKeyPem:f.pem,status:"ACTIVE",
    allowedActions:["CLAIM"],maxLeaseMs:10000,publicKeySha256:"0".repeat(64)
  }));
});
test("worker grants are exact and cannot be expanded by request fields",()=>{
  const f=fixture({allowedActions:["CLAIM"]});
  const allowed=f.proof();
  assert.deepEqual(f.auth.authenticate(allowed,{action:"CLAIM",bodyHash:allowed.bodyHash},now).allowedActions,["CLAIM"]);
  const other=f.proof({action:"COMPLETE"});
  assert.throws(()=>f.auth.authenticate(other,{action:"COMPLETE",bodyHash:other.bodyHash},now));
});
