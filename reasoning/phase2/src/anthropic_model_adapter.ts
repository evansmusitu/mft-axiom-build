import { canonicalize } from "../../phase1/src/canonical.ts";
import type { SecretResolver } from "./evidence.ts";
import type { EvidenceFetch } from "./http_evidence_adapter.ts";
import type { ModelAdapterManifest } from "./types.ts";
import {
  canonicalModelAdapterRequestBody, ModelAdapterError,
  type CapturedModelExchange, type ModelAdapter, type ModelAdapterInput
} from "./model_adapter.ts";
import {
  modelProviderExplanationWireSchema, modelProviderProposalWireSchema,
  normalizeModelProviderExplanationWire, normalizeModelProviderProposalWire
} from "./model_provider_codec.ts";
import type { CapturedModelExplanationExchange, ModelExplanationAdapterInput } from "./model_explanation.ts";
import { BoundedModelProviderTransport } from "./model_provider_transport.ts";

const HEX64=/^[0-9a-f]{64}$/;
function required(value:unknown,label:string):string{
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function checkedManifest(input:ModelAdapterManifest):ModelAdapterManifest{
  const out={
    adapterId:required(input?.adapterId,"adapterId"),version:required(input?.version,"adapter version"),
    implementationHash:required(input?.implementationHash,"adapter implementationHash"),
    provider:required(input?.provider,"provider"),modelId:required(input?.modelId,"modelId")
  };
  if(!HEX64.test(out.implementationHash))throw new TypeError("adapter implementationHash must be a lowercase SHA-256 hex digest");
  if(out.provider!=="anthropic")throw new TypeError("Anthropic adapter manifest provider must be anthropic");
  return out;
}
function positiveInteger(value:unknown,label:string):number{
  if(!Number.isInteger(value)||Number(value)<=0)throw new TypeError(`${label} must be a positive integer`);
  return Number(value);
}
function canonicalIso(value:unknown):string{
  const text=required(value,"capturedAt"),ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new TypeError("capturedAt must use canonical ISO-8601 UTC format");
  return text;
}
function outputText(raw:string,expectedModel:string):string{
  let response:any;
  try{response=JSON.parse(raw);}catch{throw new ModelAdapterError("MODEL_UPSTREAM_INVALID_JSON","Anthropic response is not valid JSON",502);}
  if(!response||typeof response!=="object"||Array.isArray(response)||response.type!=="message"||response.role!=="assistant"){
    throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","Anthropic response is not an assistant message",502);
  }
  if(response.model!==expectedModel)throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","Anthropic response model does not match configured model",502);
  if(response.stop_reason!=="end_turn")throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","Anthropic response is incomplete or stopped unexpectedly",502);
  if(!Array.isArray(response.content)||response.content.length!==1||response.content[0]?.type!=="text"||typeof response.content[0]?.text!=="string"||!response.content[0].text.trim()){
    throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","Anthropic response must contain exactly one text content block",502);
  }
  return response.content[0].text;
}

export class AnthropicMessagesModelAdapter implements ModelAdapter {
  readonly manifest:ModelAdapterManifest;
  private readonly maxTokens:number;
  private readonly transport:BoundedModelProviderTransport;

  constructor(config:{
    manifest:ModelAdapterManifest;
    apiKeySecretRef:string;
    anthropicVersion:string;
    maxTokens:number;
    timeoutMs:number;
    maxResponseBytes:number;
    secretResolver:SecretResolver;
    fetchFn?:EvidenceFetch;
    origin?:string;
  }){
    this.manifest=checkedManifest(config.manifest);
    const apiKeySecretRef=required(config.apiKeySecretRef,"apiKeySecretRef");
    const anthropicVersion=required(config.anthropicVersion,"anthropicVersion");
    this.maxTokens=positiveInteger(config.maxTokens,"maxTokens");
    this.transport=new BoundedModelProviderTransport({
      origin:config.origin??"https://api.anthropic.com",
      path:"/v1/messages",
      timeoutMs:config.timeoutMs,
      maxResponseBytes:config.maxResponseBytes,
      allowedStatus:[200],
      fixedHeaders:{"anthropic-version":anthropicVersion},
      secretHeaders:{"x-api-key":{secretRef:apiKeySecretRef}},
      secretResolver:config.secretResolver,
      fetchFn:config.fetchFn
    });
  }

  async explain(input:ModelExplanationAdapterInput):Promise<CapturedModelExplanationExchange>{
    const capturedAt=canonicalIso(input?.capturedAt);
    const promptBody=required(input?.promptBody,"promptBody");
    if(!Number.isInteger(input?.maxResponseBytes)||input.maxResponseBytes<=0)throw new TypeError("maxResponseBytes must be a positive integer");
    const requestBody=canonicalize({
      max_tokens:this.maxTokens,
      messages:[{role:"user",content:promptBody}],
      model:this.manifest.modelId,
      output_config:{format:{type:"json_schema",schema:modelProviderExplanationWireSchema()}}
    } as any);
    const responseBody=await this.transport.postJson(requestBody,input.maxResponseBytes);
    const normalizedResponseBody=normalizeModelProviderExplanationWire(outputText(responseBody,this.manifest.modelId));
    return {capturedAt,requestBody,responseBody,normalizedResponseBody};
  }

  async invoke(input:ModelAdapterInput):Promise<CapturedModelExchange>{
    const capturedAt=canonicalIso(input?.capturedAt);
    const gatewayBody=canonicalModelAdapterRequestBody(input,this.manifest);
    const requestBody=canonicalize({
      max_tokens:this.maxTokens,
      messages:[{role:"user",content:gatewayBody}],
      model:this.manifest.modelId,
      output_config:{format:{type:"json_schema",schema:modelProviderProposalWireSchema(input.profile)}}
    } as any);
    const responseBody=await this.transport.postJson(requestBody,input.profile.maxModelResponseBytes);
    const normalizedResponseBody=normalizeModelProviderProposalWire(outputText(responseBody,this.manifest.modelId));
    return {capturedAt,requestBody,responseBody,normalizedResponseBody};
  }
}
