import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { ApiResponse, ApiServiceRequest } from "./api_service.ts";
import type { ApiAction, ApiResource } from "./types.ts";

const MAX_BODY_BYTES=1024*1024;

interface RoutedRequest {
  routeTemplate:string;
  requestedTenantId:string;
  action:ApiAction;
  resource:ApiResource;
}

class HttpInputError extends Error {
  readonly statusCode:number;
  readonly code:string;
  constructor(statusCode:number,code:string,message:string){super(message);this.statusCode=statusCode;this.code=code;}
}

function decodeSegment(value:string,label:string):string {
  let decoded:string;
  try{decoded=decodeURIComponent(value);}catch{throw new HttpInputError(400,"INVALID_PATH",`Invalid ${label}`);}
  if(!decoded.trim())throw new HttpInputError(400,"INVALID_PATH",`Invalid ${label}`);
  return decoded;
}

function route(method:string,pathname:string):RoutedRequest|undefined {
  let match:RegExpMatchArray|null;
  if(method==="POST"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/executions\/([^/]+)\/explanations$/))){
    return {routeTemplate:"/v1/tenants/:tenantId/executions/:executionId/explanations",requestedTenantId:decodeSegment(match[1],"tenantId"),action:"model:explain",resource:{kind:"execution",id:decodeSegment(match[2],"executionId")}};
  }
  if(method==="POST"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/model\/compilations\/([^/]+)\/execution-jobs$/))){
    return {routeTemplate:"/v1/tenants/:tenantId/model/compilations/:compilationId/execution-jobs",requestedTenantId:decodeSegment(match[1],"tenantId"),action:"model:dispatch",resource:{kind:"model_compilation",id:decodeSegment(match[2],"compilationId")}};
  }
  if(method==="POST"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/model\/compilations\/([^/]+)\/executions$/))){
    return {routeTemplate:"/v1/tenants/:tenantId/model/compilations/:compilationId/executions",requestedTenantId:decodeSegment(match[1],"tenantId"),action:"model:execute",resource:{kind:"model_compilation",id:decodeSegment(match[2],"compilationId")}};
  }
  if(method==="POST"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/model\/compilations$/))){
    return {routeTemplate:"/v1/tenants/:tenantId/model/compilations",requestedTenantId:decodeSegment(match[1],"tenantId"),action:"model:compile",resource:{kind:"model_compilation"}};
  }
  if(method==="POST"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/evidence\/acquisitions$/))){
    return {routeTemplate:"/v1/tenants/:tenantId/evidence/acquisitions",requestedTenantId:decodeSegment(match[1],"tenantId"),action:"evidence:acquire",resource:{kind:"evidence"}};
  }
  if(method==="POST"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/facts$/))){
    return {routeTemplate:"/v1/tenants/:tenantId/facts",requestedTenantId:decodeSegment(match[1],"tenantId"),action:"fact:ingest",resource:{kind:"fact"}};
  }
  if(method==="POST"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/executions$/))){
    return {routeTemplate:"/v1/tenants/:tenantId/executions",requestedTenantId:decodeSegment(match[1],"tenantId"),action:"execution:create",resource:{kind:"execution"}};
  }
  if(method==="POST"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/executions\/([^/]+)\/replay$/))){
    return {
      routeTemplate:"/v1/tenants/:tenantId/executions/:executionId/replay",
      requestedTenantId:decodeSegment(match[1],"tenantId"),action:"execution:replay",
      resource:{kind:"execution",id:decodeSegment(match[2],"executionId")}
    };
  }
  if(method==="GET"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/execution-jobs\/([^/]+)$/))){
    return {
      routeTemplate:"/v1/tenants/:tenantId/execution-jobs/:jobId",
      requestedTenantId:decodeSegment(match[1],"tenantId"),action:"execution:job:read",
      resource:{kind:"execution_job",id:decodeSegment(match[2],"jobId")}
    };
  }
  if(method==="GET"&&(match=pathname.match(/^\/v1\/tenants\/([^/]+)\/executions\/([^/]+)$/))){
    return {
      routeTemplate:"/v1/tenants/:tenantId/executions/:executionId",
      requestedTenantId:decodeSegment(match[1],"tenantId"),action:"execution:read",
      resource:{kind:"execution",id:decodeSegment(match[2],"executionId")}
    };
  }
  return undefined;
}

function bearer(req:IncomingMessage):string {
  const raw=req.headers.authorization;
  if(typeof raw!=="string")return "";
  const match=raw.match(/^Bearer ([^\s]+)$/);
  return match?.[1]??"";
}

function headerValue(req:IncomingMessage,name:string):string|undefined {
  const value=req.headers[name.toLowerCase()];
  if(typeof value==="string"&&value.trim())return value;
  return undefined;
}

async function jsonBody(req:IncomingMessage):Promise<unknown> {
  const contentLength=Number(req.headers["content-length"]??0);
  if(Number.isFinite(contentLength)&&contentLength>MAX_BODY_BYTES){
    req.resume();
    throw new HttpInputError(413,"PAYLOAD_TOO_LARGE","Request body exceeds 1 MiB");
  }
  let total=0;
  const chunks:Buffer[]=[];
  for await(const raw of req){
    const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
    total+=chunk.length;
    if(total>MAX_BODY_BYTES)throw new HttpInputError(413,"PAYLOAD_TOO_LARGE","Request body exceeds 1 MiB");
    chunks.push(chunk);
  }
  if(total===0)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch{throw new HttpInputError(400,"INVALID_JSON","Request body must be valid JSON");}
}

function transportError(statusCode:number,code:string,message:string,requestId:string):ApiResponse {
  return {
    statusCode,
    bodyJson:JSON.stringify({error:{code,message,requestId}}),
    headers:{"Content-Type":"application/json"}
  };
}

function writeResponse(res:any,response:ApiResponse):void {
  res.statusCode=response.statusCode;
  for(const [name,value] of Object.entries(response.headers))res.setHeader(name,value);
  res.end(response.bodyJson);
}

export function createAxiomHttpServer(deps:{
  service:{handle(request:ApiServiceRequest):Promise<ApiResponse>};
  clock?:()=>string;
}):Server {
  const clock=deps.clock??(()=>new Date().toISOString());
  return createServer(async(req,res)=>{
    const requestId=randomUUID();
    try{
      const method=req.method??"";
      const url=new URL(req.url??"/","http://axiom.local");
      const matched=route(method,url.pathname);
      if(!matched){
        writeResponse(res,transportError(404,"NOT_FOUND","Route not found",requestId));
        return;
      }

      const idempotencyKey=headerValue(req,"idempotency-key");

      let body:unknown=undefined;
      if(method==="POST"){
        const contentType=(req.headers["content-type"]??"").toString().split(";",1)[0].trim().toLowerCase();
        if(contentType!=="application/json"){
          req.resume();
          writeResponse(res,transportError(415,"UNSUPPORTED_MEDIA_TYPE","POST requests require application/json",requestId));
          return;
        }
        body=await jsonBody(req);
      }

      const request:ApiServiceRequest={
        requestId,
        method:method as "GET"|"POST",
        routeTemplate:matched.routeTemplate,
        requestedTenantId:matched.requestedTenantId,
        action:matched.action,
        resource:matched.resource,
        bearerToken:bearer(req),
        idempotencyKey,
        body,
        now:clock()
      };
      writeResponse(res,await deps.service.handle(request));
    }catch(error){
      if(error instanceof HttpInputError){
        writeResponse(res,transportError(error.statusCode,error.code,error.message,requestId));
        return;
      }
      writeResponse(res,transportError(500,"INTERNAL_ERROR","Internal server error",requestId));
    }
  });
}
