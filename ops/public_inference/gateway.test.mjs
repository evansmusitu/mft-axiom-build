import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createGateway } from './gateway.mjs';
import { reserveQuota } from './quota.mjs';

const NOW = Date.UTC(2026, 9, 9, 9, 0, 0);
const KEY = 'S'.repeat(64);
const GROQ_KEY = 'gsk_FAKE_ONLY_UNREAL_KEY_TOKEN_NOT_LIVE';
const FREE_KEY='Q'.repeat(64);
const MODEL={cloudflare:'@cf/zai-org/glm-4.7-flash',groq:'openai/gpt-oss-120b'};
let counter=1;
function body(provider='cloudflare') {return {provider,model:MODEL[provider],messages:[{role:'user',content:'Explain the number 42.'}],max_tokens:80};}
function signBody(payload, overrides={}) {
  const raw=JSON.stringify(payload);
  const claim={
    schema:'musitu.axiom.public-inference-capability.v1',
    subject:'user_a',project:'project_a',nonce:(counter++).toString(16).padStart(64,'0'),
    provider:payload.provider,model:payload.model,
    request_sha256:createHash('sha256').update(raw).digest('hex'),
    classification:'EXTERNAL_PROVIDER_APPROVED',consent:true,max_tokens:80,
    issued_ms:NOW-1000,expires_ms:NOW+30000,risk_class:'S2',
    external_read_only:true,public_release_authority:false,...overrides,
  };
  const token=Buffer.from(JSON.stringify(claim)).toString('base64url');
  const hmac=createHmac('sha256',KEY).update(token).digest('hex');
  return {raw,token,hmac,claim};
}
function signedRequest(payload=body(), extras={}){
 const sig=signBody(payload,extras.claims||{});
 const headers={'content-type':'application/json','x-axiom-signed-capability':sig.token,'x-axiom-capability-hmac':sig.hmac,...(extras.headers||{})};
 return {request:new Request('https://isolated.example/v1/chat/completions',{method:'POST',headers,body:extras.raw||sig.raw}),sig};
}
function database(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 return {raw:db,prepare(sql){return {bind(...args){return {async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}}}}}};
}
function freeProof(provider){
 const claim={schema:'musitu.axiom.zero-cash-free-provider-proof.v1',provider,model:MODEL[provider],
   account_tier:'FREE',account_ref_sha256:'b'.repeat(64),evidence_sha256:'c'.repeat(64),
   builder_id:'axiom-builder',independent_reviewer_id:'human-security-reviewer',
   verified_no_overage:true,commercial_customer_use_allowed:true,cash_ceiling_usd:'0.00',
   issued_ms:NOW-1000,expires_ms:NOW+60000};
 const token=Buffer.from(JSON.stringify(claim)).toString('base64url');
 return {token,hmac:createHmac('sha256',FREE_KEY).update(token).digest('hex')};
}
const CF_PROOF=freeProof('cloudflare'),GROQ_PROOF=freeProof('groq');
function env(overrides={}){return {
  AXIOM_PUBLIC_INFERENCE_ENABLE:'EXPLICIT_NONPRODUCTION_TEST',
  AXIOM_FREE_ACCOUNT_ATTESTED:'TRUE',
  AXIOM_ZERO_CASH_BUDGET_USD:'0',
  AXIOM_EXTERNAL_PROVIDER_CONSENT_GATE:'VERIFIED',
  AXIOM_CAPABILITY_HMAC_KEY:KEY,
  AXIOM_FREE_PROVIDER_PROOF_KEY:FREE_KEY,
  AXIOM_CLOUDFLARE_FREE_PROOF_TOKEN:CF_PROOF.token,
  AXIOM_CLOUDFLARE_FREE_PROOF_HMAC:CF_PROOF.hmac,
  AXIOM_GROQ_FREE_PROOF_TOKEN:GROQ_PROOF.token,
  AXIOM_GROQ_FREE_PROOF_HMAC:GROQ_PROOF.hmac,
  AXIOM_PUBLIC_INFERENCE_D1:database(),
  AXIOM_GROQ_FREE_ORG_ATTESTED:'TRUE',
  AXIOM_GROQ_FREE_PLAN_KEY:GROQ_KEY,
  AI:{ async run(model,input){if(model!==MODEL.cloudflare)throw Error('bad route');return {response:'42'}} },
  ...overrides,
};}
const gw=createGateway({now:()=>NOW,fetchImpl:async()=>{throw Error('GROQ should not be called')} });
const errorCode=async(res)=>(await res.json()).error?.code;

test('disabled unless every cash, release and consent gate is present',async()=>{
  for(const e of [ {},{AXIOM_PUBLIC_INFERENCE_ENABLE:'LIVE'},
    {AXIOM_ZERO_CASH_BUDGET_USD:'0.01'},{AXIOM_FREE_ACCOUNT_ATTESTED:'FALSE'},
    {AXIOM_EXTERNAL_PROVIDER_CONSENT_GATE:'NOT_PROVEN'},
    {AXIOM_PUBLIC_INFERENCE_D1:null}]){
    const output=env({...e});
    if(Object.keys(e).length===0)delete output.AXIOM_PUBLIC_INFERENCE_ENABLE;
    const res=await gw.fetch(signedRequest().request,output);
    assert.equal(res.status,503);
    assert.equal(await errorCode(res),'NOT_AUTHORIZED_FOR_PUBLIC_SERVICE');
  }
});

test('healthy endpoint does not disclose enabled state or credentials',async()=>{
 const r=await gw.fetch(new Request('https://isolated.example/healthz'),env());
 assert.equal(r.status,200);
 assert.equal((await r.json()).state,'DISABLED_UNTIL_INDEPENDENT_ADMISSION');
});

test('authenticates signed exact capability and calls Cloudflare binding only',async()=>{
 let count=0; const e=env({AI:{async run(model,args){count++;assert.equal(model,MODEL.cloudflare);assert.equal(args.max_completion_tokens,80);return {response:'Test answer'}}}});
 const res=await gw.fetch(signedRequest().request,e);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.output,'Test answer');
 assert.equal(data.qualification,'EXTERNAL_PROVIDER_RESPONSE_UNVERIFIED');
 assert.equal(count,1);
 assert.equal(data.provider,'cloudflare');
 assert.equal(res.headers.get('cache-control'),'no-store');
 assert.doesNotMatch(JSON.stringify(data),/SSSSSSSS/);
});

test('rejects tampering, unsigned requests, expired grants and missing consent before inference',async()=>{
 let calls=0; const e=env({AI:{async run(){calls++;return {response:'Wrong'}}}});
 const bad=[
   signedRequest(body(),{headers:{'x-axiom-capability-hmac':'0'.repeat(64)}}).request,
   new Request('https://isolated.example/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body())}),
   signedRequest(body(),{claims:{expires_ms:NOW-1}}).request,
   signedRequest(body(),{claims:{consent:false}}).request,
   signedRequest(body(),{claims:{classification:'PRIVATE'}}).request,
   signedRequest(body(),{claims:{risk_class:'S3'}}).request,
   signedRequest(body(),{claims:{public_release_authority:true}}).request,
   signedRequest(body(),{claims:{subject:'../bad'}}).request,
   signedRequest(body(),{raw:JSON.stringify({...body(),max_tokens:40})}).request,
 ];
 for(const req of bad){const res=await gw.fetch(req,e);assert.equal(res.status,403,await res.text());}
 assert.equal(calls,0);
});

test('rejects unknown models, injected arbitrary URLs, oversized bodies and unsupported roles before provider',async()=>{
 let calls=0;const e=env({AI:{async run(){calls++;return {response:'Wrong'}}}});
 const invalid=[ {...body(),model:'@cf/moonshotai/kimi-k2.7-code'},
    {...body(),base_url:'https://evil'},
    {...body(),messages:[{role:'tool',content:'danger'}]},
    {...body(),max_tokens:1000},
    {...body(),messages:[{role:'user',content:'x'.repeat(3600)}]},
    {...body(),messages:[{role:'user',content:'test',extra:true}]},
 ];
 for(const item of invalid){const r=await gw.fetch(signedRequest(item).request,e);assert.equal(r.status,403);}
 assert.equal(calls,0);
 const oversize='x'.repeat(5500);
 const r=await gw.fetch(new Request('https://isolated.example/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:oversize}),e);
 assert.equal(r.status,413);
});

test('durable D1 atomic quota: 3/minute, 4/user/day, no retry or automatic fallback',async()=>{
 let calls=0;const e=env({AI:{async run(){calls++;return {response:'yes'}}}});
 const reqs=Array.from({length:5},()=>signedRequest().request);
 const outputs=await Promise.all(reqs.map(r=>gw.fetch(r,e)));
 assert.equal(outputs.filter(r=>r.status===200).length,3);
 assert.equal(outputs.filter(r=>r.status===429).length,2);
 assert.equal(calls,3);
 const repeat=await gw.fetch(signedRequest().request,e);
 assert.equal(repeat.status,429);
 assert.equal(calls,3);
});

test('durable idempotency rejects exact replay (at-most-once upstream)',async()=>{
 let calls=0; const e=env({AI:{async run(){calls++;return {response:'once'}}}});
 const {request,sig}=signedRequest();
 assert.equal((await gw.fetch(request,e)).status,200);
 const duplicate=new Request('https://isolated.example/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','x-axiom-signed-capability':sig.token,'x-axiom-capability-hmac':sig.hmac},body:sig.raw});
 assert.equal((await gw.fetch(duplicate,e)).status,429);
 assert.equal(calls,1);
});

test('quota database unavailable fails closed without provider call',async()=>{
 let calls=0;
 const e=env({AXIOM_PUBLIC_INFERENCE_D1:{prepare(){throw Error('db unavailable')}},AI:{async run(){calls++;return {response:'FAIL'}}}});
 const r=await gw.fetch(signedRequest().request,e);
 assert.equal(r.status,429);assert.equal(calls,0);
});

test('Groq free tier route is pinned, paid fallback denied and 429 never routes to Cloudflare',async()=>{
 let cfCalls=0; let calls=0;
 const fakeFetch=async(url,opts)=>{
   calls++;
   assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
   assert.equal(opts.redirect,'error');
   assert.equal(opts.headers.authorization,`Bearer ${GROQ_KEY}`);
   assert.equal(JSON.parse(opts.body).model,MODEL.groq);
   return new Response(JSON.stringify({choices:[{message:{content:'Groq answer'}}]}),{status:200,headers:{'content-type':'application/json'}});
 };
 const server=createGateway({now:()=>NOW,fetchImpl:fakeFetch});
 const e=env({AI:{async run(){cfCalls++}}});
 const response=await server.fetch(signedRequest(body('groq')).request,e);
 assert.equal(response.status,200);
 assert.equal((await response.json()).output,'Groq answer');
 assert.equal(calls,1);assert.equal(cfCalls,0);
 const absent=await server.fetch(signedRequest(body('groq')).request,env({AXIOM_GROQ_FREE_ORG_ATTESTED:'FALSE'}));
 assert.equal(absent.status,503);
 const failing=createGateway({now:()=>NOW,fetchImpl:async()=>new Response('plan limit',{status:429})});
 const rate=await failing.fetch(signedRequest(body('groq')).request,env());
 assert.equal(rate.status,429);assert.equal(await errorCode(rate),'PROVIDER_UNAVAILABLE_NO_PAID_FALLBACK');
});

test('upstream failures redact errors and do not retry against another provider',async()=>{
 let calls=0;
 const e=env({AI:{async run(){calls++;throw Error('secret '+KEY)}}});
 const response=await gw.fetch(signedRequest().request,e);
 assert.equal(response.status,502);
 assert.equal(calls,1);
 assert.doesNotMatch(await response.text(),new RegExp(KEY));
});

test('quota SQL actually works on sqlite and prevents global and per-user overflow atomically',async()=>{
 const d=database();
 const now=NOW;
 for(let i=0;i<4;i++){
   const claims={nonce:(100+i).toString(16).padStart(64,'0'),subject:'u',project:'p',provider:'cloudflare',max_tokens:100};
   // 3 per minute; use distinct minute to exercise per-user cap.
   await reserveQuota(d,claims,now+i*60000);
 }
 await assert.rejects(()=>reserveQuota(d,{nonce:'f'.repeat(64),subject:'u',project:'p',provider:'cloudflare',max_tokens:100},now+4*60000));
 const n=d.raw.prepare('SELECT COUNT(*) AS count FROM public_inference_reservations').get();
 assert.equal(n.count,4);
});

test('daily global cap 40 is atomic in SQLite and no request reaches provider on overrun',async()=>{
 const db=database(); const t=NOW;
 for(let i=0;i<40;i++){
   const c={nonce:(i+5000).toString(16).padStart(64,'0'),subject:`tenant${i}`,project:'p',provider:i%2?'groq':'cloudflare',max_tokens:80};
   await reserveQuota(db,c,t+i*60000);
 }
 await assert.rejects(()=>reserveQuota(db,{nonce:'e'.repeat(64),subject:'extra',project:'p',provider:'groq',max_tokens:80},t+50*60000));
 assert.equal(db.raw.prepare('SELECT COUNT(*) AS count FROM public_inference_reservations').get().count,40);
});

test('missing free-plan credential and AI binding are denied without reserving capacity',async()=>{
 for(const [provider,missing,status] of [
   ['cloudflare',{AI:null},503],
   ['groq',{AXIOM_GROQ_FREE_ORG_ATTESTED:'FALSE'},503],
   ['groq',{AXIOM_GROQ_FREE_PLAN_KEY:null},503],
 ]){
   const e=env(missing);
   const request=signedRequest(body(provider)).request;
   const r=await gw.fetch(request,e);
   assert.equal(r.status,status);
   assert.equal(e.AXIOM_PUBLIC_INFERENCE_D1.raw.prepare('SELECT COUNT(*) AS n FROM public_inference_reservations').get().n,0);
 }
});

test('unsupported paths and methods are rejected before quota or credentials',async()=>{
 const e=env();
 for(const [url,method,status] of [['https://isolated.example/admin','GET',404],['https://isolated.example/v1/chat/completions','GET',405]]){
   const r=await gw.fetch(new Request(url,{method}),e);assert.equal(r.status,status);
 }
 assert.equal(e.AXIOM_PUBLIC_INFERENCE_D1.raw.prepare('SELECT COUNT(*) AS n FROM public_inference_reservations').get().n,0);
});

test('rejected signatures do not burn shared global quotas',async()=>{
 const e=env();
 for(let i=0;i<20;i++){
   const r=await gw.fetch(signedRequest(body(),{headers:{'x-axiom-capability-hmac':'f'.repeat(64)}}).request,e);
   assert.equal(r.status,403);
 }
 assert.equal(e.AXIOM_PUBLIC_INFERENCE_D1.raw.prepare('SELECT COUNT(*) AS n FROM public_inference_reservations').get().n,0);
});

test('plain TRUE environment flags cannot replace independently signed free-provider evidence',async()=>{
  let calls=0;
  const e=env({AXIOM_CLOUDFLARE_FREE_PROOF_HMAC:null,AI:{async run(){calls++;return {response:'SHOULD_NOT_RUN'};}}});
  const denied=await gw.fetch(signedRequest().request,e);
  assert.equal(denied.status,503);
  assert.equal(await errorCode(denied),'FREE_ACCOUNT_PROOF_NOT_VERIFIED');
  assert.equal(calls,0);
  assert.equal(e.AXIOM_PUBLIC_INFERENCE_D1.raw.prepare('SELECT COUNT(*) AS n FROM public_inference_reservations').get().n,0);
});

test('forged Groq free-plan attestation rejects before quota or provider network call',async()=>{
  let calls=0;
  const fake=createGateway({now:()=>NOW,fetchImpl:async()=>{calls++;throw Error('unexpected provider call');}});
  const e=env({AXIOM_GROQ_FREE_PROOF_HMAC:'0'.repeat(64)});
  const result=await fake.fetch(signedRequest(body('groq')).request,e);
  assert.equal(result.status,503);
  assert.equal(await errorCode(result),'FREE_ACCOUNT_PROOF_NOT_VERIFIED');
  assert.equal(calls,0);
  assert.equal(e.AXIOM_PUBLIC_INFERENCE_D1.raw.prepare('SELECT COUNT(*) AS n FROM public_inference_reservations').get().n,0);
});

test('1,000 concurrent synthetic public requests preserve hard 3-per-minute free quota',async()=>{
  let providerCalls=0;
  const e=env({AI:{async run(){providerCalls++;return {response:'synthetic-only'}}}});
  // No public network calls. Requests share one synchronous local SQL database,
  // so this exercises the gateway boundary, NOT D1's distributed admission.
  const requests=Array.from({length:1000},()=>signedRequest().request);
  const results=await Promise.all(requests.map(r=>gw.fetch(r,e)));
  assert.equal(results.filter(r=>r.status===200).length,3);
  assert.equal(results.filter(r=>r.status===429).length,997);
  assert.equal(providerCalls,3);
  assert.equal(e.AXIOM_PUBLIC_INFERENCE_D1.raw.prepare('SELECT COUNT(*) AS n FROM public_inference_reservations').get().n,3);
});

test('explicit Free-plan SQLite DO ledger routes only verified S2 capabilities without D1 fallback',async()=>{
 let calls=0,admissions=0;
 const e=env({
   AXIOM_QUOTA_BACKEND:'SQLITE_DO', AXIOM_PUBLIC_INFERENCE_D1:null,
   AXIOM_DO_INTERNAL_QUOTA_KEY:'c'.repeat(64),
   AXIOM_GLOBAL_QUOTA:{
     idFromName(name){assert.equal(name,'axiom-public-inference-global-v1');return name;},
     get(){return {fetch:async(url,options)=>{
       assert.equal(new URL(url).hostname,'quota.internal');
       assert.equal(options.method,'POST');
       assert.equal(options.headers['x-axiom-internal-signature'].length,64);
       admissions++;
       return new Response(null,{status:204});
     }};}
   },
   AI:{async run(){calls++;return {choices:[{message:{content:'Native compatible answer'}}]};}}
 });
 const r=await gw.fetch(signedRequest().request,e);
 assert.equal(r.status,200);assert.equal((await r.json()).output,'Native compatible answer');
 assert.equal(admissions,1);assert.equal(calls,1);
});

test('Durable Object ledger missing or failing never invokes model or falls back to D1',async()=>{
 let calls=0;
 const e=env({AXIOM_QUOTA_BACKEND:'SQLITE_DO',AXIOM_GLOBAL_QUOTA:null,
               AI:{async run(){calls++;return {response:'unsafe'};}}});
 const denied=await gw.fetch(signedRequest().request,e);
 assert.equal(denied.status,503);assert.equal(calls,0);
 const fail=env({AXIOM_QUOTA_BACKEND:'SQLITE_DO',AXIOM_GLOBAL_QUOTA:{
    idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:429})})},
    AXIOM_DO_INTERNAL_QUOTA_KEY:'c'.repeat(64),
    AI:{async run(){calls++;return{response:'unsafe'}}}});
 const rejected=await gw.fetch(signedRequest().request,fail);
 assert.equal(rejected.status,429);assert.equal(calls,0);
});
