import type { SecretResolver } from "./evidence.ts";
import {
  captureBoundedJsonResponse, EvidenceAdapterError, validateEvidenceHttpsOrigin, type EvidenceFetch
} from "./http_evidence_adapter.ts";

const HEX64=/^[0-9a-f]{64}$/;
const FORBIDDEN_FIXED_HEADERS=new Set([
  "authorization","proxy-authorization","cookie","host","content-length","transfer-encoding","connection"
]);
const FORBIDDEN_SECRET_HEADERS=new Set(["host","content-length","transfer-encoding","connection"]);

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function digest(value:unknown,label:string):string {
  const text=required(value,label);
  if(!HEX64.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return text;
}
function fixedPath(value:unknown):string {
  const path=required(value,"signer path");
  if(!path.startsWith("/")||path.startsWith("//"))throw new TypeError("signer path must be an absolute path");
  const parsed=new URL(path,"https://axiom.invalid");
  if(parsed.origin!=="https://axiom.invalid"||parsed.pathname!==path||parsed.search||parsed.hash){
    throw new TypeError("signer path must not contain origin, query, or fragment");
  }
  return path;
}
function canonicalBase64(value:unknown,label:string):{text:string;bytes:Buffer} {
  const text=required(value,label);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(text)||text.length%4!==0)throw new TypeError(`${label} must use canonical Base64`);
  const bytes=Buffer.from(text,"base64");
  if(bytes.toString("base64")!==text)throw new TypeError(`${label} must use canonical Base64`);
  return {text,bytes};
}
function fixedHeaders(input:Record<string,string>|undefined):Record<string,string> {
  const out:Record<string,string>={};
  for(const [rawName,rawValue] of Object.entries(input??{})){
    const name=required(rawName,"header name").toLowerCase(),value=required(rawValue,"header value");
    if(FORBIDDEN_FIXED_HEADERS.has(name))throw new TypeError(`Sensitive or transport header must not be fixed in signer configuration: ${name}`);
    out[name]=value;
  }
  return out;
}
export interface SignerSecretHeader {
  secretRef:string;
  prefix?:string;
}
function secretHeaders(input:Record<string,SignerSecretHeader>|undefined):Record<string,SignerSecretHeader> {
  const out:Record<string,SignerSecretHeader>={};
  for(const [rawName,config] of Object.entries(input??{})){
    const name=required(rawName,"secret header name").toLowerCase();
    if(FORBIDDEN_SECRET_HEADERS.has(name))throw new TypeError(`Unsafe signer secret header: ${name}`);
    out[name]={secretRef:required(config?.secretRef,"secretRef"),...(config?.prefix!==undefined?{prefix:String(config.prefix)}:{})};
  }
  return out;
}
function positiveInteger(value:unknown,label:string):number {
  if(!Number.isInteger(value)||Number(value)<=0)throw new TypeError(`${label} must be a positive integer`);
  return Number(value);
}

export interface ExternalEd25519SignRequest {
  protocolVersion:"axiom.sign/v1";
  keyId:string;
  algorithm:"Ed25519";
  signingIntentId:string;
  payloadHash:string;
  payloadBase64:string;
}
export interface ExternalEd25519SignResponse {
  protocolVersion:"axiom.sign/v1";
  keyId:string;
  algorithm:"Ed25519";
  signingIntentId:string;
  payloadHash:string;
  signatureBase64:string;
}
export interface ExternalEd25519SigningBackend {
  sign(request:ExternalEd25519SignRequest):Promise<ExternalEd25519SignResponse>;
}

function checkedRequest(input:ExternalEd25519SignRequest):ExternalEd25519SignRequest {
  if(input?.protocolVersion!=="axiom.sign/v1")throw new TypeError("signing protocolVersion must be axiom.sign/v1");
  const keyId=required(input.keyId,"signing keyId");
  if(input.algorithm!=="Ed25519")throw new TypeError("signing algorithm must be Ed25519");
  const signingIntentId=digest(input.signingIntentId,"signingIntentId");
  const payloadHash=digest(input.payloadHash,"payloadHash");
  const payload=canonicalBase64(input.payloadBase64,"payloadBase64");
  if(payload.bytes.length===0)throw new TypeError("payloadBase64 must not be empty");
  return {protocolVersion:"axiom.sign/v1",keyId,algorithm:"Ed25519",signingIntentId,payloadHash,payloadBase64:payload.text};
}
function checkedResponse(value:unknown,request:ExternalEd25519SignRequest):ExternalEd25519SignResponse {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("Signer response schema must be an object");
  const object=value as Record<string,unknown>;
  const expected=["algorithm","keyId","payloadHash","protocolVersion","signatureBase64","signingIntentId"];
  const actual=Object.keys(object).sort();
  if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index])){
    throw new TypeError("Signer response schema contains unknown or missing fields");
  }
  if(object.protocolVersion!==request.protocolVersion)throw new Error("Signer response protocolVersion mismatch");
  if(object.keyId!==request.keyId)throw new Error("Signer response keyId mismatch");
  if(object.algorithm!==request.algorithm)throw new Error("Signer response algorithm mismatch");
  if(object.signingIntentId!==request.signingIntentId)throw new Error("Signer response signingIntentId mismatch");
  if(object.payloadHash!==request.payloadHash)throw new Error("Signer response payloadHash mismatch");
  const signature=canonicalBase64(object.signatureBase64,"signatureBase64");
  if(signature.bytes.length!==64)throw new TypeError("Signer response requires a 64-byte Ed25519 signature");
  return {
    protocolVersion:"axiom.sign/v1",
    keyId:request.keyId,
    algorithm:"Ed25519",
    signingIntentId:request.signingIntentId,
    payloadHash:request.payloadHash,
    signatureBase64:signature.text
  };
}

export class HttpEd25519SigningBackend implements ExternalEd25519SigningBackend {
  private readonly origin:URL;
  private readonly path:string;
  private readonly timeoutMs:number;
  private readonly maxRequestBytes:number;
  private readonly maxResponseBytes:number;
  private readonly headers:Record<string,string>;
  private readonly secretHeaderConfig:Record<string,SignerSecretHeader>;
  private readonly secretResolver:SecretResolver;
  private readonly fetchFn:EvidenceFetch;

  constructor(config:{
    origin:string;
    path:string;
    timeoutMs:number;
    maxRequestBytes:number;
    maxResponseBytes:number;
    fixedHeaders?:Record<string,string>;
    secretHeaders?:Record<string,SignerSecretHeader>;
    secretResolver:SecretResolver;
    fetchFn?:EvidenceFetch;
  }){
    this.origin=validateEvidenceHttpsOrigin(config.origin);
    this.path=fixedPath(config.path);
    this.timeoutMs=positiveInteger(config.timeoutMs,"timeoutMs");
    this.maxRequestBytes=positiveInteger(config.maxRequestBytes,"maxRequestBytes");
    this.maxResponseBytes=positiveInteger(config.maxResponseBytes,"maxResponseBytes");
    if(!config.secretResolver||typeof config.secretResolver.resolve!=="function")throw new TypeError("secretResolver is required");
    this.headers=fixedHeaders(config.fixedHeaders);
    this.secretHeaderConfig=secretHeaders(config.secretHeaders);
    this.secretResolver=config.secretResolver;
    this.fetchFn=config.fetchFn??fetch;
  }

  async sign(input:ExternalEd25519SignRequest):Promise<ExternalEd25519SignResponse> {
    const request=checkedRequest(input);
    const body=JSON.stringify(request);
    if(Buffer.byteLength(body,"utf8")>this.maxRequestBytes)throw new RangeError("Signer request exceeds configured byte limit");

    const headers:Record<string,string>={...this.headers,accept:"application/json","content-type":"application/json"};
    const secrets:string[]=[];
    for(const [name,config] of Object.entries(this.secretHeaderConfig)){
      const raw=await this.secretResolver.resolve(config.secretRef);
      if(typeof raw!=="string"||!raw)throw new Error("Resolved signer secret must be a non-empty string");
      const formatted=`${config.prefix??""}${raw}`;
      headers[name]=formatted;
      secrets.push(raw);
      if(formatted!==raw)secrets.push(formatted);
    }
    for(const secret of secrets){
      if(secret&&body.includes(secret))throw new Error("Signer request contains secret material");
    }

    const url=new URL(this.path,this.origin);
    if(url.origin!==this.origin.origin)throw new Error("Signer path escaped configured origin");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    let response:Response;
    try{
      response=await this.fetchFn(url,{method:"POST",headers,body,redirect:"manual",signal:controller.signal});
    }catch{
      if(controller.signal.aborted)throw new Error("Signer upstream request timed out");
      throw new Error("Signer upstream network request failed");
    }finally{
      clearTimeout(timer);
    }

    let captured;
    try{
      captured=await captureBoundedJsonResponse({
        response,
        allowedStatus:[200],
        allowedMediaTypes:["application/json"],
        maxResponseBytes:this.maxResponseBytes,
        secrets
      });
    }catch(error){
      if(error instanceof EvidenceAdapterError)throw new Error(`Signer upstream rejected: ${error.message}`);
      throw error;
    }
    return checkedResponse(JSON.parse(captured.body),request);
  }
}
