import type { SecretResolver } from "./evidence.ts";
import { captureBoundedJsonResponse, EvidenceAdapterError, validateEvidenceHttpsOrigin, type EvidenceFetch } from "./http_evidence_adapter.ts";
import { ModelAdapterError } from "./model_adapter.ts";

const FORBIDDEN_FIXED_HEADERS=new Set(["authorization","proxy-authorization","cookie","host","content-length","transfer-encoding","connection"]);
const FORBIDDEN_SECRET_HEADERS=new Set(["host","content-length","transfer-encoding","connection"]);

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function fixedPath(value:unknown):string {
  const path=required(value,"provider path");
  if(!path.startsWith("/")||path.startsWith("//"))throw new TypeError("provider path must be an absolute path");
  const parsed=new URL(path,"https://axiom.invalid");
  if(parsed.origin!=="https://axiom.invalid"||parsed.pathname!==path||parsed.search||parsed.hash){
    throw new TypeError("provider path must not contain origin, query, or fragment");
  }
  return path;
}
function fixedHeaders(input:Record<string,string>|undefined):Record<string,string>{
  const out:Record<string,string>={};
  for(const [rawName,rawValue] of Object.entries(input??{})){
    const name=required(rawName,"header name").toLowerCase(),value=required(rawValue,"header value");
    if(FORBIDDEN_FIXED_HEADERS.has(name))throw new TypeError(`Sensitive or transport header must not be fixed in model provider configuration: ${name}`);
    out[name]=value;
  }
  return out;
}
export interface ModelProviderSecretHeader {
  secretRef:string;
  prefix?:string;
}
function secretHeaders(input:Record<string,ModelProviderSecretHeader>|undefined):Record<string,ModelProviderSecretHeader>{
  const out:Record<string,ModelProviderSecretHeader>={};
  for(const [rawName,config] of Object.entries(input??{})){
    const name=required(rawName,"secret header name").toLowerCase();
    if(FORBIDDEN_SECRET_HEADERS.has(name))throw new TypeError(`Unsafe model provider secret header: ${name}`);
    out[name]={secretRef:required(config?.secretRef,"secretRef"),...(config?.prefix!==undefined?{prefix:String(config.prefix)}:{})};
  }
  return out;
}
function translate(error:unknown):never {
  if(error instanceof ModelAdapterError)throw error;
  if(error instanceof EvidenceAdapterError)throw new ModelAdapterError(error.code.replace(/^UPSTREAM_/,"MODEL_UPSTREAM_"),error.message,error.httpStatus);
  throw error;
}

export class BoundedModelProviderTransport {
  private readonly origin:URL;
  private readonly path:string;
  private readonly timeoutMs:number;
  private readonly maxResponseBytes:number;
  private readonly allowedStatus:number[];
  private readonly headers:Record<string,string>;
  private readonly secretHeaderConfig:Record<string,ModelProviderSecretHeader>;
  private readonly secretResolver:SecretResolver;
  private readonly fetchFn:EvidenceFetch;

  constructor(config:{
    origin:string;
    path:string;
    timeoutMs:number;
    maxResponseBytes:number;
    allowedStatus?:number[];
    fixedHeaders?:Record<string,string>;
    secretHeaders?:Record<string,ModelProviderSecretHeader>;
    secretResolver:SecretResolver;
    fetchFn?:EvidenceFetch;
  }){
    this.origin=validateEvidenceHttpsOrigin(config.origin);
    this.path=fixedPath(config.path);
    if(!Number.isInteger(config.timeoutMs)||config.timeoutMs<=0)throw new TypeError("timeoutMs must be a positive integer");
    if(!Number.isInteger(config.maxResponseBytes)||config.maxResponseBytes<=0)throw new TypeError("maxResponseBytes must be a positive integer");
    const statuses=config.allowedStatus??[200];
    if(!Array.isArray(statuses)||statuses.length===0||statuses.some(x=>!Number.isInteger(x)||x<200||x>299))throw new TypeError("allowedStatus must contain successful HTTP status codes");
    if(!config.secretResolver||typeof config.secretResolver.resolve!=="function")throw new TypeError("secretResolver is required");
    this.timeoutMs=config.timeoutMs;this.maxResponseBytes=config.maxResponseBytes;this.allowedStatus=[...new Set(statuses)].sort((a,b)=>a-b);
    this.headers=fixedHeaders(config.fixedHeaders);this.secretHeaderConfig=secretHeaders(config.secretHeaders);
    this.secretResolver=config.secretResolver;this.fetchFn=config.fetchFn??fetch;
  }

  async postJson(bodyInput:string,maxResponseBytes?:number):Promise<string>{
    const body=required(bodyInput,"provider request body");
    try{JSON.parse(body);}catch{throw new TypeError("provider request body must be valid JSON");}
    const headers:Record<string,string>={...this.headers,accept:"application/json","content-type":"application/json"};
    const secrets:string[]=[];
    for(const [name,config] of Object.entries(this.secretHeaderConfig)){
      const raw=await this.secretResolver.resolve(config.secretRef);
      if(typeof raw!=="string"||!raw)throw new Error("Resolved model provider secret must be a non-empty string");
      const formatted=`${config.prefix??""}${raw}`;
      headers[name]=formatted;
      secrets.push(raw);
      if(formatted!==raw)secrets.push(formatted);
    }
    for(const secret of secrets){
      if(secret&&body.includes(secret))throw new ModelAdapterError("MODEL_SECRET_IN_REQUEST","Sanitized model request contains secret material",500);
    }
    const url=new URL(this.path,this.origin);
    if(url.origin!==this.origin.origin)throw new Error("Model provider path escaped configured origin");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    let response:Response;
    try{
      response=await this.fetchFn(url,{method:"POST",headers,body,redirect:"manual",signal:controller.signal});
    }catch{
      if(controller.signal.aborted)throw new ModelAdapterError("MODEL_UPSTREAM_TIMEOUT","Model provider request timed out",504);
      throw new ModelAdapterError("MODEL_UPSTREAM_NETWORK","Model provider request failed",502);
    }finally{clearTimeout(timer);}
    try{
      const cap=Number.isInteger(maxResponseBytes)&&Number(maxResponseBytes)>0
        ?Math.min(this.maxResponseBytes,Number(maxResponseBytes)):this.maxResponseBytes;
      const captured=await captureBoundedJsonResponse({
        response,allowedStatus:this.allowedStatus,allowedMediaTypes:["application/json"],maxResponseBytes:cap,secrets
      });
      return captured.body;
    }catch(error){translate(error);}
  }
}
