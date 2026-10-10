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
function manifest(input:ModelAdapterManifest):ModelAdapterManifest{
  const out={
    adapterId:required(input?.adapterId,"adapterId"),version:required(input?.version,"adapter version"),
    implementationHash:required(input?.implementationHash,"adapter implementationHash"),
    provider:required(input?.provider,"provider"),modelId:required(input?.modelId,"modelId")
  };
  if(!HEX64.test(out.implementationHash))throw new TypeError("adapter implementationHash must be a lowercase SHA-256 hex digest");
  if(out.provider!=="openai")throw new TypeError("OpenAI adapter manifest provider must be openai");
  return out;
}
function canonicalIso(value:unknown):string{
  const text=required(value,"capturedAt"),ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new TypeError("capturedAt must use canonical ISO-8601 UTC format");
  return text;
}
function outputText(raw:string,expectedModel:string):string{
  let response:any;
  try{response=JSON.parse(raw);}catch{throw new ModelAdapterError("MODEL_UPSTREAM_INVALID_JSON","OpenAI response is not valid JSON",502);}
  if(!response||typeof response!=="object"||Array.isArray(response)||response.status!=="completed"||response.error!==null){
    throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","OpenAI response is not completed",502);
  }
  if(response.model!==expectedModel)throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","OpenAI response model does not match configured model",502);
  if(!Array.isArray(response.output))throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","OpenAI response output is invalid",502);
  const messages=response.output.filter((x:any)=>x&&typeof x==="object"&&x.type==="message"&&x.role==="assistant");
  if(messages.length!==1)throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","OpenAI response must contain exactly one assistant message",502);
  if(response.output.some((x:any)=>!x||typeof x!=="object"||(x.type!=="message"&&x.type!=="reasoning"))){
    throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","OpenAI response contains an unexpected output item",502);
  }
  const content=messages[0].content;
  if(!Array.isArray(content)||content.length!==1||content[0]?.type!=="output_text"||typeof content[0]?.text!=="string"||!content[0].text.trim()){
    throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","OpenAI assistant message must contain exactly one output_text payload",502);
  }
  return content[0].text;
}

export class OpenAiResponsesModelAdapter implements ModelAdapter {
  readonly manifest:ModelAdapterManifest;
  private readonly transport:BoundedModelProviderTransport;

  constructor(config:{
    manifest:ModelAdapterManifest;
    apiKeySecretRef:string;
    timeoutMs:number;
    maxResponseBytes:number;
    secretResolver:SecretResolver;
    fetchFn?:EvidenceFetch;
    origin?:string;
  }){
    this.manifest=manifest(config.manifest);
    const apiKeySecretRef=required(config.apiKeySecretRef,"apiKeySecretRef");
    this.transport=new BoundedModelProviderTransport({
      origin:config.origin??"https://api.openai.com",
      path:"/v1/responses",
      timeoutMs:config.timeoutMs,
      maxResponseBytes:config.maxResponseBytes,
      allowedStatus:[200],
      secretHeaders:{authorization:{secretRef:apiKeySecretRef,prefix:"Bearer "}},
      secretResolver:config.secretResolver,
      fetchFn:config.fetchFn
    });
  }

  async explain(input:ModelExplanationAdapterInput):Promise<CapturedModelExplanationExchange>{
    const capturedAt=canonicalIso(input?.capturedAt);
    const promptBody=required(input?.promptBody,"promptBody");
    if(!Number.isInteger(input?.maxResponseBytes)||input.maxResponseBytes<=0)throw new TypeError("maxResponseBytes must be a positive integer");
    const requestBody=canonicalize({
      input:[{role:"user",content:[{type:"input_text",text:promptBody}]}],
      model:this.manifest.modelId,
      store:false,
      text:{format:{
        type:"json_schema",name:"axiom_advisory_explanation_v1",strict:true,
        schema:modelProviderExplanationWireSchema()
      }}
    } as any);
    const responseBody=await this.transport.postJson(requestBody,input.maxResponseBytes);
    const normalizedResponseBody=normalizeModelProviderExplanationWire(outputText(responseBody,this.manifest.modelId));
    return {capturedAt,requestBody,responseBody,normalizedResponseBody};
  }

  async invoke(input:ModelAdapterInput):Promise<CapturedModelExchange>{
    const capturedAt=canonicalIso(input?.capturedAt);
    const gatewayBody=canonicalModelAdapterRequestBody(input,this.manifest);
    const requestBody=canonicalize({
      input:[{role:"user",content:[{type:"input_text",text:gatewayBody}]}],
      model:this.manifest.modelId,
      store:false,
      text:{format:{
        type:"json_schema",name:"axiom_model_proposal_v1",strict:true,
        schema:modelProviderProposalWireSchema(input.profile)
      }}
    } as any);
    const responseBody=await this.transport.postJson(requestBody,input.profile.maxModelResponseBytes);
    const normalizedResponseBody=normalizeModelProviderProposalWire(outputText(responseBody,this.manifest.modelId));
    return {capturedAt,requestBody,responseBody,normalizedResponseBody};
  }
}
