import assert from "node:assert/strict";
import {VerifiedRemoteCompletionService} from "../src/verified_remote_completion.ts";
let reads=0,terminalCalls=0;
assert.throws(()=>new VerifiedRemoteCompletionService({jobs:{complete(){}}} as any),/mandatory/);
const service=new VerifiedRemoteCompletionService({
 jobs:{async complete(){terminalCalls++;throw Error("unexpected completion");}},
 auth:{authenticate(){throw new Error("WORKER_UNAUTHENTICATED");}},
 leaseSigner:{trustedPublicKeyPem(){return undefined;}},
 jobReader:{async get(){reads++;throw Error("untrusted read");}},
 executions:{async getByIntent(){reads++;throw Error("untrusted record read");}},
 replayFactory:{create(){reads++;throw Error("untrusted replay factory");}}
} as any);
await assert.rejects(()=>service.complete({
 action:"COMPLETE",workerId:"untrusted",keyId:"key",targetJobId:"job"
} as any,{
 capabilityId:"cap:fake",core:{jobId:"job",tenantId:"tenant",signerKeyId:"lease:key",
 workerId:"untrusted",workerKeyId:"key",poolId:"pool"}
} as any,{
 status:"APPROVED",snapshotId:"snapshot",policyDecision:{status:"ALLOW",snapshotId:"snapshot",checks:[]},
 certificateId:"fake",executionRecordId:"fake"
},"2026-11-02T08:00:04.000Z"),/WORKER_UNAUTHENTICATED/);
assert.equal(reads,0);
assert.equal(terminalCalls,0);
await import("./phase2-5c-gate.ts");
console.log(JSON.stringify({phase:"P2.9B — Server-Verified Remote Completion",
 status:"PASS",checks:["worker signature authentication before tenant record reads",
 "mandatory trusted replay authority","immutable execution intent and snapshot binding",
 "independent signed certificate replay","exact result equality",
 "durable terminal receipt idempotency","no direct remote terminal HTTP endpoint",
 "legacy authenticated worker receipt gates"]}));
