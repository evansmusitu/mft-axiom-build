import { generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from "node:crypto";
import { canonicalize, hashJson, sha256Hex } from "./canonical.ts";
import { AxiomRuntime } from "./runtime.ts";
import type { AxiomProgram, ExecutionResult, JsonValue } from "./types.ts";

export interface ReasoningCertificate {
  certificateId:string;
  core: JsonValue;
  publicKeyPem:string;
  signature:string;
  issuedAt:string;
  replay:{program:AxiomProgram};
}
export interface Signer { privateKey:KeyObject; publicKey:KeyObject; }
export function createSigner():Signer { const pair=generateKeyPairSync("ed25519"); return {privateKey:pair.privateKey,publicKey:pair.publicKey}; }
function signingPayload(core:JsonValue, issuedAt:string):JsonValue { return {core,issuedAt}; }
function certificateId(core:JsonValue,issuedAt:string,signature:string):string { return sha256Hex(`${hashJson(signingPayload(core,issuedAt))}:${signature}`); }
function json(value:unknown):JsonValue{return value as JsonValue;}
function asPublicKey(key:string|KeyObject):KeyObject {
  if(typeof key==="string")return createPublicKey(key);
  return key.type==="public"?key:createPublicKey(key);
}
function publicKeyDer(key:string|KeyObject):Buffer {
  return asPublicKey(key).export({type:"spki",format:"der"}) as Buffer;
}

export function issueCertificate(program:AxiomProgram,execution:ExecutionResult,signer:Signer,issuedAt=new Date().toISOString()):ReasoningCertificate {
  const programHash=hashJson(json(program));
  if(programHash!==execution.programHash)throw new Error("Execution does not belong to program: program hash mismatch");
  const {executionHash,...executionBase}=execution;
  if(hashJson(json(executionBase))!==executionHash)throw new Error("Execution integrity check failed: execution hash mismatch");

  const core=json({
    certificateVersion:"0.1",programHash:execution.programHash,inputMerkleRoot:execution.inputMerkleRoot,
    runtimeVersion:AxiomRuntime.VERSION,irVersion:program.irVersion,operationManifest:execution.operationManifest,
    traceHash:hashJson(json(execution.trace)),assumptions:program.assumptions,verificationResults:execution.verifications,
    outputs:execution.outputs,outputsHash:hashJson(json(execution.outputs)),executionHash:execution.executionHash,decisionStatus:execution.decisionStatus
  });
  const payload=signingPayload(core,issuedAt);
  const sig=sign(null,Buffer.from(canonicalize(payload)),signer.privateKey).toString("base64");
  const publicKeyPem=signer.publicKey.export({type:"spki",format:"pem"}).toString();
  return {certificateId:certificateId(core,issuedAt,sig),core,publicKeyPem,signature:sig,issuedAt,replay:{program:structuredClone(program)}};
}

export function verifyCertificateSignature(certificate:ReasoningCertificate,trustedPublicKey?:string|KeyObject):boolean {
  try{
    const publicKey=createPublicKey(certificate.publicKeyPem);
    if(trustedPublicKey && !publicKeyDer(publicKey).equals(publicKeyDer(trustedPublicKey)))return false;
    const payload=signingPayload(certificate.core,certificate.issuedAt);
    const sigOk=verify(null,Buffer.from(canonicalize(payload)),publicKey,Buffer.from(certificate.signature,"base64"));
    return sigOk&&certificate.certificateId===certificateId(certificate.core,certificate.issuedAt,certificate.signature);
  }catch{return false;}
}
