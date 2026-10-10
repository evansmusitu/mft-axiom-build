import type { JsonValue } from "../../phase1/src/types.ts";
import type { AdapterManifest, AdapterOperationManifest, CapturedEvidence } from "./types.ts";
import type { AdapterAcquisitionInput, EvidenceAdapter, SecretResolver } from "./evidence.ts";
import {
  captureBoundedJsonResponse, EvidenceAdapterError, type EvidenceFetch, validateEvidenceHttpsOrigin
} from "./http_evidence_adapter.ts";

const HEX64=/^[0-9a-f]{64}$/;
const SIDE_EFFECT=/(^|[._:-])(trade|order|send|publish|submit|execute|payment|checkout|transfer|withdraw|deposit|delete|remove|terminate|liquidate|close|revoke)([._:-]|$)/i;

function required(v:unknown,label:string):string {
  if(typeof v!=="string"||!v.trim())throw new TypeError(`${label} is required`);
  return v;
}
function digest(v:unknown,label:string):string {
  const s=required(v,label);
  if(!HEX64.test(s))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return s;
}
function validateOperation(op:AdapterOperationManifest):AdapterOperationManifest {
  const id=required(op?.operationId,"operationId");
  if(SIDE_EFFECT.test(id))throw new TypeError(`MUSITU evidence operation is side-effect-like and is not allowed: ${id}`);
  digest(op.parameterSchemaHash,"parameterSchemaHash");
  if(!Array.isArray(op.responseMediaTypes)||!op.responseMediaTypes.includes("application/json"))throw new TypeError("MUSITU evidence operation must allow application/json");
  if(!Number.isInteger(op.maxResponseBytes)||op.maxResponseBytes<=0)throw new RangeError("maxResponseBytes must be positive");
  if(!Number.isInteger(op.timeoutMs)||op.timeoutMs<=0)throw new RangeError("timeoutMs must be positive");
  if(!Array.isArray(op.mappingIds)||op.mappingIds.length===0)throw new TypeError("mappingIds must not be empty");
  return structuredClone(op);
}

export class MusituAxiomEvidenceAdapter implements EvidenceAdapter {
  readonly manifest:AdapterManifest;
  private readonly base:URL;
  private readonly operations=new Map<string,AdapterOperationManifest>();
  private readonly parameterValidators=new Map<string,(parameters:Readonly<Record<string,JsonValue>>)=>void>();
  private readonly authSecretRef?:string;
  private readonly secretResolver:SecretResolver;
  private readonly fetchFn:EvidenceFetch;

  constructor(config:{
    adapterId:string;version:string;implementationHash:string;computeBase:string;
    operations:AdapterOperationManifest[];
    parameterValidators:Record<string,(parameters:Readonly<Record<string,JsonValue>>)=>void>;
    authSecretRef?:string;
    secretResolver:SecretResolver;fetchFn?:EvidenceFetch;
  }){
    const adapterId=required(config.adapterId,"adapterId"),version=required(config.version,"adapter version"),implementationHash=digest(config.implementationHash,"adapter implementationHash");
    this.base=validateEvidenceHttpsOrigin(config.computeBase);
    if(!Array.isArray(config.operations)||config.operations.length===0)throw new TypeError("MUSITU evidence operations must not be empty");
    for(const raw of config.operations){
      const op=validateOperation(raw);
      if(this.operations.has(op.operationId))throw new TypeError(`Duplicate MUSITU evidence operation: ${op.operationId}`);
      const validator=config.parameterValidators?.[op.operationId];
      if(typeof validator!=="function")throw new TypeError(`MUSITU evidence operation requires a parameter validator: ${op.operationId}`);
      this.operations.set(op.operationId,op);
      this.parameterValidators.set(op.operationId,validator);
    }
    for(const operationId of Object.keys(config.parameterValidators??{})){
      if(!this.operations.has(operationId))throw new TypeError(`Parameter validator references unknown MUSITU operation: ${operationId}`);
    }
    if(config.authSecretRef!==undefined)this.authSecretRef=required(config.authSecretRef,"authSecretRef");
    this.secretResolver=config.secretResolver;this.fetchFn=config.fetchFn??fetch;
    this.manifest={adapterId,version,implementationHash,capability:"COMPUTE",operations:[...this.operations.values()].map(x=>structuredClone(x))};
  }

  validateParameters(input:AdapterAcquisitionInput):void {
    const operationId=input.operation?.operationId;
    const op=this.operations.get(operationId);
    if(!op||SIDE_EFFECT.test(operationId))throw new Error("Unknown or disallowed MUSITU evidence operation");
    if(!input.parameters||typeof input.parameters!=="object"||Array.isArray(input.parameters))throw new TypeError("MUSITU evidence parameters must be an object");
    this.parameterValidators.get(operationId)!(structuredClone(input.parameters));
  }

  async acquire(input:AdapterAcquisitionInput):Promise<CapturedEvidence> {
    this.validateParameters(input);
    const operationId=input.operation.operationId;
    const op=this.operations.get(operationId)!;
    const headers:Record<string,string>={"accept":"application/json","content-type":"application/json"};
    const secrets:string[]=[];
    if(this.authSecretRef){
      const value=await this.secretResolver.resolve(this.authSecretRef);
      headers.authorization=value;secrets.push(value);
    }
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),op.timeoutMs);
    let response:Response;
    try{
      response=await this.fetchFn(new URL("/v1/compute",this.base),{
        method:"POST",headers,redirect:"manual",signal:controller.signal,
        body:JSON.stringify({operation:op.operationId,args:input.parameters})
      });
    }catch{
      if(controller.signal.aborted)throw new EvidenceAdapterError("UPSTREAM_TIMEOUT","MUSITU Axiom compute request timed out",504);
      throw new EvidenceAdapterError("UPSTREAM_NETWORK","MUSITU Axiom compute request failed",502);
    }finally{clearTimeout(timer);}
    return captureBoundedJsonResponse({
      response,allowedStatus:[200],allowedMediaTypes:op.responseMediaTypes,
      maxResponseBytes:op.maxResponseBytes,secrets
    });
  }
}
