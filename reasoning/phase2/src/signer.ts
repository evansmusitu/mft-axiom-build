import { createPublicKey, type KeyObject } from "node:crypto";
import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import type { ExecutionResult } from "../../phase1/src/types.ts";
import {
  finalizeReasoningCertificate, issueCertificate, prepareReasoningCertificate,
  type ReasoningCertificate, type Signer
} from "../../phase1/src/certificate.ts";
import type { AxiomProgram } from "../../phase1/src/types.ts";
import type {
  ExternalEd25519SignRequest, ExternalEd25519SignResponse, ExternalEd25519SigningBackend
} from "./signer_backend.ts";

export interface SignerIdentity {
  protocolVersion:"axiom.signer/v1";
  providerId:string;
  mode:"LOCAL"|"EXTERNAL";
  keyId:string;
  algorithm:"Ed25519";
  publicKeySha256:string;
}
export interface SignerProvider {
  readonly identity:SignerIdentity;
  readonly keyId:string;
  issue(program:AxiomProgram,execution:ExecutionResult,issuedAt:string):Promise<ReasoningCertificate>;
  signingIntentId(program:AxiomProgram,execution:ExecutionResult,issuedAt:string):string;
  trustedPublicKeyPem(keyId?:string):string|undefined;
}

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function asPublicKey(key:string|KeyObject):KeyObject {
  const publicKey=typeof key==="string"?createPublicKey(key):(key.type==="public"?key:createPublicKey(key));
  if(publicKey.asymmetricKeyType!=="ed25519")throw new TypeError("Reasoning signer keys must be Ed25519");
  return publicKey;
}
function publicPem(key:string|KeyObject):string {
  return asPublicKey(key).export({type:"spki",format:"pem"}).toString();
}
export function signerPublicKeySha256(key:string|KeyObject):string {
  const der=asPublicKey(key).export({type:"spki",format:"der"}) as Buffer;
  return sha256Hex(der);
}
function signerIdentity(providerId:string,mode:"LOCAL"|"EXTERNAL",keyId:string,key:string|KeyObject):SignerIdentity {
  return {
    protocolVersion:"axiom.signer/v1",
    providerId:required(providerId,"signer providerId"),
    mode,
    keyId:required(keyId,"active signer keyId"),
    algorithm:"Ed25519",
    publicKeySha256:signerPublicKeySha256(key)
  };
}
function trustedKeyring(
  activeKeyId:string,
  activeKey:string|KeyObject,
  trustedKeys:Record<string,string|KeyObject>
):Map<string,string> {
  const trusted=new Map<string,string>();
  for(const [keyId,key] of Object.entries(trustedKeys)){
    required(keyId,"trusted signer keyId");
    trusted.set(keyId,publicPem(key));
  }
  const activePem=publicPem(activeKey);
  const declaredActive=trusted.get(activeKeyId);
  if(declaredActive!==undefined&&declaredActive!==activePem){
    throw new Error(`Trusted key ${activeKeyId} does not match the active signer`);
  }
  trusted.set(activeKeyId,activePem);
  return trusted;
}
function signingIntentFromPayloadHash(identity:SignerIdentity,signingPayloadHash:string):string {
  return hashJson({
    domain:"AXIOM_REASONING_CERTIFICATE_SIGNING_INTENT_V1",
    signerIdentity:identity,
    signingPayloadHash
  } as any);
}
function intentId(
  identity:SignerIdentity,
  program:AxiomProgram,
  execution:ExecutionResult,
  issuedAt:string
):string {
  const prepared=prepareReasoningCertificate(program,execution,issuedAt);
  return signingIntentFromPayloadHash(identity,prepared.signingPayloadHash);
}
export function signingIntentIdForCertificate(certificate:ReasoningCertificate,identity:SignerIdentity):string {
  const signingPayload={core:certificate.core,issuedAt:certificate.issuedAt};
  return signingIntentFromPayloadHash(identity,sha256Hex(canonicalize(signingPayload as any)));
}

export function createStaticSignerProvider(keyId:string,signer:Signer):SignerProvider {
  return createKeyringSignerProvider(keyId,signer,{[keyId]:signer.publicKey});
}

export function createKeyringSignerProvider(
  activeKeyId:string,
  activeSigner:Signer,
  trustedKeys:Record<string,string|KeyObject>
):SignerProvider {
  const keyId=required(activeKeyId,"active signer keyId");
  const trusted=trustedKeyring(keyId,activeSigner.publicKey,trustedKeys);
  const identity=Object.freeze(signerIdentity("axiom.local-ed25519","LOCAL",keyId,activeSigner.publicKey));
  return {
    identity,
    keyId,
    issue:async(program,execution,issuedAt)=>issueCertificate(program,execution,activeSigner,issuedAt),
    signingIntentId:(program,execution,issuedAt)=>intentId(identity,program,execution,issuedAt),
    trustedPublicKeyPem:(requested=keyId)=>trusted.get(requested)
  };
}

export function createExternalEd25519SignerProvider(config:{
  providerId:string;
  activeKeyId:string;
  activePublicKey:string|KeyObject;
  trustedKeys:Record<string,string|KeyObject>;
  backend:ExternalEd25519SigningBackend;
}):SignerProvider {
  const keyId=required(config.activeKeyId,"active signer keyId");
  if(!config.backend||typeof config.backend.sign!=="function")throw new TypeError("external signing backend is required");
  const activePublicKey=asPublicKey(config.activePublicKey);
  const trusted=trustedKeyring(keyId,activePublicKey,config.trustedKeys);
  const identity=Object.freeze(signerIdentity(config.providerId,"EXTERNAL",keyId,activePublicKey));

  const signingIntentId=(program:AxiomProgram,execution:ExecutionResult,issuedAt:string)=>
    intentId(identity,program,execution,issuedAt);

  return {
    identity,
    keyId,
    signingIntentId,
    trustedPublicKeyPem:(requested=keyId)=>trusted.get(requested),
    async issue(program,execution,issuedAt){
      const prepared=prepareReasoningCertificate(program,execution,issuedAt);
      const signingIntentIdValue=signingIntentFromPayloadHash(identity,prepared.signingPayloadHash);
      const request:ExternalEd25519SignRequest={
        protocolVersion:"axiom.sign/v1",
        keyId,
        algorithm:"Ed25519",
        signingIntentId:signingIntentIdValue,
        payloadHash:prepared.signingPayloadHash,
        payloadBase64:Buffer.from(canonicalize(prepared.signingPayload),"utf8").toString("base64")
      };
      const response:ExternalEd25519SignResponse=await config.backend.sign(request);
      if(response?.protocolVersion!==request.protocolVersion)throw new Error("Signer response protocolVersion mismatch");
      if(response?.keyId!==request.keyId)throw new Error("Signer response keyId mismatch");
      if(response?.algorithm!==request.algorithm)throw new Error("Signer response algorithm mismatch");
      if(response?.signingIntentId!==request.signingIntentId)throw new Error("Signer response signingIntentId mismatch");
      if(response?.payloadHash!==request.payloadHash)throw new Error("Signer response payloadHash mismatch");
      return finalizeReasoningCertificate(prepared,activePublicKey,response.signatureBase64);
    }
  };
}
