import test from "node:test";
import assert from "node:assert/strict";
import { BoundedModelProviderTransport } from "../src/model_provider_transport.ts";
import { HttpStructuredModelAdapter } from "../src/model_adapter.ts";
import { HttpJsonEvidenceAdapter } from "../src/http_evidence_adapter.ts";
import { HttpEd25519SigningBackend } from "../src/signer_backend.ts";
import { modelProfileHash } from "../src/model_compiler.ts";

const H="a".repeat(64),secretResolver={resolve:async()=>"fixture-only"};
function delayedBody(body:string){
  let signal:AbortSignal|undefined,cancelled=false,timer:any;
  return {
    get signal(){return signal;},get cancelled(){return cancelled;},
    fetchFn:async(_url:any,init:any)=>{
      signal=init.signal;
      // This fixture deliberately does not implement fetch abort. The reader
      // boundary must terminate independently after headers have arrived.
      return new Response(new ReadableStream({
        start(controller){timer=setTimeout(()=>{controller.enqueue(new TextEncoder().encode(body));controller.close();},80);},
        cancel(){cancelled=true;clearTimeout(timer);}
      }),{headers:{"content-type":"application/json"}});
    }
  };
}
const profile={profileId:"p",version:"1",adapterId:"m",allowedOperationIds:["logic.not"],maxRepairAttempts:0,maxInputs:1,maxNodes:1,maxConstraints:0,maxAssumptions:0,maxObjectiveBytes:100,maxModelResponseBytes:4096};
const manifest={adapterId:"m",version:"1",implementationHash:H,provider:"fixture",modelId:"fixture"};
const input:any={tenant:{tenantId:"t"},profile,profileHash:modelProfileHash(profile),compilationRequestHash:H,attempt:0,mode:"INITIAL",objective:"Bounded test",inputContracts:[{inputName:"flag",type:{kind:"boolean"},entity:"fixture",attribute:"flag",requirementId:"flag",maxAgeMs:1000}],operationRegistryManifest:[{id:"logic.not",version:"1",implementationHash:H,moduleHash:H}],remainingRepairAttempts:0,capturedAt:"2026-10-29T12:00:00.000Z"};

test("provider transport deadline remains active through delayed response body",async()=>{
  const fixture=delayedBody('{}');
  const transport=new BoundedModelProviderTransport({origin:"https://fixture.example",path:"/run",timeoutMs:10,maxResponseBytes:4096,secretResolver,fetchFn:fixture.fetchFn});
  await assert.rejects(()=>transport.postJson('{}'),/timed out/i);
  assert.equal(fixture.signal?.aborted,true);assert.equal(fixture.cancelled,true);
});

test("structured-model deadline remains active through delayed response body",async()=>{
  const fixture=delayedBody('{"proposal":{}}');
  const adapter=new HttpStructuredModelAdapter({manifest,origin:"https://fixture.example",compilePath:"/run",timeoutMs:10,maxResponseBytes:4096,allowedStatus:[200],secretResolver,fetchFn:fixture.fetchFn});
  await assert.rejects(()=>adapter.invoke(input),/timed out/i);
  assert.equal(fixture.signal?.aborted,true);assert.equal(fixture.cancelled,true);
});

test("evidence deadline remains active through delayed response body",async()=>{
  const fixture=delayedBody('{}');
  const operation={operationId:"read",parameterSchemaHash:H,responseMediaTypes:["application/json"],maxResponseBytes:4096,timeoutMs:10,mappingIds:["fixture"]};
  const adapter=new HttpJsonEvidenceAdapter({adapterId:"e",version:"1",implementationHash:H,operations:[{manifest:operation,origin:"https://fixture.example",method:"GET",pathTemplate:"/read",allowedStatus:[200],validateParameters:()=>{}}],secretResolver,fetchFn:fixture.fetchFn});
  await assert.rejects(()=>adapter.acquire({tenant:{tenantId:"t"},operation,parameters:{}}),/timed out/i);
  assert.equal(fixture.signal?.aborted,true);assert.equal(fixture.cancelled,true);
});

test("signer deadline remains active through delayed response body",async()=>{
  const request:any={protocolVersion:"axiom.sign/v1",keyId:"fixture",algorithm:"Ed25519",signingIntentId:H,payloadHash:H,payloadBase64:Buffer.from('{}').toString('base64')};
  // The accepted reply schema does not echo the raw payload.
  const body:any=JSON.parse(JSON.stringify({...request,signatureBase64:Buffer.alloc(64,1).toString('base64')}));delete body.payloadBase64;
  const validFixture=delayedBody(JSON.stringify(body));
  const backend=new HttpEd25519SigningBackend({origin:"https://fixture.example",path:"/sign",timeoutMs:10,maxRequestBytes:4096,maxResponseBytes:4096,secretResolver,fetchFn:validFixture.fetchFn});
  await assert.rejects(()=>backend.sign(request),/timed out/i);
  assert.equal(validFixture.signal?.aborted,true);assert.equal(validFixture.cancelled,true);
});
