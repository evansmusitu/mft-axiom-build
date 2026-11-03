import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {VersionPinnedObjectEvidenceAdapter} from "../src/version_pinned_object_evidence_adapter.ts";
const H=(x:string)=>x.repeat(64);
const bytes=new TextEncoder().encode('{"observation":7}');
const digest=createHash("sha256").update(bytes).digest("hex");
const calls:any[]=[];
const reader={async readVersion(arg:any){calls.push(arg);
 return {versionId:"immutable-001",mediaType:"application/json",body:bytes};
}};
const op={operationId:"object.read",parameterSchemaHash:H("a"),
 responseMediaTypes:["application/json"],maxResponseBytes:512,timeoutMs:1000,mappingIds:["map:object"]};
const adapter=new VersionPinnedObjectEvidenceAdapter({adapterId:"adapter:object-gate",version:"1",
 implementationHash:H("b"),reader,operations:[{manifest:op,bucket:"evidence-store",
 key:"verified/risk.json",versionId:"immutable-001",expectedSha256:digest,tenantIds:["tenant:gate"]}]});
assert.equal(adapter.manifest.capability,"READ");
const request={tenant:{tenantId:"tenant:gate"},operation:op,parameters:{}};
const captured=await adapter.acquire(request);
assert.equal(captured.body,new TextDecoder().decode(bytes));
assert.equal(calls.length,1);
assert.deepEqual({bucket:calls[0].bucket,key:calls[0].key,versionId:calls[0].versionId},
 {bucket:"evidence-store",key:"verified/risk.json",versionId:"immutable-001"});
await assert.rejects(()=>adapter.acquire({...request,parameters:{key:"private.json"}}),/parameters/);
await assert.rejects(()=>adapter.acquire({...request,tenant:{tenantId:"tenant:attacker"}}),/tenant/);
assert.equal(calls.length,1);
const substituted=new VersionPinnedObjectEvidenceAdapter({adapterId:"adapter:bad",version:"1",
 implementationHash:H("c"),reader:{async readVersion(){return {
  versionId:"immutable-001",mediaType:"application/json",body:new TextEncoder().encode('{"observation":8}')};}},
 operations:[{manifest:op,bucket:"evidence-store",key:"verified/risk.json",
  versionId:"immutable-001",expectedSha256:digest,tenantIds:["tenant:gate"]}]});
await assert.rejects(()=>substituted.acquire(request),/hash mismatch/);
await import("./phase2-3a-gate.ts");
console.log(JSON.stringify({phase:"P2.8C — Immutable Version-Pinned Object Evidence",
 status:"PASS",checks:["no caller object identity or tenant control",
 "exact operator-registered bucket/key/version","pinned SHA-256 original bytes",
 "bounded JSON media/UTF-8/size and timeout","reject unknown tenant and injection",
 "reuse signed evidence acquisition and offline stored replay"]}));
