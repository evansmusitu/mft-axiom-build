import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import type {
  AuthenticatedWorkerContext, WorkerAction, WorkerIdentity, WorkerRequestProof, WorkerTrustRecord
} from "./types.ts";

const HEX64=/^[0-9a-f]{64}$/;
const ACTIONS=new Set<WorkerAction>(["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]);

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new Error(`Worker credential rejected: ${label} must be a non-empty string`);
  return value;
}
function digest(value:unknown,label:string):string {
  const text=required(value,label);
  if(!HEX64.test(text))throw new Error(`Worker credential rejected: ${label} must be a lowercase SHA-256 digest`);
  return text;
}
function canonicalIso(value:unknown,label:string):string {
  const text=required(value,label),ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new Error(`Worker credential rejected: ${label} must be canonical ISO-8601`);
  return text;
}
function action(value:unknown):WorkerAction {
  if(typeof value!=="string"||!ACTIONS.has(value as WorkerAction))throw new Error("Worker credential rejected: action is invalid");
  return value as WorkerAction;
}
function canonicalBase64(value:unknown,label:string):Buffer {
  const text=required(value,label);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(text)||text.length%4!==0)throw new Error(`Worker credential rejected: ${label} must use canonical Base64`);
  const bytes=Buffer.from(text,"base64");
  if(bytes.toString("base64")!==text)throw new Error(`Worker credential rejected: ${label} must use canonical Base64`);
  return bytes;
}
function publicKeyInfo(key:string|KeyObject):{pem:string;sha256:string} {
  const publicKey=typeof key==="string"?createPublicKey(key):(key.type==="public"?key:createPublicKey(key));
  if(publicKey.asymmetricKeyType!=="ed25519")throw new TypeError("Worker trust keys must be Ed25519 public keys");
  const pem=publicKey.export({type:"spki",format:"pem"}).toString();
  const der=publicKey.export({type:"spki",format:"der"}) as Buffer;
  return {pem,sha256:sha256Hex(der)};
}
function positiveInteger(value:unknown,label:string):number {
  if(!Number.isInteger(value)||Number(value)<=0)throw new TypeError(`${label} must be a positive integer`);
  return Number(value);
}
function frozenActions(values:unknown):ReadonlyArray<WorkerAction> {
  if(!Array.isArray(values)||values.length===0)throw new TypeError("Worker allowedActions must not be empty");
  const out=values.map(action);
  if(new Set(out).size!==out.length)throw new TypeError("Worker allowedActions must not contain duplicates");
  return Object.freeze([...out]);
}
function trustCore(record:Omit<WorkerTrustRecord,"recordHash">):unknown {
  return {
    identity:record.identity,publicKeyPem:record.publicKeyPem,status:record.status,
    maxLeaseMs:record.maxLeaseMs,allowedActions:record.allowedActions
  };
}

export function createWorkerTrustRecord(input:{
  workerId:string;
  keyId:string;
  poolId:string;
  publicKey:string|KeyObject;
  status:"ACTIVE"|"REVOKED";
  maxLeaseMs:number;
  allowedActions:WorkerAction[];
}):WorkerTrustRecord {
  const workerId=required(input.workerId,"workerId"),keyId=required(input.keyId,"keyId"),poolId=required(input.poolId,"poolId");
  if(input.status!=="ACTIVE"&&input.status!=="REVOKED")throw new TypeError("Worker status must be ACTIVE or REVOKED");
  const key=publicKeyInfo(input.publicKey),allowedActions=frozenActions(input.allowedActions);
  const identity=Object.freeze({
    protocolVersion:"axiom.worker/v1" as const,workerId,keyId,poolId,algorithm:"Ed25519" as const,publicKeySha256:key.sha256
  });
  const core={
    identity,
    publicKeyPem:key.pem,
    status:input.status,
    maxLeaseMs:positiveInteger(input.maxLeaseMs,"maxLeaseMs"),
    allowedActions:allowedActions as WorkerAction[]
  };
  return Object.freeze({...core,recordHash:hashJson(trustCore(core as any) as any)});
}

export interface WorkerTrustStore {
  get(workerId:string,keyId:string):WorkerTrustRecord|undefined;
}

export function createWorkerTrustStore(records:WorkerTrustRecord[]):WorkerTrustStore {
  if(!Array.isArray(records))throw new TypeError("Worker trust records must be an array");
  const trusted=new Map<string,WorkerTrustRecord>();
  for(const record of records){
    if(!record||record.identity?.protocolVersion!=="axiom.worker/v1"||record.identity.algorithm!=="Ed25519")throw new TypeError("Worker trust record identity is invalid");
    const workerId=required(record.identity.workerId,"workerId"),keyId=required(record.identity.keyId,"keyId");
    required(record.identity.poolId,"poolId");
    if(record.status!=="ACTIVE"&&record.status!=="REVOKED")throw new TypeError("Worker trust record status is invalid");
    positiveInteger(record.maxLeaseMs,"maxLeaseMs");
    const allowed=frozenActions(record.allowedActions);
    const key=publicKeyInfo(record.publicKeyPem);
    if(key.sha256!==record.identity.publicKeySha256)throw new Error("Worker trust record public key hash mismatch");
    const normalizedCore={
      identity:Object.freeze({...record.identity}),
      publicKeyPem:key.pem,
      status:record.status,
      maxLeaseMs:record.maxLeaseMs,
      allowedActions:allowed as WorkerAction[]
    };
    if(hashJson(trustCore(normalizedCore as any) as any)!==record.recordHash)throw new Error("Worker trust record hash mismatch");
    const normalized=Object.freeze({...normalizedCore,recordHash:record.recordHash});
    const id=`${workerId}\u0000${keyId}`;
    if(trusted.has(id))throw new TypeError("Duplicate worker trust record");
    trusted.set(id,normalized);
  }
  return {get:(workerId,keyId)=>trusted.get(`${workerId}\u0000${keyId}`)};
}

export function workerRequestSigningPayload(input:Omit<WorkerRequestProof,"signatureBase64">|WorkerRequestProof):unknown {
  const core={
    domain:"AXIOM_WORKER_REQUEST_V1",
    protocolVersion:input.protocolVersion,
    workerId:input.workerId,
    keyId:input.keyId,
    requestId:input.requestId,
    action:input.action,
    bodyHash:input.bodyHash,
    issuedAt:input.issuedAt
  };
  return input.targetJobId===undefined?core:{...core,targetJobId:input.targetJobId};
}

export function hashWorkerRequestProof(proof:WorkerRequestProof):string {
  return hashJson(workerRequestSigningPayload(proof) as any);
}

export interface WorkerAuthenticationExpectation {
  action:WorkerAction;
  targetJobId?:string;
  bodyHash:string;
  now:string;
}

export class WorkerRequestAuthenticator {
  private readonly trustStore:WorkerTrustStore;
  private readonly maxRequestAgeMs:number;
  private readonly maxFutureSkewMs:number;
  constructor(config:{trustStore:WorkerTrustStore;maxRequestAgeMs:number;maxFutureSkewMs:number}){
    if(!config?.trustStore||typeof config.trustStore.get!=="function")throw new TypeError("Worker trustStore is required");
    this.trustStore=config.trustStore;
    this.maxRequestAgeMs=positiveInteger(config.maxRequestAgeMs,"maxRequestAgeMs");
    if(!Number.isInteger(config.maxFutureSkewMs)||config.maxFutureSkewMs<0)throw new TypeError("maxFutureSkewMs must be a non-negative integer");
    this.maxFutureSkewMs=config.maxFutureSkewMs;
  }

  authenticate(proof:WorkerRequestProof,expected:WorkerAuthenticationExpectation):AuthenticatedWorkerContext {
    if(!proof||proof.protocolVersion!=="axiom.worker-request/v1")throw new Error("Worker credential rejected: protocolVersion mismatch");
    const workerId=required(proof.workerId,"workerId"),keyId=required(proof.keyId,"keyId"),requestId=required(proof.requestId,"requestId");
    const actualAction=action(proof.action),wantedAction=action(expected?.action);
    if(actualAction!==wantedAction)throw new Error("Worker credential rejected: action mismatch");
    const bodyHash=digest(proof.bodyHash,"bodyHash"),wantedBodyHash=digest(expected?.bodyHash,"expected bodyHash");
    if(bodyHash!==wantedBodyHash)throw new Error("Worker credential rejected: body hash mismatch");

    const actualTarget=proof.targetJobId===undefined?undefined:required(proof.targetJobId,"targetJobId");
    const wantedTarget=expected?.targetJobId===undefined?undefined:required(expected.targetJobId,"expected targetJobId");
    if(actualTarget!==wantedTarget)throw new Error("Worker credential rejected: target job mismatch");

    const issuedAt=canonicalIso(proof.issuedAt,"issuedAt"),now=canonicalIso(expected?.now,"now");
    const issuedMs=Date.parse(issuedAt),nowMs=Date.parse(now);
    if(issuedMs>nowMs+this.maxFutureSkewMs)throw new Error("Worker credential rejected: request timestamp is too far in the future");
    if(nowMs-issuedMs>this.maxRequestAgeMs)throw new Error("Worker credential rejected: request is too old");

    const record=this.trustStore.get(workerId,keyId);
    if(!record)throw new Error("Worker credential rejected: no trusted worker/key");
    if(record.status!=="ACTIVE")throw new Error("Worker credential rejected: worker key is revoked");
    if(!record.allowedActions.includes(actualAction))throw new Error("Worker credential rejected: worker action is forbidden");

    const signature=canonicalBase64(proof.signatureBase64,"signatureBase64");
    if(signature.byteLength!==64)throw new Error("Worker credential rejected: Ed25519 signature must be 64 bytes");
    const publicKey=createPublicKey(record.publicKeyPem);
    if(!verify(null,Buffer.from(canonicalize(workerRequestSigningPayload(proof) as any)),publicKey,signature)){
      throw new Error("Worker credential rejected: signature verification failed");
    }

    return Object.freeze({
      identity:Object.freeze({...record.identity}),
      maxLeaseMs:record.maxLeaseMs,
      allowedActions:Object.freeze([...record.allowedActions]) as WorkerAction[],
      requestId,
      action:actualAction,
      ...(actualTarget===undefined?{}:{targetJobId:actualTarget}),
      bodyHash,
      issuedAt,
      requestHash:hashWorkerRequestProof(proof)
    }) as AuthenticatedWorkerContext;
  }
}
