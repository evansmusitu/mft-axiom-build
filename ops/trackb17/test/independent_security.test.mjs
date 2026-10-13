/** S0 red-team contract tests. Separate suite from builder's behavior cases.
 * Exercises the broker's public export against an independently composed quota
 * stub. No provider tokens, network, production routes or real authorizers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {digestPayload,guardedDispatch} from '../dispatch_guard.mjs';
import {canonicalName,utcDay} from '../../trackb16/src/identity.mjs';
const AT=Date.parse('2026-10-13T10:00:00Z');
const body={model:'@cf/zai-org/glm-4.7-flash',messages:[{role:'user',content:'synthetic review task'}],max_output_tokens:24};
async function make({quotaResult,send,mutateRequest,envMutate}={}) {
 let dispatches=0,reservations=0;
 const id='acct-1',day=utcDay(AT),name=canonicalName(id,day);
 const payload=structuredClone(body);
 const request={auth:{payload_b64:'A',signature_b64:'B'},signed:{payload_b64:'C',signature_b64:'D'},
     request_id:'op-1',request_sha:await digestPayload(payload),tenant_id:'tenant-1',workload_id:'w-1',neurons:10};
 mutateRequest?.(request,payload);
 const stub={name,id:{name},reserve:async()=>{reservations++;return (typeof quotaResult==='function'?quotaResult():quotaResult)??({status:'RESERVED',dispatch_allowed:true,request_id:request.request_id,neurons:request.neurons,grant_id:'g-1',used:10,safe_limit:100})},revoke:()=>{}};
 const env={AXIOM_ACCOUNT_ID:id,AXIOM_QUOTA_S0:{getByName:()=>stub}};
 envMutate?.(env,stub);
 const attempt=()=>guardedDispatch({trustedEnv:env,request,payload,allowedModels:[body.model],maxOutputTokens:32,now:()=>AT,sendProvider:async arg=>{dispatches++;return send?send(arg):{ok:true}}});
 return {attempt,counts:()=>({dispatches,reservations}),request,payload};
}
const deny=async (h, code)=>assert.rejects(h.attempt(),e=>e?.code===code);
test('attack: forged quota receipt with status but no identifier fails closed',async()=>{
 const h=await make({quotaResult:{status:'RESERVED',dispatch_allowed:true,request_id:'op-1',neurons:10,used:10,safe_limit:100}});
 await deny(h,'QUOTA_RECEIPT_INVALID');assert.equal(h.counts().dispatches,0);
});
test('attack: mutated signed hash binding is denied before quota',async()=>{
 const h=await make({mutateRequest:r=>{r.request_sha='f'.repeat(64)}});
 await deny(h,'PAYLOAD_HASH_MISMATCH');assert.deepEqual(h.counts(),{dispatches:0,reservations:0});
});
test('attack: forged caller-selected RPC bucket cannot trigger provider',async()=>{
 const h=await make({envMutate:(_e,s)=>{s.name='attacker-bucket'}});
 await deny(h,'NONCANONICAL_QUOTA_STUB');assert.deepEqual(h.counts(),{dispatches:0,reservations:0});
});
test('attack: missing trusted Durable Object namespace cannot dispatch',async()=>{
 const h=await make({envMutate:e=>{e.AXIOM_QUOTA_S0={}}});
 await deny(h,'TRUSTED_BINDING_UNAVAILABLE');assert.deepEqual(h.counts(),{dispatches:0,reservations:0});
});
test('attack: unknown quota outcome is never treated as admitted',async()=>{
 const h=await make({quotaResult:{status:'OK',dispatch_allowed:true}});
 await deny(h,'QUOTA_RECEIPT_INVALID');assert.equal(h.counts().dispatches,0);
});
test('attack: remote denial with attacker payload is not propagated as success',async()=>{
 const h=await make({quotaResult:{status:'DENIED',dispatch_allowed:false,reason:'unsanitized reason'}});
 await deny(h,'QUOTA_RECEIPT_INVALID');assert.equal(h.counts().dispatches,0);
});
test('attack: remote quota database failure denies external send',async()=>{
 const h=await make({quotaResult:()=>{throw Error('database unavailable')}});
 await assert.rejects(h.attempt(), /database unavailable/);assert.equal(h.counts().dispatches,0);
});
test('attack: provider fail after reservation has no automatic retry',async()=>{
 const h=await make({send:async()=>{throw Error('timeout after possible delivery')}});
 const out=await h.attempt();assert.equal(out.status,'UNKNOWN_AFTER_RESERVATION');
 assert.equal(out.resend_prohibited,true);assert.deepEqual(h.counts(),{dispatches:1,reservations:1});
});
test('attack: malicious output-token choice rejected before reservation',async()=>{
 const h=await make({mutateRequest:(r,p)=>{p.max_output_tokens=32768;r.request_sha='f'.repeat(64)}});
 await deny(h,'OUTPUT_LIMIT_DENIED');assert.deepEqual(h.counts(),{dispatches:0,reservations:0});
});
test('attack: malicious agent-provided endpoint fails strict payload schema',async()=>{
 const h=await make({mutateRequest:(r,p)=>{p.endpoint='https://attacker.test';r.request_sha='f'.repeat(64)}});
 await deny(h,'PROVIDER_PAYLOAD_SCHEMA_DENIED');assert.deepEqual(h.counts(),{dispatches:0,reservations:0});
});
