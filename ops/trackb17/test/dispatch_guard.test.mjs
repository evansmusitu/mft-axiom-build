import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {digestPayload, guardedDispatch} from '../dispatch_guard.mjs';
import {canonicalName,utcDay} from '../../trackb16/src/identity.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const NOW=Date.parse('2026-10-13T08:00:00Z');
const model='test-local-model';
const mkBody=(msg='public synthetic task')=>({model,messages:[{role:'user',content:msg}],max_output_tokens:32});
const mkRequest=(digest='a'.repeat(64),mut={})=>({auth:{payload_b64:'AAA=',signature_b64:'AAA='},signed:{payload_b64:'BBB=',signature_b64:'BBB='},request_sha:digest,request_id:'req_1',tenant_id:'tenant_a',workload_id:'agent_a',neurons:10,...mut});
function envWith(reserve,{altered=false}={}){const name=canonicalName('account_a',utcDay(NOW));return {AXIOM_ACCOUNT_ID:'account_a',AXIOM_QUOTA_S0:{getByName(n){assert.equal(n,name);return {name:altered?name+'-imposter':name,id:{name},reserve,revoke(){}};}}};}
const receipt=(r)=>({status:'RESERVED',dispatch_allowed:true,request_id:r.request_id,neurons:r.neurons,grant_id:'grant_1',used:10,safe_limit:100});
async function harness({body=mkBody(),request=null,reserve=null,send=null,now=()=>NOW,models=[model]}={}){
 const digest=await digestPayload(body);let reserves=0,sends=0;
 const inp=request??mkRequest(digest);
 const r=reserve??(async()=>receipt(inp));
 const s=send??(async()=>({choices:[]}));
 const environment=envWith(async req=>{reserves++;return r(req)});
 const result=await guardedDispatch({trustedEnv:environment,request:inp,payload:body,allowedModels:models,maxOutputTokens:64,now,sendProvider:async (...args)=>{sends++;return s(...args)}});
 return {result,reserves,sends};
}
const denied=async (fn, code)=>await assert.rejects(fn,e=>e?.code===code);

test('hash binds the exact canonical payload regardless of property order',async()=>{
 const a=mkBody(),b={max_output_tokens:32,messages:[{content:'public synthetic task',role:'user'}],model};
 assert.equal(await digestPayload(a),await digestPayload(b));
 assert.match(await digestPayload(a),/^[0-9a-f]{64}$/);
 assert.notEqual(await digestPayload(a),await digestPayload(mkBody('changed prompt')));
});
test('rejects changed model request before quota reservation or model send',async()=>{
 const body=mkBody(),oldDigest=await digestPayload(body);
 const inp=mkRequest(oldDigest);
 let reserves=0,sends=0;
 const env=envWith(()=>{reserves++;return receipt(inp)});
 await denied(()=>guardedDispatch({trustedEnv:env,request:inp,payload:mkBody('modified'),allowedModels:[model],maxOutputTokens:64,now:()=>NOW,sendProvider:()=>{sends++;}}),'PAYLOAD_HASH_MISMATCH');
 assert.equal(reserves,0);assert.equal(sends,0);
});
test('rejects an unapproved model before the quota or provider',async()=>{
 await denied(()=>harness({models:['other-model']}),'MODEL_SCOPE_DENIED');
});
test('rejects prompt containing untrusted endpoint property',async()=>{
 const body={...mkBody(),endpoint:'https://malicious.example'};
 await denied(()=>harness({body}),'PROVIDER_PAYLOAD_SCHEMA_DENIED');
});
test('rejects overly large message before admission',async()=>{
 await denied(()=>harness({body:mkBody('x'.repeat(35000))}),'PAYLOAD_SIZE_DENIED');
});
test('rejects output-token limit bypass',async()=>{
 await denied(()=>harness({body:{...mkBody(),max_output_tokens:600}}),'OUTPUT_LIMIT_DENIED');
});
test('rejects poisoned own prototype keys and noncanonical unsupported types',async()=>{
 const obj=JSON.parse('{"model":"test-local-model","messages":[{"role":"user","content":"ok"}],"max_output_tokens":32,"__proto__":"unsafe"}');
 await denied(()=>harness({body:obj}),'PROVIDER_PAYLOAD_SCHEMA_DENIED');
});
test('rejects invalid signed request schema before reserve',async()=>{
 const inp=mkRequest('a'.repeat(64),{provider_url:'https://malicious.example'});
 await denied(()=>harness({request:inp}),'REQUEST_SCHEMA_DENIED');
});
test('positive reservation permits exactly one trusted provider call',async()=>{
 const v=await harness();assert.equal(v.reserves,1);assert.equal(v.sends,1);assert.equal(v.result.status,'COMPLETED');
 assert.equal(v.result.dispatch_allowed,false);
});
test('duplicate receipt never calls provider',async()=>{
 const v=await harness({reserve:async()=>({status:'ALREADY_RESERVED',dispatch_allowed:false})});
 assert.equal(v.reserves,1);assert.equal(v.sends,0);assert.equal(v.result.status,'REPLAY_DENIED');
});
test('signed quota denial never calls provider',async()=>{
 const v=await harness({reserve:async()=>({status:'DENIED',dispatch_allowed:false,reason:'WORKLOAD_SIGNATURE_INVALID'})});
 assert.equal(v.sends,0);assert.equal(v.result.status,'DENIED');
});
test('forged admission receipt with wrong operation cannot dispatch',async()=>{
 await denied(()=>harness({reserve:async r=>({...receipt(r),request_id:'other'})}),'QUOTA_RECEIPT_INVALID');
});
test('malformed admission receipt cannot dispatch',async()=>{
 await denied(()=>harness({reserve:async()=>({status:'RESERVED',dispatch_allowed:true})}),'QUOTA_RECEIPT_INVALID');
});
test('provider error burns reservation and returns uncertain outcome rather than retry',async()=>{
 const v=await harness({send:async()=>{throw Error('synthetic upstream error');}});
 assert.equal(v.reserves,1);assert.equal(v.sends,1);assert.equal(v.result.status,'UNKNOWN_AFTER_RESERVATION');assert.equal(v.result.resend_prohibited,true);
});
test('UTC rollover after reservation blocks provider send',async()=>{
 let ticks=0;const now=()=>++ticks<2?NOW:NOW+86400000;
 const v=await harness({now});assert.equal(v.reserves,1);assert.equal(v.sends,0);assert.equal(v.result.status,'ABORTED_AFTER_RESERVATION');
});
test('quota service transport exception cannot trigger provider send',async()=>{
 let sends=0;await assert.rejects(()=>harness({reserve:async()=>{throw Error('database unavailable')},send:async()=>{sends++}}));assert.equal(sends,0);
});

test('trusted Cloudflare model identifier is allowed and bound to hash',async()=>{
 const body={...mkBody(),model:'@cf/zai-org/glm-4.7-flash'};
 const value=await harness({body,models:['@cf/zai-org/glm-4.7-flash']});
 assert.equal(value.reserves,1);assert.equal(value.sends,1);
});
test('receipt with missing grant ID is never sufficient for provider call',async()=>{
 await denied(()=>harness({reserve:async r=>({status:'RESERVED',dispatch_allowed:true,request_id:r.request_id,neurons:r.neurons,used:10,safe_limit:100})}),'QUOTA_RECEIPT_INVALID');
});
test('unknown or spoofed quota status cannot authorize provider invocation',async()=>{
 await denied(()=>harness({reserve:async()=>({status:'APPROVED',dispatch_allowed:true})}),'QUOTA_RECEIPT_INVALID');
});
test('synthetic two-worker replay emits only one provider request under shared atomic ledger',async()=>{
 const body=mkBody(),hash=await digestPayload(body),r=mkRequest(hash);
 let spent=false,reserves=0,sends=0;
 const env=envWith(async ()=>{reserves++;if(spent)return {status:'ALREADY_RESERVED',dispatch_allowed:false};spent=true;return receipt(r)});
 const opts={trustedEnv:env,request:r,payload:body,allowedModels:[model],maxOutputTokens:64,now:()=>NOW,sendProvider:async()=>{sends++;return {synthetic:true}}};
 const values=await Promise.all([guardedDispatch(opts),guardedDispatch(opts)]);
 assert.deepEqual(values.map(x=>x.status).sort(),['COMPLETED','REPLAY_DENIED']);
 assert.equal(reserves,2);assert.equal(sends,1);
});
test('hash-bound payload cannot be changed by provider-side callback prior to send',async()=>{
 const body=mkBody(),hash=await digestPayload(body),r=mkRequest(hash); let received='';
 const env=envWith(async()=>receipt(r));
 const result=await guardedDispatch({trustedEnv:env,request:r,payload:body,allowedModels:[model],maxOutputTokens:64,now:()=>NOW,sendProvider:async bytes=>{
   body.messages[0].content='modified only after reservation';
   received=new TextDecoder().decode(bytes);
 }});
 assert.equal(result.status,'COMPLETED');assert.match(received,/public synthetic task/);
 assert.ok(!received.includes('modified only after reservation'));
});
test('quota-substituted stub and public bucket mismatch cannot cause provider send',async()=>{
 const body=mkBody(),digest=await digestPayload(body);let sends=0;
 await denied(()=>guardedDispatch({trustedEnv:envWith(async r=>receipt(r),{altered:true}),request:mkRequest(digest),payload:body,allowedModels:[model],maxOutputTokens:64,now:()=>NOW,sendProvider:async()=>{sends++}}),'NONCANONICAL_QUOTA_STUB');
 assert.equal(sends,0);
});
test('denial result must be uppercase typed policy reason',async()=>{
 await denied(()=>harness({reserve:async()=>({status:'DENIED',dispatch_allowed:false,reason:'forged attacker note'})}),'QUOTA_RECEIPT_INVALID');
});
test('failed transport does not expose provider prompt in outcome',async()=>{
 const body=mkBody('private-synthetic-example-DO-NOT-EXPOSE');
 const v=await harness({body,send:async()=>{throw Error('provider failed: '+body.messages[0].content)}});
 assert.equal(v.result.status,'UNKNOWN_AFTER_RESERVATION');
 assert.equal(JSON.stringify(v.result).includes('private-synthetic-example'),false);
});
