/**
 * Explicitly authorized live Phase-2 adapter smoke. NEVER invoked by ordinary CI.
 * Requires an operator-approved non-secret manifest and environment-scoped secrets.
 * Emits only hashes, budget totals and success flags, never provider response bodies.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
const {Pool}=pg;
import { hashJson } from "../../phase1/src/canonical.ts";
import {
  AnthropicMessagesModelAdapter, BudgetedModelProviderAdapter, FixedMcpEvidenceAdapter,
  MusituAxiomEvidenceAdapter, OpenAiResponsesModelAdapter, PostgresViewEvidenceAdapter,
  PostgresProviderSpendLedger, VersionPinnedObjectEvidenceAdapter
} from "../src/index.ts";

function required(value:unknown,name:string):string{
  if(typeof value!=="string"||!value.trim())throw new Error(name+" must be provisioned and approved");
  return value;
}
function env(name:string):string{return required(process.env[name],name);}
function h(value:string|Uint8Array):string{return createHash("sha256").update(value).digest("hex");}
function manifestOperation(operationId:string,maxResponseBytes=8192,timeoutMs=10000){
  return {
    operationId,parameterSchemaHash:h("axiom-approved-live-smoke-v1:"+operationId),
    responseMediaTypes:["application/json"],maxResponseBytes,timeoutMs,mappingIds:["smoke:json"]
  };
}
function ensureObject(value:any,label:string):Record<string,any>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(label+" must be explicitly configured");
  return value;
}
function price(value:any,label:string){
  ensureObject(value,label);
  const fields=["inputMicrosPerMillionTokens","outputMicrosPerMillionTokens",
    "cacheReadMicrosPerMillionTokens","cacheWriteMicrosPerMillionTokens"];
  for(const f of fields)if(!Number.isSafeInteger(value[f])||value[f]<0)throw new Error(label+" price "+f+" must be explicit micro-USD");
  return value;
}
function authorizedSecrets(){
  const names=[
    "AXIOM_SMOKE_OPENAI_API_KEY","AXIOM_SMOKE_ANTHROPIC_API_KEY",
    "AXIOM_SMOKE_MCP_AUTHORIZATION","AXIOM_SMOKE_PG_URI","AXIOM_SMOKE_BILLING_PG_URI",
    "AXIOM_SMOKE_COMPUTE_AUTHORIZATION"
  ];
  for(const n of names)env(n);
  return {async resolve(ref:string){
    const mapped:Record<string,string>={
      "smoke:openai":"AXIOM_SMOKE_OPENAI_API_KEY",
      "smoke:anthropic":"AXIOM_SMOKE_ANTHROPIC_API_KEY",
      "smoke:mcp":"AXIOM_SMOKE_MCP_AUTHORIZATION",
      "smoke:compute":"AXIOM_SMOKE_COMPUTE_AUTHORIZATION"
    };
    if(!mapped[ref])throw new Error("Unknown secret reference");
    return env(mapped[ref]);
  }};
}
async function main(){
  if(process.env.AXIOM_LIVE_SMOKE!=="AUTHORIZED")throw new Error("AXIOM_LIVE_SMOKE=AUTHORIZED is required; zero network calls made");
  const configPath=realpathSync(env("AXIOM_SMOKE_CONFIG_PATH"));
  const configText=readFileSync(configPath,"utf8"),c=ensureObject(JSON.parse(configText),"approved manifest");
  const tenantId=required(c.tenantId,"tenantId"),now=new Date().toISOString();
  const openai=ensureObject(c.openai,"openai"),anthropic=ensureObject(c.anthropic,"anthropic");
  const mcp=ensureObject(c.mcp,"mcp"),sql=ensureObject(c.sql,"sql");
  const object=ensureObject(c.object,"object"),compute=ensureObject(c.compute,"compute");
  const limits=ensureObject(c.budget,"budget");
  const approvedObjectReader=realpathSync(required(object.readerModule,"object.readerModule"));
  const readerBytes=readFileSync(approvedObjectReader);
  if(h(readerBytes)!==required(object.readerModuleSha256,"object.readerModuleSha256"))
    throw new Error("Approved object reader module digest mismatch");
  const secrets=authorizedSecrets(); // All secrets must exist before any network I/O.
  const maximum=limits.limitMicroUsd,reserve=limits.requestReserveMicroUsd,organizationMaximum=limits.organizationLimitMicroUsd;
  if(!Number.isSafeInteger(maximum)||!Number.isSafeInteger(reserve)||reserve<=0||reserve>maximum)
    throw new Error("Live provider budget and worst-case request reservation must be explicitly bounded");
  if(!Number.isSafeInteger(organizationMaximum)||organizationMaximum<maximum)
    throw new Error("Explicit shared vendor organization cap must cover the tenant budget");
  // Billing and evidence SQL credentials MUST be different. The billing role
  // may only access axiom_provider_spend_* tables; the evidence role is read-only.
  if(env("AXIOM_SMOKE_BILLING_PG_URI")===env("AXIOM_SMOKE_PG_URI"))
    throw new Error("Distinct billing and evidence PostgreSQL roles are required");
  const billingOptions:any={connectionString:env("AXIOM_SMOKE_BILLING_PG_URI"),
    ssl:{rejectUnauthorized:true},max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:5000};
  if(process.env.AXIOM_SMOKE_BILLING_PG_CA_PATH)
    billingOptions.ssl.ca=readFileSync(realpathSync(process.env.AXIOM_SMOKE_BILLING_PG_CA_PATH),"utf8");
  const billingPool=new Pool(billingOptions);
  const ledger=new PostgresProviderSpendLedger(billingPool);
  const results:Record<string,any>[]=[];
  const impl=(name:string)=>h(readFileSync(new URL("../src/"+name,import.meta.url)));
  const testPrompt="Explain briefly that an immutable replay result cannot guarantee future outcomes. Return only the required schema.";
  try{
    for(const [name,modelConfig] of [["openai",openai],["anthropic",anthropic]] as const){
      const adapterManifest={
        adapterId:"live-smoke:"+name,version:"1.0.0",
        implementationHash:impl(name==="openai"?"openai_model_adapter.ts":"anthropic_model_adapter.ts"),
        provider:name,modelId:required(modelConfig.modelId,name+".modelId")
      };
      await ledger.provisionOrganization(name,organizationMaximum);
      await ledger.provision({tenantId},adapterManifest.adapterId,adapterManifest.modelId,maximum,name);
      const raw=name==="openai"
        ?new OpenAiResponsesModelAdapter({manifest:adapterManifest,apiKeySecretRef:"smoke:openai",
          timeoutMs:10000,maxResponseBytes:16384,secretResolver:secrets})
        :new AnthropicMessagesModelAdapter({manifest:adapterManifest,apiKeySecretRef:"smoke:anthropic",
          anthropicVersion:required(anthropic.apiVersion,"anthropic.apiVersion"),maxTokens:256,
          timeoutMs:10000,maxResponseBytes:16384,secretResolver:secrets});
      const wrapped=new BudgetedModelProviderAdapter({
        adapter:raw,ledger,tenantId,prices:price(modelConfig.prices,name),requestReserveMicroUsd:reserve
      });
      const captured=await wrapped.explain({capturedAt:now,promptBody:testPrompt,maxResponseBytes:8192});
      const status=await ledger.status({tenantId},adapterManifest.adapterId,adapterManifest.modelId);
      results.push({service:name,status:"PASS",requestSha256:h(captured.requestBody),responseSha256:h(captured.responseBody),
        normalizedSha256:h(captured.normalizedResponseBody),chargedMicroUsd:status.chargedMicroUsd,
        reservedMicroUsd:status.reservedMicroUsd,modelId:adapterManifest.modelId});
    }
    const mcpOp=manifestOperation(required(mcp.operationId,"mcp.operationId"));
    const mcpAdapter=new FixedMcpEvidenceAdapter({
      adapterId:"live-smoke:mcp",version:"1.0.0",implementationHash:impl("fixed_mcp_evidence_adapter.ts"),
      secretResolver:secrets,
      operations:[{manifest:mcpOp,origin:required(mcp.origin,"mcp.origin"),
        toolName:required(mcp.toolName,"mcp.toolName"),
        parameterName:required(mcp.parameterName,"mcp.parameterName"),
        tenantIds:[tenantId],secretRef:"smoke:mcp"}]
    });
    const mcpParams:any={};mcpParams[mcp.parameterName]=required(mcp.parameterValue,"mcp.parameterValue");
    const mc=await mcpAdapter.acquire({tenant:{tenantId},operation:mcpOp,parameters:mcpParams} as any);
    results.push({service:"mcp",status:"PASS",responseSha256:h(mc.body),operationId:mcpOp.operationId});
    const pgOpts:any={connectionString:env("AXIOM_SMOKE_PG_URI"),ssl:{rejectUnauthorized:true},
      max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:5000};
    if(process.env.AXIOM_SMOKE_PG_CA_PATH)pgOpts.ssl.ca=readFileSync(realpathSync(process.env.AXIOM_SMOKE_PG_CA_PATH),"utf8");
    const pool=new Pool(pgOpts);
    try{
      const op=manifestOperation(required(sql.operationId,"sql.operationId"));
      const adapter=new PostgresViewEvidenceAdapter({
        adapterId:"live-smoke:sql",version:"1.0.0",implementationHash:impl("postgres_view_evidence_adapter.ts"),
        pool,operations:[{manifest:op,schemaName:required(sql.schema,"sql.schema"),viewName:required(sql.view,"sql.view"),
          tenantColumn:required(sql.tenantColumn,"sql.tenantColumn"),columns:sql.columns,
          orderColumn:required(sql.orderColumn,"sql.orderColumn"),maxRows:5}]
      });
      const result=await adapter.acquire({tenant:{tenantId},operation:op,parameters:{}} as any);
      results.push({service:"sql",status:"PASS",responseSha256:h(result.body),operationId:op.operationId});
    }finally{await pool.end();}
    const readerModule=await import(pathToFileURL(approvedObjectReader).href);
    if(typeof readerModule.createApprovedReader!=="function")throw new Error("Approved object reader must export createApprovedReader");
    const reader=await readerModule.createApprovedReader();
    const oOp=manifestOperation(required(object.operationId,"object.operationId"));
    const objectAdapter=new VersionPinnedObjectEvidenceAdapter({
      adapterId:"live-smoke:object",version:"1.0.0",implementationHash:impl("version_pinned_object_evidence_adapter.ts"),
      reader,operations:[{manifest:oOp,bucket:required(object.bucket,"object.bucket"),
        key:required(object.key,"object.key"),versionId:required(object.versionId,"object.versionId"),
        expectedSha256:required(object.expectedSha256,"object.expectedSha256"),tenantIds:[tenantId]}]
    });
    const oc=await objectAdapter.acquire({tenant:{tenantId},operation:oOp,parameters:{}} as any);
    results.push({service:"object",status:"PASS",responseSha256:h(oc.body),versionId:object.versionId});
    const cOp=manifestOperation(required(compute.operationId,"compute.operationId"));
    const computeArgs=ensureObject(compute.parameters,"compute.parameters");
    const computeAdapter=new MusituAxiomEvidenceAdapter({
      adapterId:"live-smoke:compute",version:"1.0.0",implementationHash:impl("musitu_axiom_evidence_adapter.ts"),
      computeBase:required(compute.origin,"compute.origin"),
      authSecretRef:"smoke:compute",secretResolver:secrets,operations:[cOp],
      parameterValidators:{[cOp.operationId]:(provided:any)=>{
        if(hashJson(provided)!==hashJson(computeArgs))throw new Error("Unapproved compute parameters");
      }}
    });
    const cc=await computeAdapter.acquire({tenant:{tenantId},operation:cOp,parameters:computeArgs} as any);
    results.push({service:"compute",status:"PASS",responseSha256:h(cc.body),operationId:cOp.operationId});
    const evidence={schema:"axiom.phase2.live-smoke.v1",capturedAt:now,tenantId,
      manifestSha256:h(configText),sourceHash:impl("index.ts"),results};
    const out=env("AXIOM_SMOKE_EVIDENCE_PATH");
    writeFileSync(out,JSON.stringify(evidence,null,2)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
    console.log(JSON.stringify({status:"PASS",services:results.map(x=>x.service),manifestSha256:evidence.manifestSha256,
      evidenceSha256:h(JSON.stringify(evidence)),evidencePath:out}));
  }finally{await billingPool.end();}
}
main().catch(error=>{
  // Sanitized: never echo provider responses, headers, secret-bearing URLs or exception stacks.
  const code=String(error?.code??"LIVE_SMOKE_FAILED").replace(/[^A-Z0-9_]/g,"").slice(0,80);
  console.error("AXIOM live provider smoke FAILED: "+code);
  process.exitCode=1;
});
