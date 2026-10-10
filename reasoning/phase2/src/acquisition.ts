import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { canonicalize, hashJson } from "../../phase1/src/canonical.ts";
import type { EvidenceRepository, VerifiedFactCommit } from "./repositories.ts";
import type { AuthenticatedFactIngestor } from "./ingestion.ts";
import {
  createEvidenceArtifact, mapEvidenceArtifact, verifyEvidenceArtifact,
  type AdapterRegistry
} from "./evidence.ts";
import type {
  AcquisitionRecord, AuthorizedTenantContext, EvidenceAcquisitionRequest, EvidenceAcquisitionResult,
  SignedFactEnvelope, TemporalFact
} from "./types.ts";

const HEX64=/^[0-9a-f]{64}$/;

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function digest(value:unknown,label:string):string {
  const text=required(value,label);
  if(!HEX64.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return text;
}
function canonicalIso(value:unknown,label:string):string {
  const text=required(value,label),ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new TypeError(`${label} must use canonical ISO-8601 UTC format`);
  return text;
}
function privateEd25519(input:any):KeyObject {
  const raw=input?.privateKey??input;
  const key:KeyObject=raw instanceof Object&&raw.type==="private"&&typeof raw.export==="function"
    ?raw as KeyObject
    :createPrivateKey(raw);
  if(key.type!=="private"||key.asymmetricKeyType!=="ed25519")throw new TypeError("adapter attestation key must be an Ed25519 private key");
  return key;
}

export interface AdapterAttestor {
  readonly keyId:string;
  attest(input:{tenantId:string;issuedAt:string;nonce:string;fact:TemporalFact}):SignedFactEnvelope;
}

export function createAdapterAttestor(keyId:string,signerOrPrivateKey:any):AdapterAttestor {
  const id=required(keyId,"adapter attestation keyId");
  const privateKey=privateEd25519(signerOrPrivateKey);
  return {
    keyId:id,
    attest(input){
      const base={
        tenantId:required(input.tenantId,"tenantId"),
        keyId:id,
        issuedAt:canonicalIso(input.issuedAt,"issuedAt"),
        nonce:required(input.nonce,"nonce"),
        fact:structuredClone(input.fact)
      };
      const signature=sign(null,Buffer.from(canonicalize(base as any)),privateKey).toString("base64");
      return {...base,signature};
    }
  };
}

function assertAuthorizedContext(context:AuthorizedTenantContext):void {
  if(!context||context.authorization?.status!=="ALLOW")throw new Error("Evidence acquisition requires an authorized context");
  if(context.authorization.action!=="evidence:acquire"||context.authorization.resource?.kind!=="evidence"||context.authorization.resource.id!==undefined){
    throw new Error("Authorized context is not valid for evidence:acquire");
  }
  if(
    context.authorization.requestedTenantId!==context.tenant?.tenantId||
    context.authorization.principalId!==context.principal?.principalId
  )throw new Error("Evidence acquisition authorization context mismatch");
}

function capturedBytes(encoding:"utf8"|"base64",body:string):number {
  if(typeof body!=="string")throw new TypeError("Captured evidence body must be a string");
  if(encoding==="utf8")return Buffer.byteLength(body,"utf8");
  const decoded=Buffer.from(body,"base64");
  if(decoded.toString("base64")!==body)throw new TypeError("Captured evidence base64 body must use canonical encoding");
  return decoded.byteLength;
}

export class EvidenceAcquisitionService {
  private readonly registry:AdapterRegistry;
  private readonly repository:EvidenceRepository;
  private readonly ingestor:Pick<AuthenticatedFactIngestor,"authenticate">;
  private readonly attestor:AdapterAttestor;

  constructor(deps:{
    registry:AdapterRegistry;
    repository:EvidenceRepository;
    ingestor:Pick<AuthenticatedFactIngestor,"authenticate">;
    attestor:AdapterAttestor;
  }){
    this.registry=deps.registry;
    this.repository=deps.repository;
    this.ingestor=deps.ingestor;
    this.attestor=deps.attestor;
  }

  async acquire(
    context:AuthorizedTenantContext,
    request:EvidenceAcquisitionRequest,
    now:string,
    canonicalRequestHash:string
  ):Promise<EvidenceAcquisitionResult> {
    assertAuthorizedContext(context);
    const capturedAt=canonicalIso(now,"now");
    const requestHash=digest(canonicalRequestHash,"canonicalRequestHash");
    if(!request||typeof request!=="object"||Array.isArray(request))throw new TypeError("Evidence acquisition request must be an object");
    if(!request.parameters||typeof request.parameters!=="object"||Array.isArray(request.parameters))throw new TypeError("Evidence acquisition parameters must be an object");

    const resolved=this.registry.resolve(
      context.tenant,
      required(request.adapterId,"adapterId"),
      required(request.operationId,"operationId"),
      required(request.mappingId,"mappingId")
    );

    const adapterInput={
      tenant:structuredClone(context.tenant),
      operation:structuredClone(resolved.operation),
      parameters:structuredClone(request.parameters)
    };
    resolved.adapter.validateParameters(adapterInput);
    const captured=await resolved.adapter.acquire(adapterInput);
    if(!captured||typeof captured!=="object")throw new Error("Evidence adapter returned invalid captured evidence");
    const encoding=captured.bodyEncoding??"utf8";
    const size=capturedBytes(encoding,captured.body);
    if(size>resolved.operation.maxResponseBytes)throw new RangeError("Captured evidence exceeds configured response size");
    const mediaType=required(captured.mediaType,"captured mediaType").toLowerCase();
    if(!resolved.operation.responseMediaTypes.map(x=>x.toLowerCase()).includes(mediaType)){
      throw new Error("Captured evidence media type is not allowed for operation");
    }

    const manifest=resolved.adapter.manifest;
    const artifact=createEvidenceArtifact({
      tenantId:context.tenant.tenantId,
      adapterId:manifest.adapterId,
      adapterVersion:manifest.version,
      adapterImplementationHash:manifest.implementationHash,
      operationId:resolved.operation.operationId,
      mappingId:resolved.mapper.manifest.mappingId,
      canonicalRequestHash:requestHash,
      capturedAt,
      upstreamStatus:captured.status,
      mediaType,
      bodyEncoding:encoding,
      body:captured.body
    });
    const verifiedArtifact=verifyEvidenceArtifact(context.tenant,artifact);
    const mapped=mapEvidenceArtifact(context.tenant,verifiedArtifact,resolved.mapper);

    const acquisitionHash=hashJson({
      tenantId:context.tenant.tenantId,
      canonicalRequestHash:requestHash,
      adapterId:manifest.adapterId,
      adapterVersion:manifest.version,
      adapterImplementationHash:manifest.implementationHash,
      operationId:resolved.operation.operationId,
      mappingId:resolved.mapper.manifest.mappingId,
      mappingVersion:resolved.mapper.manifest.version,
      mappingImplementationHash:resolved.mapper.manifest.implementationHash,
      artifactHash:artifact.artifactHash,
      capturedAt
    } as any);
    const acquisitionId=`acquisition:${acquisitionHash}`;

    const verifiedFacts:VerifiedFactCommit[]=[];
    for(let index=0;index<mapped.length;index++){
      const fact=mapped[index];
      const nonce=`adapter:${hashJson({acquisitionId,factId:fact.id,index} as any)}`;
      const envelope=this.attestor.attest({
        tenantId:context.tenant.tenantId,
        issuedAt:capturedAt,
        nonce,
        fact
      });
      verifiedFacts.push(await this.ingestor.authenticate(envelope,capturedAt));
    }

    const core:Omit<AcquisitionRecord,"recordHash">={
      acquisitionId,
      tenantId:context.tenant.tenantId,
      principalId:context.principal.principalId,
      authorizationDecisionHash:digest(context.authorization.decisionHash,"authorizationDecisionHash"),
      adapterId:manifest.adapterId,
      adapterVersion:manifest.version,
      adapterImplementationHash:manifest.implementationHash,
      operationId:resolved.operation.operationId,
      mappingId:resolved.mapper.manifest.mappingId,
      mappingVersion:resolved.mapper.manifest.version,
      mappingImplementationHash:resolved.mapper.manifest.implementationHash,
      canonicalRequestHash:requestHash,
      artifactId:artifact.artifactId,
      artifactHash:artifact.artifactHash,
      factIds:verifiedFacts.map(x=>x.fact.id),
      capturedAt,
      status:"COMMITTED"
    };
    const record:AcquisitionRecord={...core,recordHash:hashJson(core as any)};
    await this.repository.commitAcquisition(context.tenant,artifact,record,verifiedFacts);

    return {
      status:"COMMITTED",
      acquisitionId,
      artifactId:artifact.artifactId,
      artifactHash:artifact.artifactHash,
      factIds:[...record.factIds]
    };
  }
}
