import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";

export type WorkerAction="CLAIM"|"HEARTBEAT"|"RELEASE"|"COMPLETE"|"FAIL_TERMINAL";
const ACTIONS:readonly WorkerAction[]=["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"];
export interface WorkerIdentity {
  protocolVersion:"axiom.worker/v1";
  workerId:string;
  keyId:string;
  poolId:string;
  algorithm:"Ed25519";
  publicKeySha256:string;
}
export interface WorkerTrustRecord {
  readonly identity:Readonly<WorkerIdentity>;
  readonly publicKeyPem:string;
  readonly status:"ACTIVE"|"REVOKED";
  readonly maxLeaseMs:number;
  readonly allowedActions:readonly WorkerAction[];
  readonly recordHash:string;
}
export interface WorkerRequestProof {
  protocolVersion:"axiom.worker-request/v1";
  workerId:string;
  keyId:string;
  requestId:string;
  action:WorkerAction;
  targetJobId?:string;
  bodyHash:string;
  issuedAt:string;
  signatureBase64:string;
}
export interface AuthenticatedWorkerContext {
  readonly identity:Readonly<WorkerIdentity>;
  readonly maxLeaseMs:number;
  readonly allowedActions:readonly WorkerAction[];
  readonly requestId:string;
  readonly action:WorkerAction;
  readonly targetJobId?:string;
  readonly bodyHash:string;
  readonly requestHash:string;
  readonly workerRecordHash:string;
}
export interface WorkerTrustStore {
  get(workerId:string,keyId:string):WorkerTrustRecord|undefined;
}
export interface ExpectedWorkerRequest { action:WorkerAction; bodyHash:string; targetJobId?:string; }
function required(value:unknown,label:string):string {
  if(typeof value!=="string"||value.trim()!==value||value.length<1||value.length>256)
    throw new TypeError(`Invalid worker ${label}`);
  return value;
}
function hexHash(value:unknown,label:string):string {
  if(typeof value!=="string"||!/^[0-9a-f]{64}$/.test(value))throw new TypeError(`Invalid worker ${label}`);
  return value;
}
function preciseIso(value:unknown,label:string):string {
  if(typeof value!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    ||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)
    throw new TypeError(`Invalid worker ${label}`);
  return value;
}
function edPublicKey(pem:string):KeyObject {
  const key=createPublicKey(pem);
  if(key.type!=="public"||key.asymmetricKeyType!=="ed25519")throw new TypeError("Worker trust keys must be Ed25519");
  return key;
}
function validateAction(value:unknown):WorkerAction {
  if(!ACTIONS.includes(value as WorkerAction))throw new TypeError("Invalid worker action");
  return value as WorkerAction;
}
export function createWorkerTrustRecord(input:{
  workerId:string;keyId:string;poolId:string;publicKeyPem:string;status:"ACTIVE"|"REVOKED";
  maxLeaseMs:number;allowedActions:WorkerAction[];publicKeySha256?:string;
}):WorkerTrustRecord {
  const workerId=required(input.workerId,"workerId");
  const keyId=required(input.keyId,"keyId");
  const poolId=required(input.poolId,"poolId");
  if(input.status!=="ACTIVE"&&input.status!=="REVOKED")throw new TypeError("Invalid worker status");
  if(!Number.isSafeInteger(input.maxLeaseMs)||input.maxLeaseMs<1||input.maxLeaseMs>86_400_000)
    throw new TypeError("Invalid worker maxLeaseMs");
  if(!Array.isArray(input.allowedActions)||input.allowedActions.length===0)throw new TypeError("Missing worker actions");
  const actions=input.allowedActions.map(validateAction);
  if(new Set(actions).size!==actions.length)throw new TypeError("Duplicate worker action");
  const allowedActions=Object.freeze([...ACTIONS].filter(a=>actions.includes(a)));
  const key=edPublicKey(input.publicKeyPem);
  const publicKeyPem=key.export({type:"spki",format:"pem"}).toString();
  const publicKeySha256=sha256Hex(key.export({type:"spki",format:"der"}) as Buffer);
  if(input.publicKeySha256!==undefined&&hexHash(input.publicKeySha256,"publicKeySha256")!==publicKeySha256)
    throw new TypeError("Worker public-key hash mismatch");
  const identity=Object.freeze({
    protocolVersion:"axiom.worker/v1" as const,workerId,keyId,poolId,algorithm:"Ed25519" as const,publicKeySha256
  });
  const core={identity,publicKeyPem,status:input.status,maxLeaseMs:input.maxLeaseMs,allowedActions};
  return Object.freeze({...core,recordHash:hashJson({domain:"AXIOM_WORKER_TRUST_RECORD_V1",...core})});
}
export class StaticWorkerTrustStore implements WorkerTrustStore {
  readonly #records:Map<string,WorkerTrustRecord>;
  constructor(records:readonly WorkerTrustRecord[]){
    this.#records=new Map();
    for(const record of records){
      const expected=hashJson({domain:"AXIOM_WORKER_TRUST_RECORD_V1",
        identity:record.identity,publicKeyPem:record.publicKeyPem,status:record.status,
        maxLeaseMs:record.maxLeaseMs,allowedActions:record.allowedActions});
      if(record.recordHash!==expected)throw new TypeError("Invalid worker trust-record hash");
      const key=`${record.identity.workerId}\u0000${record.identity.keyId}`;
      if(this.#records.has(key))throw new TypeError("Duplicate worker trust identity");
      this.#records.set(key,record);
    }
  }
  get(workerId:string,keyId:string):WorkerTrustRecord|undefined {
    return this.#records.get(`${workerId}\u0000${keyId}`);
  }
}
export function workerRequestSigningPayload(proof:Omit<WorkerRequestProof,"signatureBase64">){
  const base={
    domain:"AXIOM_WORKER_REQUEST_V1",
    protocolVersion:proof.protocolVersion,
    workerId:proof.workerId,keyId:proof.keyId,requestId:proof.requestId,
    action:proof.action,bodyHash:proof.bodyHash,issuedAt:proof.issuedAt
  };
  return proof.targetJobId===undefined?base:{...base,targetJobId:proof.targetJobId};
}
function canonicalSignature(value:unknown):Buffer {
  if(typeof value!=="string"||!/^[-A-Za-z0-9+/]{86}==$/.test(value))
    throw new TypeError("Invalid worker signature encoding");
  const bytes=Buffer.from(value,"base64");
  if(bytes.length!==64||bytes.toString("base64")!==value)throw new TypeError("Invalid worker signature");
  return bytes;
}
export class WorkerRequestAuthenticator {
  private readonly store:WorkerTrustStore;
  private readonly config:{maxAgeMs:number;futureSkewMs:number};
  constructor(
    store:WorkerTrustStore,
    config:{maxAgeMs:number;futureSkewMs:number}
  ){
    this.store=store;
    this.config=config;
    if(!Number.isSafeInteger(config.maxAgeMs)||config.maxAgeMs<1||config.maxAgeMs>86_400_000
      ||!Number.isSafeInteger(config.futureSkewMs)||config.futureSkewMs<0||config.futureSkewMs>300_000)
      throw new TypeError("Invalid worker authentication freshness policy");
  }
  authenticate(proof:WorkerRequestProof,expected:ExpectedWorkerRequest,serverNow:string,verifiedStoredReceipt=false):AuthenticatedWorkerContext {
    if(!proof||typeof proof!=="object"||Array.isArray(proof))throw new TypeError("Worker proof required");
    const allowed=new Set(["protocolVersion","workerId","keyId","requestId","action","targetJobId","bodyHash","issuedAt","signatureBase64"]);
    if(Object.keys(proof).some(k=>!allowed.has(k)))throw new TypeError("Unknown worker proof field");
    if(proof.protocolVersion!=="axiom.worker-request/v1")throw new TypeError("Worker request protocol mismatch");
    const workerId=required(proof.workerId,"workerId");
    const keyId=required(proof.keyId,"keyId");
    const requestId=required(proof.requestId,"requestId");
    const action=validateAction(proof.action);
    const bodyHash=hexHash(proof.bodyHash,"bodyHash");
    if(proof.targetJobId!==undefined)required(proof.targetJobId,"targetJobId");
    preciseIso(proof.issuedAt,"issuedAt");
    preciseIso(serverNow,"serverNow");
    if(!expected||validateAction(expected.action)!==action||hexHash(expected.bodyHash,"expected bodyHash")!==bodyHash
      ||expected.targetJobId!==proof.targetJobId)
      throw new TypeError("Worker action or target mismatch");
    const record=this.store.get(workerId,keyId);
    if(!record||record.status!=="ACTIVE")throw new Error("WORKER_UNAUTHENTICATED");
    if(!record.allowedActions.includes(action))throw new Error("WORKER_FORBIDDEN");
    const expectedRecordHash=hashJson({domain:"AXIOM_WORKER_TRUST_RECORD_V1",identity:record.identity,
      publicKeyPem:record.publicKeyPem,status:record.status,maxLeaseMs:record.maxLeaseMs,allowedActions:record.allowedActions});
    if(record.recordHash!==expectedRecordHash||record.identity.workerId!==workerId||record.identity.keyId!==keyId)
      throw new Error("WORKER_UNAUTHENTICATED");
    const age=Date.parse(serverNow)-Date.parse(proof.issuedAt);
    if(!verifiedStoredReceipt&&(age>this.config.maxAgeMs||age< -this.config.futureSkewMs))
      throw new Error("WORKER_UNAUTHENTICATED");
    const signature=canonicalSignature(proof.signatureBase64);
    const payload=workerRequestSigningPayload(proof);
    if(!verify(null,Buffer.from(canonicalize(payload)),edPublicKey(record.publicKeyPem),signature))
      throw new Error("WORKER_UNAUTHENTICATED");
    return Object.freeze({
      identity:record.identity,maxLeaseMs:record.maxLeaseMs,allowedActions:record.allowedActions,
      requestId,action,...(proof.targetJobId===undefined?{}:{targetJobId:proof.targetJobId}),
      bodyHash,requestHash:hashJson(payload),workerRecordHash:record.recordHash
    });
  }
}
