import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";

export type WorkerLeaseAction="HEARTBEAT"|"RELEASE"|"COMPLETE"|"FAIL_TERMINAL";
const ORDER:WorkerLeaseAction[]=["HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"];
export interface WorkerLeaseCapabilityCore {
  protocolVersion:"axiom.worker-lease/v1";
  workerId:string;workerKeyId:string;poolId:string;tenantId:string;jobId:string;
  intentHash:string;leaseEpoch:number;leaseExpiresAt:string;
  allowedActions:WorkerLeaseAction[];signerKeyId:string;
}
export interface WorkerLeaseCapability {
  core:WorkerLeaseCapabilityCore;capabilityId:string;signatureBase64:string;
}
export interface PreparedWorkerLeaseCapability {
  core:WorkerLeaseCapabilityCore;
  signingPayload:{domain:"AXIOM_WORKER_LEASE_CAPABILITY_V1";core:WorkerLeaseCapabilityCore};
  capabilityId:string;
}
export interface WorkerLeaseSignerIdentity {
  protocolVersion:"axiom.worker-lease-signer/v1";keyId:string;algorithm:"Ed25519";publicKeySha256:string;
}
export interface WorkerLeaseCapabilitySigner {
  readonly identity:Readonly<WorkerLeaseSignerIdentity>;
  issue(core:WorkerLeaseCapabilityCore):WorkerLeaseCapability;
  trustedPublicKeyPem(keyId?:string):string|undefined;
  signReceipt(receiptHash:string):string;
}
function text(value:unknown,label:string):string {
  if(typeof value!=="string"||!value||value.trim()!==value||value.length>256)
    throw new TypeError(`Invalid ${label}`);
  return value;
}
function publicKey(input:string|KeyObject):KeyObject {
  const key=typeof input==="string"?createPublicKey(input):input.type==="private"?createPublicKey(input):input;
  if(key.type!=="public"||key.asymmetricKeyType!=="ed25519")throw new TypeError("Lease trust requires Ed25519");
  return key;
}
function signatureBytes(value:unknown):Buffer {
  if(typeof value!=="string"||!/^[A-Za-z0-9+/]{86}==$/.test(value))throw new TypeError("Invalid lease signature");
  const bytes=Buffer.from(value,"base64");
  if(bytes.length!==64||bytes.toString("base64")!==value)throw new TypeError("Noncanonical lease signature");
  return bytes;
}
function checkedCore(value:WorkerLeaseCapabilityCore):WorkerLeaseCapabilityCore {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("Missing lease core");
  const fields=["protocolVersion","workerId","workerKeyId","poolId","tenantId","jobId","intentHash",
    "leaseEpoch","leaseExpiresAt","allowedActions","signerKeyId"];
  if(Object.keys(value).length!==fields.length||Object.keys(value).some(k=>!fields.includes(k)))
    throw new TypeError("Unknown or missing lease fields");
  if(value.protocolVersion!=="axiom.worker-lease/v1")throw new TypeError("Invalid lease protocol");
  const core={
    protocolVersion:"axiom.worker-lease/v1" as const,
    workerId:text(value.workerId,"workerId"),
    workerKeyId:text(value.workerKeyId,"workerKeyId"),
    poolId:text(value.poolId,"poolId"),
    tenantId:text(value.tenantId,"tenantId"),
    jobId:text(value.jobId,"jobId"),
    intentHash:value.intentHash,leaseEpoch:value.leaseEpoch,
    leaseExpiresAt:value.leaseExpiresAt,allowedActions:value.allowedActions,
    signerKeyId:text(value.signerKeyId,"signerKeyId")
  };
  if(typeof core.intentHash!=="string"||!/^[0-9a-f]{64}$/.test(core.intentHash))
    throw new TypeError("Invalid lease intentHash");
  if(!Number.isSafeInteger(core.leaseEpoch)||core.leaseEpoch<1)throw new TypeError("Invalid lease epoch");
  if(typeof core.leaseExpiresAt!=="string"
    ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(core.leaseExpiresAt)
    ||!Number.isFinite(Date.parse(core.leaseExpiresAt))
    ||new Date(core.leaseExpiresAt).toISOString()!==core.leaseExpiresAt)throw new TypeError("Invalid lease expiry");
  if(!Array.isArray(core.allowedActions)||core.allowedActions.length===0
    ||core.allowedActions.some(x=>!ORDER.includes(x))
    ||new Set(core.allowedActions).size!==core.allowedActions.length
    ||core.allowedActions.some((x,i)=>ORDER.filter(y=>core.allowedActions.includes(y))[i]!==x))
    throw new TypeError("Noncanonical lease actions");
  return {...core,allowedActions:[...core.allowedActions]};
}
export function prepareWorkerLeaseCapability(core:WorkerLeaseCapabilityCore):PreparedWorkerLeaseCapability {
  const checked=checkedCore(core);
  const signingPayload={domain:"AXIOM_WORKER_LEASE_CAPABILITY_V1" as const,core:checked};
  return {core:checked,signingPayload,capabilityId:hashJson(signingPayload as any)};
}
export function workerLeaseCapabilityHash(capability:WorkerLeaseCapability|WorkerLeaseCapabilityCore):string {
  return prepareWorkerLeaseCapability("core" in capability?capability.core:capability).capabilityId;
}
export function finalizeWorkerLeaseCapability(
  prepared:PreparedWorkerLeaseCapability,key:string|KeyObject,signatureBase64:string
):WorkerLeaseCapability {
  const checked=prepareWorkerLeaseCapability(prepared.core);
  if(checked.capabilityId!==prepared.capabilityId
    ||canonicalize(checked.signingPayload as any)!==canonicalize(prepared.signingPayload as any))
    throw new TypeError("Lease payload mutated after preparation");
  if(!verify(null,Buffer.from(canonicalize(checked.signingPayload as any)),publicKey(key),signatureBytes(signatureBase64)))
    throw new TypeError("Lease signature mismatch");
  return {core:checked.core,capabilityId:checked.capabilityId,signatureBase64};
}
export function verifyWorkerLeaseCapability(
  capability:WorkerLeaseCapability,trusted:Record<string,string|KeyObject>
):boolean {
  try{
    if(!capability||Object.keys(capability).sort().join(",")!=="capabilityId,core,signatureBase64")return false;
    const prepared=prepareWorkerLeaseCapability(capability.core);
    if(prepared.capabilityId!==capability.capabilityId)return false;
    const key=trusted[capability.core.signerKeyId];
    return !!key&&verify(null,Buffer.from(canonicalize(prepared.signingPayload as any)),publicKey(key),
      signatureBytes(capability.signatureBase64));
  }catch{return false;}
}
export function verifyWorkerReceiptSignature(
 receiptHash:string,keyId:string,signatureBase64:string,trustedKey:string|KeyObject
):boolean{
 try{
  if(!/^[0-9a-f]{64}$/.test(receiptHash)||!keyId)return false;
  const payload={domain:"AXIOM_WORKER_RECEIPT_V1",keyId,receiptHash};
  return verify(null,Buffer.from(canonicalize(payload as any)),publicKey(trustedKey),signatureBytes(signatureBase64));
 }catch{return false;}
}
export function createStaticWorkerLeaseSigner(
  keyId:string,keys:{privateKey:KeyObject;publicKey:KeyObject},
  historical:Record<string,string|KeyObject>={}
):WorkerLeaseCapabilitySigner {
  text(keyId,"lease signer keyId");
  if(keys?.privateKey?.type!=="private"||keys.privateKey.asymmetricKeyType!=="ed25519")
    throw new TypeError("Lease signer Ed25519 private key required");
  const active=publicKey(keys.publicKey);
  const check=Buffer.from("AXIOM_LEASE_SIGNER_KEY_PAIR_CHECK_V1");
  if(!verify(null,check,active,sign(null,check,keys.privateKey)))
    throw new TypeError("Lease signer key mismatch");
  const pem=active.export({type:"spki",format:"pem"}).toString();
  const ring=new Map<string,string>();
  for(const [id,key] of Object.entries(historical))
    ring.set(text(id,"lease keyId"),publicKey(key).export({type:"spki",format:"pem"}).toString());
  if(ring.has(keyId)&&ring.get(keyId)!==pem)throw new TypeError("Lease key ring collision");
  ring.set(keyId,pem);
  const identity=Object.freeze({
    protocolVersion:"axiom.worker-lease-signer/v1" as const,keyId,algorithm:"Ed25519" as const,
    publicKeySha256:sha256Hex(active.export({type:"spki",format:"der"}) as Buffer)
  });
  return Object.freeze({
    identity,
    trustedPublicKeyPem:(id=keyId)=>ring.get(id),
    signReceipt:(receiptHash:string)=>{
      if(!/^[0-9a-f]{64}$/.test(receiptHash))throw new TypeError("Invalid receipt hash");
      const payload={domain:"AXIOM_WORKER_RECEIPT_V1",keyId,receiptHash};
      return sign(null,Buffer.from(canonicalize(payload as any)),keys.privateKey).toString("base64");
    },
    issue:(core:WorkerLeaseCapabilityCore)=>{
      if(core.signerKeyId!==keyId)throw new TypeError("Lease signer identity mismatch");
      const prepared=prepareWorkerLeaseCapability(core);
      const signature=sign(null,Buffer.from(canonicalize(prepared.signingPayload as any)),keys.privateKey).toString("base64");
      return finalizeWorkerLeaseCapability(prepared,active,signature);
    }
  });
}
