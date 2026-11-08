import test from 'node:test';import assert from 'node:assert/strict';
import {createGroqQualificationGateway} from '../src/ai/groq-gateway.mjs';
const tenantId='00000000-0000-4000-8000-00000000000a',other='00000000-0000-4000-8000-00000000000b';
const token='gsk_'+'synthetic'.repeat(5),question='When are you open?';
const input={tenantId,question,approvedFaqs:[{tenantId,faqId:'hours',question,answer:'Synthetic hours: nine until five.',approved:true}]};
const response=(content={action:'ANSWER',faqId:'hours'},options={})=>new Response(JSON.stringify({model:'openai/gpt-oss-20b',choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:120,completion_tokens:24,total_tokens:144},...options}),{headers:{'content-type':'application/json'}});
const config=fetchImpl=>({token,freePlanVerified:true,fetchImpl,timeoutMs:100});

test('Groq factory requires explicit verified free-plan admission and a separate Groq credential',()=>{
 assert.throws(()=>createGroqQualificationGateway({token}),/GROQ_FREE_PLAN_NOT_VERIFIED/);
 assert.throws(()=>createGroqQualificationGateway({token:'sk-unrelated',freePlanVerified:true}),/GROQ_CREDENTIAL_REQUIRED/);
});
test('Groq pins its official endpoint/model, disables tools and accepts only approved source text',async()=>{
 let calls=0;const g=createGroqQualificationGateway(config(async(url,options)=>{
  calls++;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(options.headers.authorization,'Bearer '+token);assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);assert.equal(body.model,'openai/gpt-oss-20b');assert.equal(body.max_completion_tokens,512);assert.equal(body.reasoning_effort,'low');assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.tools,undefined);assert.equal(options.body.includes(input.approvedFaqs[0].answer),false);assert.equal(options.body.includes(tenantId),false);
  return response({action:'ANSWER',faqId:'hours',content:'Invented answer must never be used'});
 }));
 const result=await g.select(input);assert.equal(result.body,input.approvedFaqs[0].answer);assert.equal(result.status,'DRAFT');assert.equal(calls,1);
 assert.deepEqual(g.getUsage().tokens,{input:120,output:24,total:144});assert.equal(JSON.stringify(g.getUsage()).includes(token),false);
});
test('Groq refuses foreign-tenant sources and potential credentials before network admission',async()=>{
 let calls=0;const g=createGroqQualificationGateway(config(async()=>{calls++;return response();}));
 assert.equal((await g.select({...input,approvedFaqs:[{...input.approvedFaqs[0],tenantId:other}]})).status,'HANDOVER_REQUIRED');
 for(const text of [token,'email me at synthetic@example.invalid','phone +19999990001'])assert.equal((await g.select({...input,question:text})).status,'HANDOVER_REQUIRED');
 assert.equal(calls,0);assert.equal(g.getUsage().attempts,0);
});
test('Groq 429, malformed response and foreign source identifiers fall back without retries',async()=>{
 for(const answer of [()=>new Response('{}',{status:429}),()=>new Response('{bad',{headers:{'content-type':'application/json'}}),()=>response({action:'ANSWER',faqId:'foreign'}),()=>response({action:'EXECUTE',faqId:'hours'}),()=>response({action:'ANSWER',faqId:'hours'},{model:'different-model'})]){
  let calls=0;const g=createGroqQualificationGateway(config(async()=>{calls++;return answer();}));
  assert.equal((await g.select(input)).status,'HANDOVER_REQUIRED');assert.equal(calls,1);assert.equal(g.getUsage().attempts,1);
 }
});
test('Groq paraphrases require review; returned data never authorizes a send',async()=>{
 const g=createGroqQualificationGateway(config(async()=>response()));
 const result=await g.select({...input,question:'What time do you close?'});assert.equal(result.status,'HUMAN_REVIEW_REQUIRED');assert.equal(result.requiresHumanReview,true);assert.equal(result.body,input.approvedFaqs[0].answer);assert.equal(result.send,undefined);
});
test('finite Groq request admission prevents parallel requests and caps total attempts',async()=>{
 let release,calls=0;const g=createGroqQualificationGateway({...config(async()=>{calls++;await new Promise(r=>{release=r;});return response();}),maxRequests:1});
 const first=g.select(input);for(let i=0;i<20&&!release;i++)await new Promise(r=>setImmediate(r));assert.ok(release);
 assert.equal((await g.select(input)).status,'HANDOVER_REQUIRED');release();assert.equal((await first).status,'DRAFT');assert.equal((await g.select(input)).status,'HANDOVER_REQUIRED');assert.equal(calls,1);
});
test('Groq deadline ends unresponsive transport without admitting another attempt',async()=>{
 const g=createGroqQualificationGateway({...config(async()=>new Promise(()=>{})),maxRequests:1});const start=Date.now();
 assert.equal((await g.select(input)).status,'HANDOVER_REQUIRED');assert.ok(Date.now()-start<1000);assert.equal((await g.select(input)).status,'HANDOVER_REQUIRED');assert.equal(g.getUsage().attempts,1);assert.equal(g.getUsage().events[0].outcome,'TIMEOUT');
});
test('an uncertain timed-out Groq request closes admission even when the request budget remains',async()=>{
 let calls=0;const g=createGroqQualificationGateway({...config(async()=>{calls++;return new Promise(()=>{});}),maxRequests:5});
 assert.equal((await g.select(input)).status,'HANDOVER_REQUIRED');assert.equal((await g.select(input)).status,'HANDOVER_REQUIRED');assert.equal(calls,1);assert.equal(g.getUsage().admittedRequests,1);
});
