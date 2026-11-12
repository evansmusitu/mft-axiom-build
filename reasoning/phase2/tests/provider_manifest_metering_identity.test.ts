import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiResponsesModelAdapter } from "../src/openai_model_adapter.ts";
import { AnthropicMessagesModelAdapter } from "../src/anthropic_model_adapter.ts";
import {
  requireMeteredProviderAdapter,requireProtectedPaidProviderAdapter
} from "../src/provider_budget.ts";

// Admission gate tests are fully offline: no ledger, provider credential,
// HTTP request or production resource is invoked.
const baseManifest={
  adapterId:"test:paid-manifest-identity",version:"1.0.0",
  implementationHash:"d".repeat(64),modelId:"synthetic-model"
};
function neverFetch():Promise<Response>{
  throw new Error("Network use forbidden in manifest admission test");
}
const common={
  apiKeySecretRef:"synthetic:ref",timeoutMs:1000,maxResponseBytes:4096,
  secretResolver:{async resolve(){return "synthetic-only";}},
  fetchFn:neverFetch
};
test("OpenAI paid provider identity remains registered as paid after JavaScript mutation attempts",()=>{
  const adapter=new OpenAiResponsesModelAdapter({
    ...common,manifest:{...baseManifest,provider:"openai"},maxOutputTokens:256
  });
  const mutable=adapter as unknown as Record<string,any>;
  const manifest=adapter.manifest as unknown as Record<string,any>;
  try{manifest.provider="fixture";}catch{}
  try{mutable.manifest={...manifest,provider:"fixture"};}catch{}
  try{Object.defineProperty(adapter,"manifest",{
    value:{...manifest,provider:"fixture"},configurable:true,writable:true
  });}catch{}
  assert.equal(adapter.manifest.provider,"openai");
  assert.throws(()=>requireMeteredProviderAdapter(adapter),
    (e:any)=>e?.code==="BUDGET_ENFORCEMENT_REQUIRED",
    "An unmetered OpenAI adapter must never evade registration by relabeling itself");
  assert.throws(()=>requireProtectedPaidProviderAdapter(adapter),
    (e:any)=>e?.code==="BUDGET_ENFORCEMENT_REQUIRED");
});

test("Anthropic paid provider identity remains registered as paid after JavaScript mutation attempts",()=>{
  const adapter=new AnthropicMessagesModelAdapter({
    ...common,manifest:{...baseManifest,provider:"anthropic"},
    anthropicVersion:"2023-06-01",maxTokens:256
  });
  const mutable=adapter as unknown as Record<string,any>;
  const manifest=adapter.manifest as unknown as Record<string,any>;
  try{manifest.provider="fixture";}catch{}
  try{mutable.manifest={...manifest,provider:"fixture"};}catch{}
  try{Object.defineProperty(adapter,"manifest",{
    value:{...manifest,provider:"fixture"},configurable:true,writable:true
  });}catch{}
  assert.equal(adapter.manifest.provider,"anthropic");
  assert.throws(()=>requireMeteredProviderAdapter(adapter),
    (e:any)=>e?.code==="BUDGET_ENFORCEMENT_REQUIRED",
    "An unmetered Anthropic adapter must never evade registration by relabeling itself");
  assert.throws(()=>requireProtectedPaidProviderAdapter(adapter),
    (e:any)=>e?.code==="BUDGET_ENFORCEMENT_REQUIRED");
});
