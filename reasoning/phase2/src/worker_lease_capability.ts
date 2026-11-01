import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize, sha256Hex } from "../../phase1/src/canonical.ts";
import type { JsonValue } from "../../phase1/src/types.ts";
import type {
  PreparedWorkerLeaseCapability, WorkerLeaseAction, WorkerLeaseCapability, WorkerLeaseCapabilityCore
} from "./types.ts";

const HEX64=/^[0-9a-f]{64}$/;
const ORDER:WorkerLeaseAction[]=["HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"];
const ORDER_INDEX=new Map(ORDER.map((value,index)=>[value,index]));

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function digest(value:unknown,label:string):string {
  const text=required(value,label);
  if(!HEX64.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  return text;
}
function positiveEpoch(value:unknown):number {
  if(!Number.isInteger(value)||Number(value)<=0)throw new TypeError("leaseEpoch must be a positive integer");
  return Number(value);
}
function canonicalIso(value:unknown,label:string):string {
  const text=required(value,label),ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new TypeError(`${label} must be canonical ISO-8601`);
  return text;
}
function canonicalActions(input:unknown):WorkerLeaseAction[] {
  if(!Array.isArray(input)||input.length===0)throw new TypeError("allowedActions must not be empty");
  const out:WorkerLeaseAction[]=[];
  let previous=-1;
  for(const raw of input){
    if(typeof raw!=="string"||!ORDER_INDEX.has(raw as WorkerLeaseAction)){
      throw new TypeError("Lease capability action is invalid; CLAIM is not a lease action");
    }
    const action=raw as WorkerLeaseAction,index=ORDER_INDEX.get(action)!;
    if(index===previous||out.includes(action))throw new TypeError("allowedActions contains a duplicate action");
    if(index<=previous)throw new TypeError("allowedActions must use canonical action order");
    previous=index;out.push(action);
  }
  return out;
}
function publicKey(key:string|KeyObject):KeyObject {
  const value=typeof key==="string"?createPublicKey(key):(key.type==="public"?key:createPublicKey(key));
  if(value.asymmetricKeyType!=="ed25519")throw new TypeError("Worker lease capability keys must be Ed25519");
  return value;
}
function publicPem(key:string|KeyObject):string {
  return publicKey(key).export({type:"spki",format:"pem"}).toString();
}
function canonicalBase64(value:unknown):{text:string;bytes:Buffer} {
  const text=required(value,"signatureBase64");
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(text)||text.length%4!==0)throw new TypeError("signatureBase64 must use canonical Base64");
  const bytes=Buffer.from(text,"base64");
  if(bytes.toString("base64")!==text)throw new TypeError("signatureBase64 must use canonical Base64");
  if(bytes.length!==64)throw new TypeError("Worker lease capability requires a 64-byte Ed25519 signature");
  return {text,bytes};
}
function canonicalCore(input:WorkerLeaseCapabilityCore):WorkerLeaseCapabilityCore {
  if(!input||input.protocolVersion!=="axiom.worker-lease/v1")throw new TypeError("Lease capability protocolVersion must be axiom.worker-lease/v1");
  return {
    protocolVersion:"axiom.worker-lease/v1",
    workerId:required(input.workerId,"workerId"),
    workerKeyId:required(input.workerKeyId,"workerKeyId"),
    poolId:required(input.poolId,"poolId"),
    tenantId:required(input.tenantId,"tenantId"),
    jobId:required(input.jobId,"jobId"),
    intentHash:digest(input.intentHash,"intentHash"),
    leaseEpoch:positiveEpoch(input.leaseEpoch),
    leaseExpiresAt:canonicalIso(input.leaseExpiresAt,"leaseExpiresAt"),
    allowedActions:canonicalActions(input.allowedActions),
    signerKeyId:required(input.signerKeyId,"signerKeyId")
  };
}
function signingPayload(core:WorkerLeaseCapabilityCore):JsonValue {
  return {domain:"AXIOM_WORKER_LEASE_CAPABILITY_V1",core} as JsonValue;
}
function payloadHash(payload:JsonValue):string {
  return sha256Hex(canonicalize(payload));
}

export function workerLeaseCapabilityCoreHash(input:WorkerLeaseCapabilityCore):string {
  return payloadHash(signingPayload(canonicalCore(input)));
}

export function prepareWorkerLeaseCapability(input:WorkerLeaseCapabilityCore):PreparedWorkerLeaseCapability {
  const core=canonicalCore(input);
  const payload=signingPayload(core);
  return {
    core:structuredClone(core),
    signingPayload:structuredClone(payload),
    coreHash:payloadHash(payload)
  };
}

export function finalizeWorkerLeaseCapability(
  prepared:PreparedWorkerLeaseCapability,
  trustedPublicKey:string|KeyObject,
  signatureBase64:string
):WorkerLeaseCapability {
  if(!prepared||typeof prepared!=="object")throw new TypeError("Prepared lease capability is required");
  const currentCore=canonicalCore(prepared.core);
  const expectedPayload=signingPayload(currentCore);
  const expectedHash=payloadHash(expectedPayload);
  if(prepared.coreHash!==expectedHash)throw new Error("Prepared lease capability core integrity check failed");
  if(payloadHash(prepared.signingPayload)!==expectedHash||canonicalize(prepared.signingPayload)!==canonicalize(expectedPayload)){
    throw new Error("Prepared lease capability signing payload integrity check failed");
  }
  const key=publicKey(trustedPublicKey),signature=canonicalBase64(signatureBase64);
  if(!verify(null,Buffer.from(canonicalize(expectedPayload)),key,signature.bytes)){
    throw new Error("Worker lease capability signature verification failed");
  }
  return {
    core:structuredClone(currentCore),
    capabilityId:expectedHash,
    signatureBase64:signature.text
  };
}

export function verifyWorkerLeaseCapability(
  capability:WorkerLeaseCapability,
  trustedPublicKey:string|KeyObject
):boolean {
  try{
    if(!capability||typeof capability!=="object")return false;
    const core=canonicalCore(capability.core);
    const expectedId=workerLeaseCapabilityCoreHash(core);
    if(capability.capabilityId!==expectedId)return false;
    const signature=canonicalBase64(capability.signatureBase64);
    return verify(
      null,
      Buffer.from(canonicalize(signingPayload(core))),
      publicKey(trustedPublicKey),
      signature.bytes
    );
  }catch{return false;}
}

export interface WorkerLeaseCapabilitySigner {
  readonly keyId:string;
  issue(input:Omit<WorkerLeaseCapabilityCore,"protocolVersion"|"signerKeyId">):WorkerLeaseCapability;
  verify(capability:WorkerLeaseCapability):boolean;
  trustedPublicKeyPem(keyId?:string):string|undefined;
}

export function createStaticWorkerLeaseSigner(
  keyIdInput:string,
  signer:{privateKey:KeyObject;publicKey:KeyObject},
  historicalTrustedKeys:Record<string,string|KeyObject>={}
):WorkerLeaseCapabilitySigner {
  const keyId=required(keyIdInput,"lease signer keyId");
  if(!signer?.privateKey||!signer?.publicKey)throw new TypeError("Worker lease signer keypair is required");
  const activePublic=publicKey(signer.publicKey);
  const activePrivate=signer.privateKey;
  if(activePrivate.asymmetricKeyType!=="ed25519")throw new TypeError("Worker lease signer private key must be Ed25519");
  const trusted=new Map<string,string>();
  for(const [id,key] of Object.entries(historicalTrustedKeys)){
    trusted.set(required(id,"trusted lease signer keyId"),publicPem(key));
  }
  const activePem=publicPem(activePublic),existing=trusted.get(keyId);
  if(existing!==undefined&&existing!==activePem)throw new Error("Active worker lease signer key conflicts with trusted keyring");
  trusted.set(keyId,activePem);

  return Object.freeze({
    keyId,
    issue(input){
      const prepared=prepareWorkerLeaseCapability({
        ...structuredClone(input),
        protocolVersion:"axiom.worker-lease/v1",
        signerKeyId:keyId
      });
      const signature=sign(null,Buffer.from(canonicalize(prepared.signingPayload)),activePrivate).toString("base64");
      return finalizeWorkerLeaseCapability(prepared,activePublic,signature);
    },
    verify(capability){
      const pem=trusted.get(capability?.core?.signerKeyId);
      return pem?verifyWorkerLeaseCapability(capability,pem):false;
    },
    trustedPublicKeyPem(requested=keyId){return trusted.get(requested);}
  });
}
