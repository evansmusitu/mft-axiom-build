import { hashJson } from "./canonical.ts";
import { compileProgram } from "./compiler.ts";
import { verifyCertificateSignature, type ReasoningCertificate } from "./certificate.ts";
import { AxiomRuntime } from "./runtime.ts";
import type { AxiomProgram, JsonValue } from "./types.ts";
import type { OperationRegistry } from "./registry.ts";

export interface ReplayResult { status:"MATCH"|"MISMATCH"; diagnostics:string[]; }
function json(v:unknown):JsonValue{return v as JsonValue;}
export function replayCertificate(certificate:ReasoningCertificate,registry:OperationRegistry,programOverride?:AxiomProgram,trustedPublicKeyPem?:string):ReplayResult {
  const diagnostics:string[]=[];
  if(!verifyCertificateSignature(certificate,trustedPublicKeyPem))diagnostics.push(trustedPublicKeyPem?"certificate signature, id, or trusted signer mismatch":"certificate signature or certificate id mismatch");
  const core=certificate.core as any;
  const candidate=programOverride??certificate.replay.program;
  if(programOverride && hashJson(json(candidate))!==hashJson(json(certificate.replay.program)))diagnostics.push("program hash mismatch");

  let execution;
  try{
    const p=compileProgram(candidate,registry);
    if(hashJson(json(p))!==core.programHash && !diagnostics.includes("program hash mismatch"))diagnostics.push("program hash mismatch");
    execution=new AxiomRuntime(registry).execute(p);
  }catch(err){return {status:"MISMATCH",diagnostics:[...diagnostics,`replay execution failed: ${err instanceof Error?err.message:String(err)}`]};}
  if(execution.programHash!==core.programHash && !diagnostics.includes("program hash mismatch"))diagnostics.push("program hash mismatch");
  if(execution.inputMerkleRoot!==core.inputMerkleRoot)diagnostics.push("input merkle root mismatch");
  if(execution.executionHash!==core.executionHash)diagnostics.push("execution hash mismatch");
  if(hashJson(json(execution.trace))!==core.traceHash)diagnostics.push("trace hash mismatch");
  if(hashJson(json(execution.outputs))!==core.outputsHash)diagnostics.push("outputs hash mismatch");
  if(JSON.stringify(execution.operationManifest)!==JSON.stringify(core.operationManifest))diagnostics.push("operation manifest mismatch");
  return {status:diagnostics.length?"MISMATCH":"MATCH",diagnostics};
}
