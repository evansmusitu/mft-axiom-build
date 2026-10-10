import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { canonicalize, hashJson } from "../../phase1/src/canonical.ts";
import type { IngestionReplayClaim, WorldStateRepository } from "./repositories.ts";
import type { SignedFactEnvelope, TemporalFact, TenantScope } from "./types.ts";

export interface IngestionKeyring {
  trustedPublicKeyPem(tenantId:string,keyId:string):string|undefined;
}
export interface VerifiedFactIngestion {
  fact:TemporalFact;
  claim:IngestionReplayClaim;
}

function publicPem(key:string|KeyObject):string {
  const publicKey=typeof key==="string"?createPublicKey(key):(key.type==="public"?key:createPublicKey(key));
  if(publicKey.asymmetricKeyType!=="ed25519")throw new TypeError("ingestion trust keys must be Ed25519 public keys");
  return publicKey.export({type:"spki",format:"pem"}).toString();
}
export function createIngestionKeyring(keys:Record<string,Record<string,string|KeyObject>>):IngestionKeyring {
  const trusted=new Map<string,Map<string,string>>();
  for(const [tenantId,tenantKeys] of Object.entries(keys)){
    if(!tenantId.trim())throw new TypeError("ingestion tenantId is required");
    const byKey=new Map<string,string>();
    for(const [keyId,key] of Object.entries(tenantKeys)){
      if(!keyId.trim())throw new TypeError("ingestion keyId is required");
      byKey.set(keyId,publicPem(key));
    }
    trusted.set(tenantId,byKey);
  }
  return {trustedPublicKeyPem:(tenantId,keyId)=>trusted.get(tenantId)?.get(keyId)};
}

function canonicalIso(value:string,label:string):string {
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  const iso=new Date(ms).toISOString();
  if(value!==iso)throw new TypeError(`${label} must use canonical ISO-8601 UTC format`);
  return iso;
}
function checkedTenant(scope:TenantScope):TenantScope {
  if(!scope?.tenantId?.trim())throw new TypeError("tenantId is required");
  return {tenantId:scope.tenantId};
}
function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function sha(value:unknown,label:string):string {
  const text=required(value,label);
  if(!/^[0-9a-f]{64}$/.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return text;
}
function requireCanonicalPersistedFact(fact:TemporalFact):void {
  canonicalIso(fact.validFrom,"fact.validFrom");
  canonicalIso(fact.observedAt,"fact.observedAt");
  if(fact.validUntil!==undefined)canonicalIso(fact.validUntil,"fact.validUntil");
  if(fact.supersedes!==undefined){
    if(fact.supersedes.some(id=>typeof id!=="string"||!id.trim()))throw new TypeError("fact.supersedes entries must be non-empty strings");
    const canonical=[...new Set(fact.supersedes)].sort();
    if(canonical.length!==fact.supersedes.length||canonical.some((id,index)=>id!==fact.supersedes![index])){
      throw new TypeError("fact.supersedes must use unique lexicographically sorted canonical form");
    }
  }
  if(fact.acquisition!==undefined){
    const a=fact.acquisition;
    required(a.artifactId,"fact.acquisition.artifactId");sha(a.artifactHash,"fact.acquisition.artifactHash");
    required(a.adapterId,"fact.acquisition.adapterId");required(a.adapterVersion,"fact.acquisition.adapterVersion");
    sha(a.adapterImplementationHash,"fact.acquisition.adapterImplementationHash");
    required(a.operationId,"fact.acquisition.operationId");required(a.mappingId,"fact.acquisition.mappingId");
    required(a.mappingVersion,"fact.acquisition.mappingVersion");sha(a.mappingImplementationHash,"fact.acquisition.mappingImplementationHash");
    sha(a.canonicalRequestHash,"fact.acquisition.canonicalRequestHash");canonicalIso(a.capturedAt,"fact.acquisition.capturedAt");
  }
}
function envelopePayload(envelope:SignedFactEnvelope){
  return {
    tenantId:envelope.tenantId,
    keyId:envelope.keyId,
    issuedAt:envelope.issuedAt,
    nonce:envelope.nonce,
    fact:envelope.fact
  };
}

export class AuthenticatedFactIngestor {
  private readonly tenant:TenantScope;
  private readonly world:WorldStateRepository;
  private readonly keyring:IngestionKeyring;
  private readonly maxEnvelopeAgeMs:number;
  private readonly maxFutureSkewMs:number;

  constructor(deps:{
    tenant:TenantScope;
    world:WorldStateRepository;
    keyring:IngestionKeyring;
    maxEnvelopeAgeMs:number;
    maxFutureSkewMs:number;
  }){
    this.tenant=checkedTenant(deps.tenant);
    if(!Number.isFinite(deps.maxEnvelopeAgeMs)||deps.maxEnvelopeAgeMs<0)throw new RangeError("maxEnvelopeAgeMs must be non-negative");
    if(!Number.isFinite(deps.maxFutureSkewMs)||deps.maxFutureSkewMs<0)throw new RangeError("maxFutureSkewMs must be non-negative");
    this.world=deps.world;this.keyring=deps.keyring;
    this.maxEnvelopeAgeMs=deps.maxEnvelopeAgeMs;this.maxFutureSkewMs=deps.maxFutureSkewMs;
  }

  async authenticate(envelope:SignedFactEnvelope,now:string):Promise<VerifiedFactIngestion> {
    if(envelope.tenantId!==this.tenant.tenantId)throw new Error("Ingestion envelope tenant mismatch");
    if(!envelope.keyId?.trim())throw new TypeError("Ingestion keyId is required");
    if(!envelope.nonce?.trim())throw new TypeError("Ingestion nonce is required");
    if(!envelope.signature?.trim())throw new TypeError("Ingestion signature is required");
    if(Object.prototype.hasOwnProperty.call(envelope.fact,"authentication"))throw new Error("Unsigned fact payload must not contain authentication evidence");
    requireCanonicalPersistedFact(envelope.fact);

    const nowIso=canonicalIso(now,"now");
    const issuedAt=canonicalIso(envelope.issuedAt,"issuedAt");
    const nowMs=Date.parse(nowIso),issuedMs=Date.parse(issuedAt);
    if(issuedMs>nowMs+this.maxFutureSkewMs)throw new Error("Ingestion envelope is from the future");
    if(nowMs-issuedMs>this.maxEnvelopeAgeMs)throw new Error("Ingestion envelope is stale: age exceeds configured maximum");

    const trusted=this.keyring.trustedPublicKeyPem(this.tenant.tenantId,envelope.keyId);
    if(!trusted)throw new Error(`Unknown trusted ingestion key: ${envelope.keyId}`);

    const payload=envelopePayload(envelope);
    let signatureOk=false;
    try{
      signatureOk=verify(
        null,
        Buffer.from(canonicalize(payload as any)),
        createPublicKey(trusted),
        Buffer.from(envelope.signature,"base64")
      );
    }catch{signatureOk=false;}
    if(!signatureOk)throw new Error("Ingestion signature verification failed");

    const authenticated:TemporalFact=structuredClone(envelope.fact);
    authenticated.authentication={
      keyId:envelope.keyId,
      issuedAt,
      nonce:envelope.nonce,
      envelopeHash:hashJson(payload as any),
      signature:envelope.signature
    };
    return {fact:authenticated,claim:{keyId:envelope.keyId,nonce:envelope.nonce,issuedAt}};
  }

  async ingest(envelope:SignedFactEnvelope,now:string):Promise<TemporalFact> {
    const verified=await this.authenticate(envelope,now);
    const persisted=await this.world.putAuthenticatedFact(this.tenant,verified.fact,verified.claim);
    if(!persisted)throw new Error("Ingestion nonce replay: nonce already used");
    return verified.fact;
  }
}
