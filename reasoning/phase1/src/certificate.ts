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
export interface PreparedReasoningCertificate {
  core:JsonValue;
  issuedAt:string;
  replay:{program:AxiomProgram};
  signingPayload:JsonValue;
  signingPayloadHash:string;
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
function canonicalPublicKeyPem(key:string|KeyObject):string {
  const publicKey=asPublicKey(key);
  if(publicKey.asymmetricKeyType!=="ed25519")throw new TypeError("Reasoning certificate public key must be Ed25519");
  return publicKey.export({type:"spki",format:"pem"}).toString();
}
function decodeEd25519Signature(signatureBase64:string):Buffer {
  if(typeof signatureBase64!=="string"||!signatureBase64||!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)||signatureBase64.length%4!==0){
    throw new TypeError("Reasoning certificate signature must be canonical Base64");
  }
  const signature=Buffer.from(signatureBase64,"base64");
  if(signature.length!==64||signature.toString("base64")!==signatureBase64)throw new TypeError("Reasoning certificate requires a 64-byte Ed25519 signature");
  return signature;
}

export function prepareReasoningCertificate(
  program:AxiomProgram,
  execution:ExecutionResult,
  issuedAt=new Date().toISOString()
):PreparedReasoningCertificate {
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
  return {
    core,
    issuedAt,
    replay:{program:structuredClone(program)},
    signingPayload:payload,
    signingPayloadHash:sha256Hex(canonicalize(payload))
  };
}

export function finalizeReasoningCertificate(
  prepared:PreparedReasoningCertificate,
  publicKey:string|KeyObject,
  signatureBase64:string
):ReasoningCertificate {
  if(prepared.signingPayloadHash!==sha256Hex(canonicalize(prepared.signingPayload))){
    throw new Error("Prepared certificate signing payload integrity check failed");
  }
  if(hashJson(json(prepared.signingPayload))!==hashJson(signingPayload(prepared.core,prepared.issuedAt))){
    throw new Error("Prepared certificate signing payload does not match core and issuedAt");
  }
  const signedProgramHash=(prepared.core as any)?.programHash;
  if(typeof signedProgramHash!=="string"||hashJson(json(prepared.replay.program))!==signedProgramHash){
    throw new Error("Prepared certificate replay program hash does not match signed program hash");
  }
  const key=asPublicKey(publicKey);
  const publicKeyPem=canonicalPublicKeyPem(key);
  const signature=decodeEd25519Signature(signatureBase64);
  if(!verify(null,Buffer.from(canonicalize(prepared.signingPayload)),key,signature)){
    throw new Error("Reasoning certificate signature verification failed");
  }
  return {
    certificateId:certificateId(prepared.core,prepared.issuedAt,signatureBase64),
    core:structuredClone(prepared.core),
    publicKeyPem,
    signature:signatureBase64,
    issuedAt:prepared.issuedAt,
    replay:{program:structuredClone(prepared.replay.program)}
  };
}

export function issueCertificate(program:AxiomProgram,execution:ExecutionResult,signer:Signer,issuedAt=new Date().toISOString()):ReasoningCertificate {
  const prepared=prepareReasoningCertificate(program,execution,issuedAt);
  const sig=sign(null,Buffer.from(canonicalize(prepared.signingPayload)),signer.privateKey).toString("base64");
  return finalizeReasoningCertificate(prepared,signer.publicKey,sig);
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
