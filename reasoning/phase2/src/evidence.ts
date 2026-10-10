import { hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import type { JsonValue } from "../../phase1/src/types.ts";
import type {
  AcquisitionRecord, AdapterManifest, AdapterOperationManifest, CapturedEvidence, EvidenceArtifact, FactAcquisition,
  MappingManifest, TemporalFact, TenantScope, VerifiedEvidenceArtifact
} from "./types.ts";

const HEX64=/^[0-9a-f]{64}$/;

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function hex64(value:unknown,label:string):string {
  const text=required(value,label);
  if(!HEX64.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return text;
}
function canonicalIso(value:unknown,label:string):string {
  const text=required(value,label),ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new TypeError(`${label} must use canonical ISO-8601 UTC format`);
  return text;
}
function checkedTenant(scope:TenantScope):string {
  return required(scope?.tenantId,"tenantId");
}
function unique(values:string[],label:string):void {
  const seen=new Set<string>();
  for(const value of values){
    required(value,label);
    if(seen.has(value))throw new TypeError(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}
function validateMappingManifest(m:MappingManifest):void {
  required(m?.mappingId,"mappingId");required(m?.version,"mapping version");hex64(m?.implementationHash,"mapping implementationHash");
}
function validateOperation(op:AdapterOperationManifest):void {
  required(op?.operationId,"operationId");hex64(op?.parameterSchemaHash,"parameterSchemaHash");
  if(!Array.isArray(op.responseMediaTypes)||op.responseMediaTypes.length===0)throw new TypeError("responseMediaTypes must not be empty");
  unique(op.responseMediaTypes,"response media type");
  if(!Number.isInteger(op.maxResponseBytes)||op.maxResponseBytes<=0)throw new RangeError("maxResponseBytes must be a positive integer");
  if(!Number.isInteger(op.timeoutMs)||op.timeoutMs<=0)throw new RangeError("timeoutMs must be a positive integer");
  if(!Array.isArray(op.mappingIds)||op.mappingIds.length===0)throw new TypeError("mappingIds must not be empty");
  unique(op.mappingIds,"mappingId");
}
function validateAdapterManifest(m:AdapterManifest):void {
  required(m?.adapterId,"adapterId");required(m?.version,"adapter version");hex64(m?.implementationHash,"adapter implementationHash");
  if(m.capability!=="READ"&&m.capability!=="COMPUTE")throw new TypeError("adapter capability must be READ or COMPUTE");
  if(!Array.isArray(m.operations)||m.operations.length===0)throw new TypeError("adapter operations must not be empty");
  unique(m.operations.map(x=>x.operationId),"operation");
  for(const op of m.operations)validateOperation(op);
}

export interface AdapterAcquisitionInput {
  tenant:TenantScope;
  operation:AdapterOperationManifest;
  parameters:Record<string,JsonValue>;
}
export interface EvidenceAdapter {
  readonly manifest:AdapterManifest;
  validateParameters(input:AdapterAcquisitionInput):void;
  acquire(input:AdapterAcquisitionInput):Promise<CapturedEvidence>;
}
export type TemporalFactDraft=Omit<TemporalFact,"id"|"authentication"|"acquisition">;
export interface EvidenceMapper {
  readonly manifest:MappingManifest;
  map(artifact:VerifiedEvidenceArtifact):TemporalFactDraft[];
}
export interface SecretResolver {
  resolve(secretRef:string):Promise<string>;
}

export class StaticSecretResolver implements SecretResolver {
  private readonly secrets:Map<string,string>;
  constructor(values:Record<string,string>){
    this.secrets=new Map();
    for(const [ref,value] of Object.entries(values)){
      required(ref,"secretRef");
      if(typeof value!=="string")throw new TypeError("secret material must be a string");
      this.secrets.set(ref,value);
    }
  }
  async resolve(secretRef:string):Promise<string>{
    const ref=required(secretRef,"secretRef");
    const value=this.secrets.get(ref);
    if(value===undefined)throw new Error(`Unknown secret reference: ${ref}`);
    return value;
  }
}

export interface AdapterRegistration {
  adapter:EvidenceAdapter;
  mappers:EvidenceMapper[];
  tenantIds?:string[];
}
interface StoredRegistration {
  adapter:EvidenceAdapter;
  operations:Map<string,AdapterOperationManifest>;
  mappers:Map<string,EvidenceMapper>;
  tenantIds?:Set<string>;
}

export class AdapterRegistry {
  private readonly registrations=new Map<string,StoredRegistration>();
  constructor(entries:AdapterRegistration[]){
    if(!Array.isArray(entries))throw new TypeError("adapter registrations must be an array");
    for(const entry of entries){
      validateAdapterManifest(entry?.adapter?.manifest);
      if(typeof entry?.adapter?.validateParameters!=="function")throw new TypeError("Adapter requires an executable parameter validator");
      const id=entry.adapter.manifest.adapterId;
      if(this.registrations.has(id))throw new TypeError(`Duplicate adapter: ${id}`);
      if(!Array.isArray(entry.mappers))throw new TypeError("adapter mappers must be an array");
      const mappers=new Map<string,EvidenceMapper>();
      for(const mapper of entry.mappers){
        validateMappingManifest(mapper?.manifest);
        if(mappers.has(mapper.manifest.mappingId))throw new TypeError(`Duplicate mapping: ${mapper.manifest.mappingId}`);
        mappers.set(mapper.manifest.mappingId,mapper);
      }
      const operations=new Map<string,AdapterOperationManifest>();
      for(const op of entry.adapter.manifest.operations){
        operations.set(op.operationId,structuredClone(op));
        for(const mappingId of op.mappingIds){
          if(!mappers.has(mappingId))throw new TypeError(`Operation ${op.operationId} references unknown mapping: ${mappingId}`);
        }
      }
      for(const mappingId of mappers.keys()){
        const referenced=entry.adapter.manifest.operations.some(op=>op.mappingIds.includes(mappingId));
        if(!referenced)throw new TypeError(`Unreferenced mapping: ${mappingId}`);
      }
      let tenantIds:Set<string>|undefined;
      if(entry.tenantIds!==undefined){
        if(!Array.isArray(entry.tenantIds)||entry.tenantIds.length===0)throw new TypeError("tenantIds must not be empty when configured");
        unique(entry.tenantIds,"tenantId");
        tenantIds=new Set(entry.tenantIds);
      }
      this.registrations.set(id,{adapter:entry.adapter,operations,mappers,tenantIds});
    }
  }

  resolve(scope:TenantScope,adapterId:string,operationId:string,mappingId:string){
    const tenantId=checkedTenant(scope),id=required(adapterId,"adapterId");
    const registration=this.registrations.get(id);
    if(!registration)throw new Error(`Unknown adapter: ${id}`);
    if(registration.tenantIds&&!registration.tenantIds.has(tenantId))throw new Error(`Adapter is not eligible for tenant: ${tenantId}`);
    const operation=registration.operations.get(required(operationId,"operationId"));
    if(!operation)throw new Error(`Unknown adapter operation: ${operationId}`);
    const mapId=required(mappingId,"mappingId");
    if(!operation.mappingIds.includes(mapId))throw new Error(`Mapping is not allowed for operation: ${mapId}`);
    const mapper=registration.mappers.get(mapId);
    if(!mapper)throw new Error(`Unknown mapping: ${mapId}`);
    return {adapter:registration.adapter,operation:structuredClone(operation),mapper};
  }
}

function bodyBytes(encoding:"utf8"|"base64",body:string):Buffer {
  if(typeof body!=="string")throw new TypeError("artifact body must be a string");
  if(encoding==="utf8")return Buffer.from(body,"utf8");
  if(encoding!=="base64")throw new TypeError("unsupported artifact body encoding");
  const decoded=Buffer.from(body,"base64");
  const canonical=decoded.toString("base64");
  if(canonical!==body)throw new TypeError("base64 artifact body must use canonical encoding");
  return decoded;
}
function artifactCore(a:Omit<EvidenceArtifact,"artifactId"|"artifactHash"|"body">){
  return {
    tenantId:a.tenantId,
    adapterId:a.adapterId,
    adapterVersion:a.adapterVersion,
    adapterImplementationHash:a.adapterImplementationHash,
    operationId:a.operationId,
    mappingId:a.mappingId,
    canonicalRequestHash:a.canonicalRequestHash,
    capturedAt:a.capturedAt,
    upstreamStatus:a.upstreamStatus,
    mediaType:a.mediaType,
    bodyEncoding:a.bodyEncoding,
    bodyHash:a.bodyHash
  };
}

export function createEvidenceArtifact(input:{
  tenantId:string;
  adapterId:string;
  adapterVersion:string;
  adapterImplementationHash:string;
  operationId:string;
  mappingId:string;
  canonicalRequestHash:string;
  capturedAt:string;
  upstreamStatus:number;
  mediaType:string;
  bodyEncoding:"utf8"|"base64";
  body:string;
}):EvidenceArtifact {
  const tenantId=required(input.tenantId,"tenantId");
  const adapterId=required(input.adapterId,"adapterId"),adapterVersion=required(input.adapterVersion,"adapterVersion");
  const adapterImplementationHash=hex64(input.adapterImplementationHash,"adapterImplementationHash");
  const operationId=required(input.operationId,"operationId"),mappingId=required(input.mappingId,"mappingId");
  const canonicalRequestHash=hex64(input.canonicalRequestHash,"canonicalRequestHash");
  const capturedAt=canonicalIso(input.capturedAt,"capturedAt");
  if(!Number.isInteger(input.upstreamStatus)||input.upstreamStatus<100||input.upstreamStatus>599)throw new RangeError("upstreamStatus must be an HTTP status");
  const mediaType=required(input.mediaType,"mediaType").toLowerCase();
  const bodyEncoding=input.bodyEncoding,body=input.body;
  const bodyHash=sha256Hex(bodyBytes(bodyEncoding,body));
  const core={tenantId,adapterId,adapterVersion,adapterImplementationHash,operationId,mappingId,canonicalRequestHash,capturedAt,upstreamStatus:input.upstreamStatus,mediaType,bodyEncoding,bodyHash};
  const artifactHash=hashJson(core as any);
  return {...core,artifactId:`artifact:${artifactHash}`,body,artifactHash};
}

export function verifyEvidenceArtifact(scope:TenantScope,artifact:EvidenceArtifact):VerifiedEvidenceArtifact {
  const tenantId=checkedTenant(scope);
  if(artifact?.tenantId!==tenantId)throw new Error("Evidence artifact tenant mismatch");
  const expectedBodyHash=sha256Hex(bodyBytes(artifact.bodyEncoding,artifact.body));
  if(artifact.bodyHash!==expectedBodyHash)throw new Error("Evidence artifact body integrity mismatch");
  const core=artifactCore(artifact);
  const expectedArtifactHash=hashJson(core as any);
  if(artifact.artifactHash!==expectedArtifactHash||artifact.artifactId!==`artifact:${expectedArtifactHash}`){
    throw new Error("Evidence artifact integrity hash mismatch");
  }
  return structuredClone(artifact);
}

export function mapEvidenceArtifact(scope:TenantScope,artifact:VerifiedEvidenceArtifact,mapper:EvidenceMapper):TemporalFact[] {
  const tenantId=checkedTenant(scope),verified=verifyEvidenceArtifact(scope,artifact);
  validateMappingManifest(mapper?.manifest);
  if(mapper.manifest.mappingId!==verified.mappingId)throw new Error("Evidence mapping does not match artifact mappingId");
  const drafts=mapper.map(structuredClone(verified));
  if(!Array.isArray(drafts)||drafts.length===0)throw new Error("Evidence mapping must produce at least one fact");
  return drafts.map((draft:any,index)=>{
    if(!draft||typeof draft!=="object"||Array.isArray(draft))throw new TypeError("Mapped fact must be an object");
    if(Object.prototype.hasOwnProperty.call(draft,"id")||Object.prototype.hasOwnProperty.call(draft,"authentication")||Object.prototype.hasOwnProperty.call(draft,"acquisition")){
      throw new Error("Mapper cannot set fact identity, authentication, or acquisition provenance");
    }
    required(draft.entity,"fact.entity");required(draft.attribute,"fact.attribute");required(draft.source,"fact.source");
    canonicalIso(draft.validFrom,"fact.validFrom");canonicalIso(draft.observedAt,"fact.observedAt");
    if(draft.validUntil!==undefined)canonicalIso(draft.validUntil,"fact.validUntil");
    const acquisition:FactAcquisition={
      artifactId:verified.artifactId,
      artifactHash:verified.artifactHash,
      adapterId:verified.adapterId,
      adapterVersion:verified.adapterVersion,
      adapterImplementationHash:verified.adapterImplementationHash,
      operationId:verified.operationId,
      mappingId:mapper.manifest.mappingId,
      mappingVersion:mapper.manifest.version,
      mappingImplementationHash:mapper.manifest.implementationHash,
      canonicalRequestHash:verified.canonicalRequestHash,
      capturedAt:verified.capturedAt
    };
    const idHash=hashJson({
      tenantId,
      artifactHash:verified.artifactHash,
      mappingId:mapper.manifest.mappingId,
      mappingVersion:mapper.manifest.version,
      mappingImplementationHash:mapper.manifest.implementationHash,
      index,
      fact:draft
    } as any);
    return {id:`fact:${idHash}`,...structuredClone(draft),acquisition};
  });
}


export function assertAcquisitionFactProvenance(
  scope:TenantScope,
  artifact:EvidenceArtifact,
  record:AcquisitionRecord,
  fact:TemporalFact,
  index:number
):void {
  const tenantId=checkedTenant(scope),verified=verifyEvidenceArtifact(scope,artifact);
  if(!Number.isInteger(index)||index<0)throw new RangeError("fact index must be a non-negative integer");
  if(record?.tenantId!==tenantId)throw new Error("Acquisition record tenant does not match fact provenance");
  const a=fact?.acquisition;
  if(!a)throw new Error("Acquisition fact is missing acquisition provenance");
  const matches=
    a.artifactId===verified.artifactId&&
    a.artifactHash===verified.artifactHash&&
    a.adapterId===verified.adapterId&&
    a.adapterVersion===verified.adapterVersion&&
    a.adapterImplementationHash===verified.adapterImplementationHash&&
    a.operationId===verified.operationId&&
    a.mappingId===record.mappingId&&
    a.mappingVersion===record.mappingVersion&&
    a.mappingImplementationHash===record.mappingImplementationHash&&
    a.canonicalRequestHash===verified.canonicalRequestHash&&
    a.capturedAt===verified.capturedAt;
  if(!matches)throw new Error("Acquisition fact provenance does not match artifact and acquisition record");
  if(record.factIds[index]!==fact.id)throw new Error("Acquisition fact identity does not match acquisition record order");
  const {id:_,authentication:__,acquisition:___,...draft}=fact;
  const expectedId=`fact:${hashJson({
    tenantId,
    artifactHash:verified.artifactHash,
    mappingId:record.mappingId,
    mappingVersion:record.mappingVersion,
    mappingImplementationHash:record.mappingImplementationHash,
    index,
    fact:draft
  } as any)}`;
  if(fact.id!==expectedId)throw new Error("Acquisition fact identity does not match deterministic mapping commitment");
}
