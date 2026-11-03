import test from "node:test";
import assert from "node:assert/strict";
import {hashJson} from "../../phase1/src/canonical.ts";
import {compatibilityMatrix,verifyCompatibility} from "../src/compatibility_matrix.ts";

test("versioned compatibility matrix commits runtime, compiler, registry and policy to a deterministic identity",()=>{
 const a=compatibilityMatrix(),b=compatibilityMatrix();
 assert.deepEqual(a,b);
 assert.equal(a.schemaVersion,"axiom.compatibility/v1");
 assert.match(a.matrixHash,/^[0-9a-f]{64}$/);
 const {matrixHash,...core}=a;
 assert.equal(matrixHash,hashJson(core));
 for(const id of ["ir","runtime","compiler","operationRegistry","policy","modelProposal","certificate","workerCompletionVerifier","workerControlHttp","workerRequest","workerLease","evidenceAdapter","mcpEvidenceAdapter","fileEvidenceAdapter","objectEvidenceAdapter","postgresViewEvidenceAdapter","musituComputeAdapter","modelAdapter","modelProviderTransport","executionApi","reasoningSigner","workerReceiptStore"]){
  assert.equal(typeof a.components[id].version,"string");
  assert.match(a.components[id].implementationHash,/^[0-9a-f]{64}$/);
 }
 assert.equal(verifyCompatibility(a,b).status,"MATCH");
});
test("missing, unknown, protocol or implementation drift fails closed with deterministic diagnostics",()=>{
 const expected=compatibilityMatrix();
 for(const mutation of [
  (x:any)=>{x.components.runtime.version="999.0.0";},
  (x:any)=>{x.components.compiler.implementationHash="0".repeat(64);},
  (x:any)=>{x.components.workerLease.version="axiom.worker-lease/v0";},
  (x:any)=>{delete x.components.policy;},
  (x:any)=>{x.components.untrusted={version:"1",implementationHash:"f".repeat(64)};},
  (x:any)=>{x.schemaVersion="axiom.compatibility/v0";}
 ]){
  const mutated=structuredClone(expected);mutation(mutated);
  mutated.matrixHash=hashJson({schemaVersion:mutated.schemaVersion,components:mutated.components});
  const result=verifyCompatibility(expected,mutated);
  assert.equal(result.status,"INCOMPATIBLE");
  assert.ok(result.diagnostics.length>=1);
  assert.deepEqual(result.diagnostics,[...result.diagnostics].sort());
 }
});
test("attacker cannot reuse a trusted matrix hash over altered or additional compatibility fields",()=>{
 const expected=compatibilityMatrix();
 const forged=structuredClone(expected);
 forged.components.policy.version="backdoor";
 assert.equal(verifyCompatibility(expected,forged).status,"INCOMPATIBLE");
 const extra={...expected,allowAny:true};
 assert.equal(verifyCompatibility(expected,extra as any).status,"INCOMPATIBLE");
 const missing=structuredClone(expected);delete (missing as any).matrixHash;
 assert.equal(verifyCompatibility(expected,missing).status,"INCOMPATIBLE");
});
