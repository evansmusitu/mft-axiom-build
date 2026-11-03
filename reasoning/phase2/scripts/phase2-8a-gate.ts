import assert from "node:assert/strict";
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {hashJson} from "../../phase1/src/canonical.ts";
import {FileJsonEvidenceAdapter} from "../src/file_json_evidence_adapter.ts";
import {AdapterRegistry,createEvidenceArtifact,verifyEvidenceArtifact,mapEvidenceArtifact} from "../src/evidence.ts";

const root=mkdtempSync(join(tmpdir(),"axiom-p28a-"));
const tenant={tenantId:"tenant:p28a"};
const op={operationId:"risk:read",parameterSchemaHash:"a".repeat(64),
 responseMediaTypes:["application/json"],maxResponseBytes:256,timeoutMs:1500,mappingIds:["risk:map"]};
try{
 const body='{"risk":0.2,"provenance":"approved input"}';
 writeFileSync(join(root,"risk.json"),body,"utf8");
 const adapter=new FileJsonEvidenceAdapter({adapterId:"file:gate",version:"1",
  implementationHash:"b".repeat(64),rootDirectory:root,operations:[{manifest:op,fileName:"risk.json"}]});
 const mapper={manifest:{mappingId:"risk:map",version:"1",implementationHash:"c".repeat(64)},
  map(artifact:any){
   const json=JSON.parse(artifact.body);
   return [{entity:"risk:p28a",attribute:"current",
    value:{type:{kind:"number",unit:"ratio"},value:json.risk},
    validFrom:"2026-11-01T12:00:00.000Z",observedAt:"2026-11-01T12:00:00.000Z",source:"operator:approved"}];
  }};
 const registry=new AdapterRegistry([{adapter,mappers:[mapper],tenantIds:[tenant.tenantId]}]);
 const resolved=registry.resolve(tenant,adapter.manifest.adapterId,op.operationId,mapper.manifest.mappingId);
 assert.equal(resolved.adapter,adapter);
 const input={tenant,operation:resolved.operation,parameters:{}};
 const captured=await adapter.acquire(input);
 assert.equal(captured.body,body);
 const artifact=createEvidenceArtifact({
  tenantId:tenant.tenantId,adapterId:adapter.manifest.adapterId,
  adapterVersion:adapter.manifest.version,adapterImplementationHash:adapter.manifest.implementationHash,
  operationId:op.operationId,mappingId:mapper.manifest.mappingId,
  canonicalRequestHash:hashJson({op:"risk:read"}),capturedAt:"2026-11-01T12:00:01.000Z",
  upstreamStatus:captured.status,mediaType:captured.mediaType,
  bodyEncoding:captured.bodyEncoding??"utf8",body:captured.body
 });
 const facts=mapEvidenceArtifact(tenant,verifyEvidenceArtifact(tenant,artifact),mapper);
 assert.equal(facts.length,1);assert.equal(facts[0].value.value,0.2);
 assert.equal(facts[0].acquisition?.artifactHash,artifact.artifactHash);
 assert.throws(()=>registry.resolve({tenantId:"other"},adapter.manifest.adapterId,op.operationId,mapper.manifest.mappingId),/tenant/i);
 await assert.rejects(()=>adapter.acquire({...input,parameters:{fileName:"secret.json"} as any}),/parameter/i);
 const altered={...artifact,body:'{"risk":9}'};
 assert.throws(()=>verifyEvidenceArtifact(tenant,altered),/integrity/i);
 writeFileSync(join(root,"risk.json"),'{"risk":0.9}',"utf8");
 assert.equal(verifyEvidenceArtifact(tenant,artifact).body,body);
 const fresh=await adapter.acquire(input);
 assert.notEqual(fresh.body,body);
 writeFileSync(join(root,"risk.json"),"x".repeat(257));
 await assert.rejects(()=>adapter.acquire(input),/limit/i);
 symlinkSync(join(root,"risk.json"),join(root,"linked.json"));
 const linked=new FileJsonEvidenceAdapter({adapterId:"file:linked",version:"1",
  implementationHash:"b".repeat(64),rootDirectory:root,operations:[{manifest:op,fileName:"linked.json"}]});
 await assert.rejects(()=>linked.acquire(input),/symlink|regular file/i);
 console.log(JSON.stringify({phase:"P2.8A — Bounded Read-Only JSON File Evidence",
  status:"PASS",checks:[
   "bind one server-owned flat filename to a registered evidence operation",
   "enforce exact tenant adapter and mapper eligibility",
   "capture bounded raw JSON bytes under a trusted root",
   "derive deterministic immutable artifact and fact provenance",
   "reject user-specified file selection and cross-tenant adapter use",
   "detect artifact-body mutation and preserve original captured snapshot",
   "reject oversized sources and final-component symlinks"
  ],artifactId:artifact.artifactId,factId:facts[0].id}));
}finally{rmSync(root,{recursive:true,force:true});}
