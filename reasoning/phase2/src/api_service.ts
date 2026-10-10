import { createHash } from "node:crypto";
import { hashJson } from "../../phase1/src/canonical.ts";
import { createAuthorizedTenantContext, type DeterministicAuthorizer } from "./authorization.ts";
import type { CallerAuthenticator } from "./authentication.ts";
import { EvidenceAdapterError } from "./http_evidence_adapter.ts";
import { ModelAdapterError } from "./model_adapter.ts";
import { ModelExecutionError } from "./model_execution_service.ts";
import { ModelExplanationError } from "./model_explanation.ts";
import type { AuditRepository, DistributedExecutionRepository, ExecutionRepository, IdempotencyRepository } from "./repositories.ts";
import type {
  ApiAction, ApiResource, AuthorizationDecision, AuthorizedTenantContext, ControlPlaneResult,
  EvidenceAcquisitionRequest, EvidenceAcquisitionResult, ExecutionRequest,
  DistributedExecutionJob, IdempotencyClaimInput, ModelCompileRequest, ModelCompileResult, ModelDispatchResult, ModelExecuteRequest, ModelExplainRequest, ModelExplainResult, ReplayResult,
  SignedFactEnvelope, StoredApiOutcome, TemporalFact, TenantScope
} from "./types.ts";

export interface ApiServiceRequest {
  requestId:string;
  method:"GET"|"POST";
  routeTemplate:string;
  requestedTenantId:string;
  action:ApiAction;
  resource:ApiResource;
  bearerToken:string;
  idempotencyKey?:string;
  body:unknown;
  now:string;
}

export interface ApiResponse {
  statusCode:number;
  bodyJson:string;
  headers:Record<string,string>;
}

export interface TenantRuntime {
  modelCompiler:{
    compile(context:AuthorizedTenantContext,request:ModelCompileRequest,compilationRequestHash:string):Promise<ModelCompileResult>;
  };
  modelExecutor:{
    execute(context:AuthorizedTenantContext,compilationId:string,timing:ModelExecuteRequest):Promise<ControlPlaneResult>;
  };
  modelDispatcher:{
    dispatch(context:AuthorizedTenantContext,compilationId:string,timing:ModelExecuteRequest,requestHash:string,now:string):Promise<ModelDispatchResult>;
  };
  executionJobs:Pick<DistributedExecutionRepository,"get">;
  modelExplainer:{
    explain(context:AuthorizedTenantContext,executionId:string,request:ModelExplainRequest,requestHash:string):Promise<ModelExplainResult>;
  };
  acquisitions:{
    acquire(
      context:AuthorizedTenantContext,
      request:EvidenceAcquisitionRequest,
      now:string,
      canonicalRequestHash:string
    ):Promise<EvidenceAcquisitionResult>;
  };
  ingestor:{ingest(envelope:SignedFactEnvelope,now:string):Promise<TemporalFact>};
  executions:ExecutionRepository;
  plane:{
    execute(request:ExecutionRequest):Promise<ControlPlaneResult>;
    replayStored(recordId:string):Promise<ReplayResult>;
  };
}

export interface TenantRuntimeFactory {
  create(scope:TenantScope):TenantRuntime;
}

const MUTATIONS=new Set<ApiAction>(["fact:ingest","execution:create","evidence:acquire","model:compile","model:execute","model:dispatch","model:explain"]);

function requiredString(value:unknown):value is string {
  return typeof value==="string"&&Boolean(value.trim());
}

function jsonResponse(statusCode:number,payload:unknown,headers:Record<string,string>={}):ApiResponse {
  return {
    statusCode,
    bodyJson:JSON.stringify(payload),
    headers:{"Content-Type":"application/json",...headers}
  };
}

function errorResponse(statusCode:number,code:string,message:string,requestId:string,headers:Record<string,string>={}):ApiResponse {
  return jsonResponse(statusCode,{error:{code,message,requestId}},headers);
}

function requestHashOf(request:ApiServiceRequest):string {
  return hashJson({
    method:request.method,
    routeTemplate:request.routeTemplate,
    requestedTenantId:request.requestedTenantId,
    action:request.action,
    resource:request.resource,
    body:request.body===undefined?null:request.body
  } as any);
}

function hashSecret(value:string):string {
  return createHash("sha256").update(value,"utf8").digest("hex");
}

function bodyShapeError(request:ApiServiceRequest):string|undefined {
  if(!requiredString(request.requestId))return "requestId is required";
  if(!requiredString(request.requestedTenantId))return "tenantId is required";
  if(request.action==="fact:ingest"){
    if(!request.body||typeof request.body!=="object"||Array.isArray(request.body))return "fact ingestion body must be a JSON object";
  }
  if(request.action==="execution:create"){
    if(!request.body||typeof request.body!=="object"||Array.isArray(request.body))return "execution body must be a JSON object";
    const program=(request.body as any).program;
    if(!program||typeof program!=="object"||Array.isArray(program))return "execution program must be a JSON object";
  }
  if(request.action==="evidence:acquire"){
    if(!request.body||typeof request.body!=="object"||Array.isArray(request.body))return "evidence acquisition body must be a JSON object";
    const body=request.body as any;
    if(!requiredString(body.adapterId))return "adapterId is required";
    if(!requiredString(body.operationId))return "operationId is required";
    if(!requiredString(body.mappingId))return "mappingId is required";
    if(!body.parameters||typeof body.parameters!=="object"||Array.isArray(body.parameters))return "parameters must be a JSON object";
  }
  if(request.action==="model:compile"){
    if(!request.body||typeof request.body!=="object"||Array.isArray(request.body))return "model compilation body must be a JSON object";
    const body=request.body as any;
    if(!requiredString(body.profileId))return "profileId is required";
    if(!requiredString(body.objective))return "objective is required";
    if(!Array.isArray(body.inputContracts)||body.inputContracts.length===0)return "inputContracts must be a non-empty array";
  }
  if(request.action==="model:execute"||request.action==="model:dispatch"){
    if(!request.body||typeof request.body!=="object"||Array.isArray(request.body))return request.action==="model:dispatch"?"model dispatch body must be a JSON object":"model execution body must be a JSON object";
    const body=request.body as any;
    if(!requiredString(body.asOf))return "asOf is required";
    if(!requiredString(body.issuedAt))return "issuedAt is required";
    if(request.action==="model:dispatch"){
      const keys=Object.keys(body).sort();
      if(keys.length!==2||keys[0]!=="asOf"||keys[1]!=="issuedAt")return "model dispatch body must contain only asOf and issuedAt";
    }
  }
  if(request.action==="model:explain"){
    if(!request.body||typeof request.body!=="object"||Array.isArray(request.body))return "model explanation body must be a JSON object";
    const body=request.body as any,keys=Object.keys(body);
    if(keys.length!==1||keys[0]!=="profileId"||!requiredString(body.profileId))return "model explanation body must contain only profileId";
  }
  return undefined;
}

function domainErrorResponse(action:ApiAction,error:unknown,requestId:string):ApiResponse {
  const message=error instanceof Error?error.message:String(error);
  if(action==="model:compile"){
    if(error instanceof ModelAdapterError){
      if(error.httpStatus===413)return errorResponse(413,"MODEL_PROVIDER_TOO_LARGE","Model provider response exceeds configured limit",requestId);
      if(error.httpStatus===415)return errorResponse(415,"MODEL_PROVIDER_MEDIA_TYPE","Model provider response media type is not supported",requestId);
      if(error.httpStatus===504)return errorResponse(504,"MODEL_PROVIDER_TIMEOUT","Model provider request timed out",requestId);
      return errorResponse(502,"MODEL_PROVIDER_FAILURE","Model provider request failed",requestId);
    }
    if(/profile is not eligible for tenant/i.test(message)){
      return errorResponse(403,"MODEL_PROFILE_FORBIDDEN","Model compiler profile is not available for this tenant",requestId);
    }
    if(error instanceof TypeError||error instanceof RangeError||/unknown model compiler profile|unknown allowed operation/i.test(message)){
      return errorResponse(400,"INVALID_REQUEST","Invalid model compilation request",requestId);
    }
    return errorResponse(500,"INTERNAL_ERROR","Internal server error",requestId);
  }
  if(action==="model:execute"||action==="model:dispatch"){
    if(error instanceof ModelExecutionError){
      if(error.code==="COMPILATION_STALE")return errorResponse(409,"COMPILATION_STALE","Stored model compilation is stale",requestId);
      if(error.code==="COMPILATION_REJECTED")return errorResponse(422,"COMPILATION_REJECTED",action==="model:dispatch"?"Rejected model compilation cannot be dispatched":"Rejected model compilation cannot execute",requestId);
    }
    if(/not found for tenant/i.test(message))return errorResponse(404,"NOT_FOUND","Resource not found",requestId);
    if(error instanceof TypeError||error instanceof RangeError)return errorResponse(400,"INVALID_REQUEST",action==="model:dispatch"?"Invalid model dispatch request":"Invalid model execution request",requestId);
    return errorResponse(500,"INTERNAL_ERROR","Internal server error",requestId);
  }
  if(action==="execution:job:read"){
    if(/not found for tenant/i.test(message))return errorResponse(404,"NOT_FOUND","Resource not found",requestId);
    return errorResponse(500,"INTERNAL_ERROR","Internal server error",requestId);
  }
  if(action==="model:explain"){
    if(error instanceof ModelExplanationError){
      if(error.httpStatus===403)return errorResponse(403,"MODEL_EXPLANATION_PROFILE_FORBIDDEN","Model explanation profile is not available for this tenant",requestId);
      if(error.httpStatus===404)return errorResponse(404,"NOT_FOUND","Resource not found",requestId);
      if(error.httpStatus===422)return errorResponse(422,"MODEL_EXPLANATION_PROOF_REJECTED","Stored execution proof could not be verified",requestId);
      if(error.httpStatus===413)return errorResponse(413,"MODEL_EXPLANATION_PROVIDER_TOO_LARGE","Model explanation provider response exceeds configured limit",requestId);
      if(error.httpStatus===415)return errorResponse(415,"MODEL_EXPLANATION_PROVIDER_MEDIA_TYPE","Model explanation provider response media type is not supported",requestId);
      if(error.httpStatus===504)return errorResponse(504,"MODEL_EXPLANATION_PROVIDER_TIMEOUT","Model explanation provider request timed out",requestId);
      if(error.httpStatus===502)return errorResponse(502,"MODEL_EXPLANATION_PROVIDER_FAILURE","Model explanation provider request failed",requestId);
    }
    if(error instanceof TypeError||error instanceof RangeError)return errorResponse(400,"INVALID_REQUEST","Invalid model explanation request",requestId);
    return errorResponse(500,"INTERNAL_ERROR","Internal server error",requestId);
  }
  if(action==="evidence:acquire"){
    if(error instanceof EvidenceAdapterError){
      if(error.httpStatus===413)return errorResponse(413,"UPSTREAM_TOO_LARGE","Upstream evidence exceeds configured limit",requestId);
      if(error.httpStatus===415)return errorResponse(415,"UPSTREAM_MEDIA_TYPE","Upstream evidence media type is not supported",requestId);
      if(error.httpStatus===504)return errorResponse(504,"UPSTREAM_TIMEOUT","Upstream evidence request timed out",requestId);
      return errorResponse(502,"UPSTREAM_FAILURE","Upstream evidence request failed",requestId);
    }
    if(/adapter is not eligible for tenant/i.test(message)){
      return errorResponse(403,"ADAPTER_FORBIDDEN","Evidence adapter is not available for this tenant",requestId);
    }
    if(error instanceof TypeError||error instanceof RangeError){
      return errorResponse(400,"INVALID_REQUEST","Invalid evidence acquisition request",requestId);
    }
    if(/unknown adapter|unknown.*operation|unknown mapping|mapping is not allowed/i.test(message)){
      return errorResponse(400,"INVALID_REQUEST","Invalid evidence acquisition request",requestId);
    }
    if(/mapping|attest|ingestion|trusted.*key|signature|authentication evidence|provenance/i.test(message)){
      return errorResponse(422,"EVIDENCE_REJECTED","External evidence could not be accepted",requestId);
    }
    return errorResponse(500,"INTERNAL_ERROR","Internal server error",requestId);
  }
  if(/not found for tenant/i.test(message))return errorResponse(404,"NOT_FOUND","Resource not found",requestId);
  if(action==="fact:ingest"&&/(ingestion|trusted.*key|signature|nonce|stale|future|canonical|authentication evidence)/i.test(message)){
    return errorResponse(422,"SOURCE_ENVELOPE_REJECTED","Signed fact envelope rejected",requestId);
  }
  if(/reserved AXIOM platform-context assumption namespace/i.test(message)){
    return errorResponse(400,"INVALID_REQUEST","Invalid execution request",requestId);
  }
  if(error instanceof TypeError||error instanceof RangeError){
    return errorResponse(400,"INVALID_REQUEST","Invalid request",requestId);
  }
  return errorResponse(500,"INTERNAL_ERROR","Internal server error",requestId);
}
function outcomeFor(action:ApiAction,response:ApiResponse,payload?:unknown):string {
  if(action==="model:compile"){
    if(response.statusCode===201)return "MODEL_COMPILATION_VALIDATED";
    if(response.statusCode===422&&payload&&typeof payload==="object"&&(payload as any).status==="REJECTED")return "MODEL_COMPILATION_REJECTED";
    if(response.statusCode===400)return "BAD_REQUEST";
    if(response.statusCode===403)return "MODEL_PROFILE_FORBIDDEN";
    if(response.statusCode===409)return "IDEMPOTENCY_REJECTED";
    if(response.statusCode===413||response.statusCode===415||response.statusCode===502||response.statusCode===504){
      return "MODEL_UPSTREAM_FAILED";
    }
    return "INTERNAL_ERROR";
  }
  if(action==="model:execute"){
    if(response.statusCode===200){
      if(payload&&typeof payload==="object"&&(payload as any).status==="DENIED")return "MODEL_EXECUTION_DENIED";
      return "MODEL_EXECUTION_COMPLETED";
    }
    if(response.statusCode===409)return "MODEL_COMPILATION_STALE";
    if(response.statusCode===422)return "MODEL_COMPILATION_REJECTED";
    if(response.statusCode===400)return "BAD_REQUEST";
    if(response.statusCode===404)return "NOT_FOUND";
    return "INTERNAL_ERROR";
  }
  if(action==="model:dispatch"){
    if(response.statusCode===202)return "MODEL_EXECUTION_JOB_QUEUED";
    if(response.statusCode===400)return "BAD_REQUEST";
    if(response.statusCode===404)return "NOT_FOUND";
    if(response.statusCode===409)return "MODEL_COMPILATION_STALE";
    if(response.statusCode===422)return "MODEL_COMPILATION_REJECTED";
    return "INTERNAL_ERROR";
  }
  if(action==="execution:job:read"){
    if(response.statusCode===200)return "SUCCESS";
    if(response.statusCode===404)return "NOT_FOUND";
    return "INTERNAL_ERROR";
  }
  if(action==="model:explain"){
    if(response.statusCode===201)return "MODEL_EXPLANATION_CREATED";
    if(response.statusCode===400)return "BAD_REQUEST";
    if(response.statusCode===403)return "MODEL_EXPLANATION_PROFILE_FORBIDDEN";
    if(response.statusCode===404)return "NOT_FOUND";
    if(response.statusCode===409)return "IDEMPOTENCY_REJECTED";
    if(response.statusCode===422)return "MODEL_EXPLANATION_PROOF_REJECTED";
    if(response.statusCode===413||response.statusCode===415||response.statusCode===502||response.statusCode===504)return "MODEL_EXPLANATION_UPSTREAM_FAILED";
    return "INTERNAL_ERROR";
  }
  if(action==="evidence:acquire"){
    if(response.statusCode===201)return "ACQUISITION_COMMITTED";
    if(response.statusCode===400)return "BAD_REQUEST";
    if(response.statusCode===403)return "ACQUISITION_FAILED";
    if(response.statusCode===409)return "IDEMPOTENCY_REJECTED";
    if(response.statusCode===413||response.statusCode===415||response.statusCode===422||response.statusCode===502||response.statusCode===504){
      return "ACQUISITION_FAILED";
    }
    return "INTERNAL_ERROR";
  }
  if(response.statusCode===201)return "SUCCESS";
  if(response.statusCode===200){
    if(payload&&typeof payload==="object"&&(payload as any).status==="DENIED")return "DOMAIN_DENIED";
    if(payload&&typeof payload==="object"&&(payload as any).status==="MISMATCH")return "REPLAY_MISMATCH";
    return "SUCCESS";
  }
  if(response.statusCode===400)return "BAD_REQUEST";
  if(response.statusCode===401)return "AUTHENTICATION_DENIED";
  if(response.statusCode===403)return "AUTHORIZATION_DENIED";
  if(response.statusCode===404)return "NOT_FOUND";
  if(response.statusCode===409)return "IDEMPOTENCY_REJECTED";
  if(response.statusCode===422)return "SOURCE_REJECTED";
  return "INTERNAL_ERROR";
}

function publicJobStatus(job:DistributedExecutionJob){
  const out:any={
    jobId:job.intent.jobId,
    status:job.state.status,
    snapshotId:job.intent.snapshotId,
    attemptCount:job.state.attemptCount,
    createdAt:job.intent.createdAt
  };
  if(job.state.terminalAt!==undefined)out.terminalAt=job.state.terminalAt;
  if(job.state.result!==undefined)out.result=structuredClone(job.state.result);
  if(job.state.failureCode!==undefined)out.failureCode=job.state.failureCode;
  return out;
}

export class AxiomApiService {
  private readonly authenticator:CallerAuthenticator;
  private readonly authorizer:Pick<DeterministicAuthorizer,"authorize">;
  private readonly idempotency:IdempotencyRepository;
  private readonly audit:AuditRepository;
  private readonly runtimes:TenantRuntimeFactory;

  constructor(deps:{
    authenticator:CallerAuthenticator;
    authorizer:Pick<DeterministicAuthorizer,"authorize">;
    idempotency:IdempotencyRepository;
    audit:AuditRepository;
    runtimes:TenantRuntimeFactory;
  }){
    this.authenticator=deps.authenticator;
    this.authorizer=deps.authorizer;
    this.idempotency=deps.idempotency;
    this.audit=deps.audit;
    this.runtimes=deps.runtimes;
  }

  async handle(request:ApiServiceRequest):Promise<ApiResponse> {
    let requestHash:string;
    try{requestHash=requestHashOf(request);}
    catch{return errorResponse(400,"INVALID_REQUEST","Invalid request",request.requestId||"unknown");}

    const auditBase={
      requestedTenantId:request.requestedTenantId,
      requestId:request.requestId,
      action:request.action,
      resource:structuredClone(request.resource),
      requestHash,
      timestamp:request.now
    };

    let authenticated:any;
    try{
      authenticated=await this.authenticator.authenticate(request.bearerToken,request.now);
    }catch{
      const response=errorResponse(401,"UNAUTHENTICATED","Authentication required",request.requestId,{"WWW-Authenticate":"Bearer"});
      await this.audit.append({...auditBase,outcome:"AUTHENTICATION_DENIED"});
      return response;
    }

    let authorization:AuthorizationDecision;
    try{
      authorization=await this.authorizer.authorize(authenticated,{
        requestedTenantId:request.requestedTenantId,
        action:request.action,
        resource:request.resource
      });
    }catch{
      const response=errorResponse(500,"INTERNAL_ERROR","Internal server error",request.requestId);
      await this.audit.append({
        ...auditBase,
        principalId:authenticated.principal.principalId,
        credentialTokenHash:authenticated.credential.tokenHash,
        outcome:"INTERNAL_ERROR"
      });
      return response;
    }

    const authorizedAuditBase={
      ...auditBase,
      principalId:authenticated.principal.principalId,
      credentialTokenHash:authenticated.credential.tokenHash,
      authorizationDecisionHash:authorization.decisionHash
    };

    if(authorization.status!=="ALLOW"){
      const response=errorResponse(403,"FORBIDDEN","Not authorized for this tenant action",request.requestId);
      await this.audit.append({...authorizedAuditBase,outcome:"AUTHORIZATION_DENIED"});
      return response;
    }

    const shapeError=bodyShapeError(request);
    if(shapeError){
      const response=errorResponse(400,"INVALID_REQUEST",shapeError,request.requestId);
      await this.audit.append({...authorizedAuditBase,outcome:"BAD_REQUEST"});
      return response;
    }

    let tenantContext;
    try{
      tenantContext=createAuthorizedTenantContext(authenticated,{
        requestedTenantId:request.requestedTenantId,
        action:request.action,
        resource:request.resource
      },authorization);
    }catch{
      const response=errorResponse(500,"INTERNAL_ERROR","Internal server error",request.requestId);
      await this.audit.append({...authorizedAuditBase,outcome:"INTERNAL_ERROR"});
      return response;
    }

    const mutation=MUTATIONS.has(request.action);
    let claimInput:IdempotencyClaimInput|undefined;
    let idempotencyKeyHash:string|undefined;
    if(mutation){
      if(!requiredString(request.idempotencyKey)){
        const response=errorResponse(400,"IDEMPOTENCY_KEY_REQUIRED","Idempotency-Key is required",request.requestId);
        await this.audit.append({...authorizedAuditBase,outcome:"BAD_REQUEST"});
        return response;
      }
      idempotencyKeyHash=hashSecret(request.idempotencyKey);
      claimInput={
        principalId:authenticated.principal.principalId,
        tenantId:tenantContext.tenant.tenantId,
        action:request.action,
        idempotencyKeyHash,
        requestHash,
        createdAt:request.now
      };
      let claim;
      try{claim=await this.idempotency.claim(claimInput);}
      catch{
        const response=errorResponse(500,"INTERNAL_ERROR","Internal server error",request.requestId);
        await this.audit.append({...authorizedAuditBase,idempotencyKeyHash,outcome:"INTERNAL_ERROR"});
        return response;
      }
      if(claim.status==="REPLAY"){
        await this.audit.append({...authorizedAuditBase,idempotencyKeyHash,outcome:"IDEMPOTENCY_REPLAY"});
        return {
          statusCode:claim.outcome.statusCode,
          bodyJson:claim.outcome.bodyJson,
          headers:{"Content-Type":claim.outcome.contentType}
        };
      }
      if(claim.status==="CONFLICT"||claim.status==="IN_PROGRESS"){
        const response=errorResponse(409,claim.status==="CONFLICT"?"IDEMPOTENCY_CONFLICT":"REQUEST_IN_PROGRESS",
          claim.status==="CONFLICT"?"Idempotency key conflicts with another request":"Request with this idempotency key is still in progress",
          request.requestId);
        await this.audit.append({...authorizedAuditBase,idempotencyKeyHash,outcome:"IDEMPOTENCY_REJECTED"});
        return response;
      }
    }

    let response:ApiResponse;
    let payload:unknown;
    try{
      const runtime=this.runtimes.create(tenantContext.tenant);
      if(request.action==="fact:ingest"){
        payload={status:"ACCEPTED",fact:await runtime.ingestor.ingest(request.body as SignedFactEnvelope,request.now)};
        response=jsonResponse(201,payload);
      }else if(request.action==="evidence:acquire"){
        payload=await runtime.acquisitions.acquire(
          tenantContext,
          request.body as EvidenceAcquisitionRequest,
          request.now,
          requestHash
        );
        response=jsonResponse(201,payload);
      }else if(request.action==="execution:create"){
        payload=await runtime.plane.execute(request.body as ExecutionRequest);
        response=jsonResponse(200,payload);
      }else if(request.action==="model:compile"){
        payload=await runtime.modelCompiler.compile(
          tenantContext,
          request.body as ModelCompileRequest,
          requestHash
        );
        response=jsonResponse((payload as ModelCompileResult).status==="VALIDATED"?201:422,payload);
      }else if(request.action==="model:execute"){
        payload=await runtime.modelExecutor.execute(
          tenantContext,
          request.resource.id!,
          request.body as ModelExecuteRequest
        );
        response=jsonResponse(200,payload);
      }else if(request.action==="model:dispatch"){
        payload=await runtime.modelDispatcher.dispatch(
          tenantContext,
          request.resource.id!,
          request.body as ModelExecuteRequest,
          requestHash,
          request.now
        );
        response=jsonResponse(202,payload);
      }else if(request.action==="model:explain"){
        payload=await runtime.modelExplainer.explain(
          tenantContext,
          request.resource.id!,
          request.body as ModelExplainRequest,
          requestHash
        );
        response=jsonResponse(201,payload);
      }else if(request.action==="execution:read"){
        payload=await runtime.executions.get(tenantContext.tenant,request.resource.id!);
        response=jsonResponse(200,payload);
      }else if(request.action==="execution:job:read"){
        const job=await runtime.executionJobs.get(tenantContext.tenant,request.resource.id!);
        payload=publicJobStatus(job);
        response=jsonResponse(200,payload);
      }else{
        payload=await runtime.plane.replayStored(request.resource.id!);
        if((payload as ReplayResult).status==="MISMATCH"&&(payload as ReplayResult).diagnostics.some(x=>/not found for tenant/i.test(x))){
          response=errorResponse(404,"NOT_FOUND","Resource not found",request.requestId);
        }else response=jsonResponse(200,payload);
      }
    }catch(error){
      response=domainErrorResponse(request.action,error,request.requestId);
      payload=undefined;
    }

    const auditOutcome=outcomeFor(request.action,response,payload);
    try{
      await this.audit.append({...authorizedAuditBase,...(idempotencyKeyHash?{idempotencyKeyHash}:{}),outcome:auditOutcome});
    }catch{
      return errorResponse(500,"INTERNAL_ERROR","Internal server error",request.requestId);
    }

    if(claimInput&&response.statusCode<500){
      const stored:StoredApiOutcome={
        statusCode:response.statusCode,
        bodyJson:response.bodyJson,
        contentType:response.headers["Content-Type"]??"application/json"
      };
      try{
        await this.idempotency.complete({...claimInput,completedAt:request.now},stored);
      }catch{
        return errorResponse(500,"INTERNAL_ERROR","Internal server error",request.requestId);
      }
    }
    return response;
  }
}
