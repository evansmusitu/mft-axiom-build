import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalize } from "../../phase1/src/canonical.ts";

const H=(c:string)=>c.repeat(64);

test("worker request authentication is proof-of-possession, exact-bound, policy-owned, and fail-closed",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.createWorkerTrustRecord,"function");
  assert.equal(typeof phase2.createWorkerTrustStore,"function");
  assert.equal(typeof phase2.WorkerRequestAuthenticator,"function");
  assert.equal(typeof phase2.workerRequestSigningPayload,"function");

  const active=generateKeyPairSync("ed25519");
  const other=generateKeyPairSync("ed25519");
  const activeRecord=phase2.createWorkerTrustRecord({
    workerId:"worker:a",
    keyId:"worker-key:a:v1",
    poolId:"pool:trusted",
    publicKey:active.publicKey,
    status:"ACTIVE",
    maxLeaseMs:5000,
    allowedActions:["CLAIM","COMPLETE"]
  });
  const revokedRecord=phase2.createWorkerTrustRecord({
    workerId:"worker:revoked",
    keyId:"worker-key:revoked:v1",
    poolId:"pool:quarantine",
    publicKey:other.publicKey,
    status:"REVOKED",
    maxLeaseMs:1000,
    allowedActions:["CLAIM"]
  });
  assert.ok(Object.isFrozen(activeRecord));
  assert.ok(Object.isFrozen(activeRecord.identity));
  assert.ok(Object.isFrozen(activeRecord.allowedActions));

  const trust=phase2.createWorkerTrustStore([activeRecord,revokedRecord]);
  const auth=new phase2.WorkerRequestAuthenticator({
    trustStore:trust,
    maxRequestAgeMs:5000,
    maxFutureSkewMs:100
  });

  const base={
    protocolVersion:"axiom.worker-request/v1",
    workerId:"worker:a",
    keyId:"worker-key:a:v1",
    requestId:"worker-request:1",
    action:"CLAIM",
    bodyHash:H("a"),
    issuedAt:"2026-10-10T00:00:00.000Z"
  };
  const make=(fields:any=base,key:any=active.privateKey)=>{
    const unsigned={...fields};
    const payload=phase2.workerRequestSigningPayload(unsigned);
    return {...unsigned,signatureBase64:sign(null,Buffer.from(canonicalize(payload)),key).toString("base64")};
  };
  const proof=make();

  const accepted=auth.authenticate(proof,{
    action:"CLAIM",
    bodyHash:H("a"),
    now:"2026-10-10T00:00:01.000Z"
  });
  assert.equal(accepted.identity.workerId,"worker:a");
  assert.equal(accepted.identity.keyId,"worker-key:a:v1");
  assert.equal(accepted.identity.poolId,"pool:trusted");
  assert.equal(accepted.maxLeaseMs,5000);
  assert.deepEqual(accepted.allowedActions,["CLAIM","COMPLETE"]);
  assert.equal(accepted.requestId,"worker-request:1");
  assert.equal(accepted.requestHash,phase2.hashWorkerRequestProof(proof));

  for(const tampered of [
    {...proof,action:"COMPLETE"},
    {...proof,bodyHash:H("b")},
    {...proof,requestId:"worker-request:2"},
    {...proof,issuedAt:"2026-10-10T00:00:00.001Z"},
    {...proof,targetJobId:"execution-job:unexpected"}
  ]){
    assert.throws(
      ()=>auth.authenticate(tampered,{action:"CLAIM",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"}),
      /worker|signature|request|target|body|action/i
    );
  }

  assert.throws(
    ()=>auth.authenticate(make(base,other.privateKey),{action:"CLAIM",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"}),
    /signature|worker/i
  );
  assert.throws(
    ()=>auth.authenticate({...proof,workerId:"worker:unknown"},{action:"CLAIM",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"}),
    /trusted|worker/i
  );

  const revokedBase={...base,workerId:"worker:revoked",keyId:"worker-key:revoked:v1",requestId:"worker-request:revoked"};
  assert.throws(
    ()=>auth.authenticate(make(revokedBase,other.privateKey),{action:"CLAIM",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"}),
    /revoked|active|worker/i
  );

  const completeBase={...base,action:"COMPLETE",requestId:"worker-request:complete",targetJobId:"job:1"};
  const complete=make(completeBase);
  const completeAccepted=auth.authenticate(complete,{
    action:"COMPLETE",targetJobId:"job:1",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"
  });
  assert.equal(completeAccepted.action,"COMPLETE");
  assert.throws(
    ()=>auth.authenticate(complete,{action:"COMPLETE",targetJobId:"job:2",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"}),
    /target|job/i
  );

  const heartbeatBase={...base,action:"HEARTBEAT",requestId:"worker-request:heartbeat",targetJobId:"job:1"};
  assert.throws(
    ()=>auth.authenticate(make(heartbeatBase),{action:"HEARTBEAT",targetJobId:"job:1",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"}),
    /forbidden|action|worker/i
  );

  assert.throws(
    ()=>auth.authenticate(proof,{action:"CLAIM",bodyHash:H("a"),now:"2026-10-10T00:00:06.001Z"}),
    /old|age|expired|worker/i
  );
  const futureBase={...base,requestId:"worker-request:future",issuedAt:"2026-10-10T00:00:02.000Z"};
  assert.throws(
    ()=>auth.authenticate(make(futureBase),{action:"CLAIM",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"}),
    /future|skew|worker/i
  );

  assert.throws(
    ()=>auth.authenticate({...proof,signatureBase64:proof.signatureBase64.replace(/=+$/,"")},{action:"CLAIM",bodyHash:H("a"),now:"2026-10-10T00:00:01.000Z"}),
    /base64|signature|worker/i
  );

  const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
  assert.throws(()=>phase2.createWorkerTrustRecord({
    workerId:"worker:rsa",keyId:"key:rsa",poolId:"pool:rsa",publicKey:rsa.publicKey,
    status:"ACTIVE",maxLeaseMs:1000,allowedActions:["CLAIM"]
  }),/ed25519/i);
});
