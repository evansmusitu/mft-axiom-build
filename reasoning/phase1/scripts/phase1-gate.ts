import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashJson, compileProgram, createDefaultRegistry, AxiomRuntime, createSigner, issueCertificate, replayCertificate, OperationRegistry, type AxiomProgram } from "../src/index.ts";

const raw=JSON.parse(readFileSync(new URL("../fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;
const registry=createDefaultRegistry();
const compiled=compileProgram(raw,registry);
const execution=new AxiomRuntime(registry).execute(compiled);
assert.equal(execution.decisionStatus,"APPROVED");

const signer=createSigner();
const certificate=issueCertificate(compiled,execution,signer,"2026-10-05T18:00:00.000Z");
assert.equal(replayCertificate(certificate,createDefaultRegistry()).status,"MATCH");

const inputMutation=structuredClone(certificate.replay.program);
inputMutation.inputs.equity.value="99999.00";
assert.equal(replayCertificate(certificate,createDefaultRegistry(),inputMutation).status,"MISMATCH");

const denied=structuredClone(raw);
denied.inputs.max_vol.value=0.01;
denied.inputs.max_vol.provenance!.contentHash=hashJson(0.01);
const deniedExecution=new AxiomRuntime(registry).execute(compileProgram(denied,registry));
assert.equal(deniedExecution.decisionStatus,"DENIED");

const drifted=createDefaultRegistry();
const replacement=new OperationRegistry();
for(const item of drifted.manifest()){
  const def=drifted.get(item.id);
  replacement.register(item.id==="statistics.zscore_last"?{...def,version:"99.0.0",implementationHash:"forced-drift"}:def);
}
assert.equal(replayCertificate(certificate,replacement).status,"MISMATCH");

console.log(JSON.stringify({
  phase:"P1 — Executable Reasoning Kernel",
  status:"PASS",
  checks:[
    "compile structured reasoning program",
    "validate types, units, provenance and graph",
    "execute deterministic DAG",
    "approve valid constraint envelope",
    "deny violated constraint envelope",
    "issue Ed25519 reasoning certificate",
    "offline replay MATCH",
    "mutated input MISMATCH",
    "operation drift MISMATCH"
  ],
  programHash:execution.programHash,
  executionHash:execution.executionHash,
  certificateId:certificate.certificateId
},null,2));
