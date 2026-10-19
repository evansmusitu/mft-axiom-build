import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import {calculate,CalculationError} from '../math.mjs';

const ORIGIN='https://evansmusitu.github.io';
const URL='https://workers.test';

function envMock() {
 const called=[];
 const limit = name => ({limit: async () => {called.push(name);return {success:true};}});
 return {called,env:{
  VISITOR_RATE:limit('visitor'),GLOBAL_RATE:limit('regional'),DEEP_RATE:limit('deep-user'),
  DEEP_REGIONAL:limit('deep-region'),TOOL_RATE:limit('tool-user'),TOOL_REGIONAL:limit('tool-region'),
  AI:{run:async (model,args)=>{called.push('AI:'+model);return {response:'Verified answer: explain the assumptions and concrete next steps.'};}}
 }};
}
function req(path,payload,origin=ORIGIN) {
 return new Request(URL+path,{
  method:'POST',
  headers:{origin,'content-type':'application/json'},
  body:JSON.stringify(payload)
 });
}

test('calculator respects operator precedence and expression grammar',()=>{
 assert.equal(calculate('2+3*4').result,14);
 assert.equal(calculate('(2+3)*4').result,20);
 assert.equal(calculate('-2^2').result,-4);
 assert.equal(calculate('2^-3').result,0.125);
 assert.equal(calculate('sqrt(81)+abs(-3)').result,12);
 assert.equal(calculate('round(3.7)+floor(2.8)+ceil(2.1)').result,9);
 assert.equal(calculate('10%3').result,1);
 assert.equal(calculate('1.5e2+25').result,175);
 const result=calculate('1/3');
 assert.equal(result.exact,false);
 assert.match(result.numericType,/IEEE-754/);
});
test('malformed, malicious and nonfinite calculations fail closed',()=>{
 for(const e of ['','2++','process.exit(1)','1/0','sqrt(-1)','2^(200)','2*1e100','9**9','x+2','(2+4','Math.sin(3)','6;alert(1)']){
  assert.throws(()=>calculate(e),CalculationError,e);
 }
 assert.throws(()=>calculate('1'.repeat(141)),CalculationError);
 assert.throws(()=>calculate('('.repeat(25)+'1'+')'.repeat(25)),CalculationError);
});
test('calculator request consumes dedicated quotas and no AI inference',async()=>{
 const {env,called}=envMock();
 const r=await worker.fetch(req('/api/calculate',{expression:'7*(3+2)'}),env);
 assert.equal(r.status,200);
 const j=await r.json();
 assert.equal(j.result,35);
 assert.equal(j.tool,'calculator');
 assert.deepEqual(called,['tool-user','tool-region']);
});
test('calculator invalid input does not invoke AI or budget',async()=>{
 const {env,called}=envMock();
 const r=await worker.fetch(req('/api/calculate',{expression:'sqrt(-25)'}),env);
 assert.equal(r.status,400);
 const j=await r.json();
 assert.equal(j.code,'CALCULATION_INVALID');
 assert.deepEqual(called,['tool-user','tool-region']);
 const huge=await worker.fetch(req('/api/calculate',{expression:'1'.repeat(141)}),env);
 assert.equal(huge.status,400);
});
test('unknown origin cannot run a calculation or invoke a model',async()=>{
 const {env,called}=envMock();
 const r=await worker.fetch(req('/api/calculate',{expression:'2+2'},'https://external.example'),env);
 assert.equal(r.status,403);
 assert.deepEqual(called,[]);
});
test('reasoning mode selects Qwen and applies separate per-location quotas',async()=>{
 const {env,called}=envMock();
 env.AI.run=async(model,args)=>{
  called.push('AI:'+model);
  assert.equal(args.max_tokens,850);
  return {response:'<think>private internal processing</think>Conclusion: a verifiable plan with assumptions and tests.'};
 };
 const r=await worker.fetch(req('/api/chat',{mode:'deep',prompt:'Help plan a safe software service with robust testing.'}),env);
 assert.equal(r.status,200);
 const j=await r.json();
 assert.equal(j.model,'@cf/qwen/qwen3-30b-a3b-fp8');
 assert.doesNotMatch(j.reply,/think|private internal/i);
 assert.deepEqual(called,['visitor','deep-user','deep-region','regional','AI:@cf/qwen/qwen3-30b-a3b-fp8']);
});
test('reasoning mode accepts OpenAI-style choices response',async()=>{
 const {env}=envMock();
 env.AI.run=async()=>({choices:[{message:{content:'A clear final answer with checks.'}}]});
 const r=await worker.fetch(req('/api/chat',{mode:'deep',prompt:'Provide a clear engineering plan.'}),env);
 assert.equal(r.status,200);
 assert.match((await r.json()).reply,/clear final/);
});
test('reasoning mode fails before inference if deep quota exhausted',async()=>{
 const {env,called}=envMock();
 env.DEEP_RATE.limit=async()=>({success:false});
 const r=await worker.fetch(req('/api/chat',{mode:'deep',prompt:'Provide a robust product plan.'}),env);
 assert.equal(r.status,429);
 assert.equal((await r.json()).code,'DEEP_RATE_LIMIT');
 assert.deepEqual(called,['visitor']);
});
test('health advertises tools and models without pretending inference succeeded',async()=>{
 const {env}=envMock();
 const r=await worker.fetch(new Request(URL+'/api/health',{headers:{origin:ORIGIN}}),env);
 assert.equal(r.status,200);
 const j=await r.json();
 assert.equal(j.availableModels.deeperAnalysis,'@cf/qwen/qwen3-30b-a3b-fp8');
 assert.equal(j.tools[0].path,'/api/calculate');
 assert.equal(j.actualInferenceRequiredToVerifyCapacity,true);
});
test('preflight accepts calculator path for official homepage only',async()=>{
 const {env}=envMock();
 const pre=await worker.fetch(new Request(URL+'/api/calculate',{method:'OPTIONS',headers:{origin:ORIGIN}}),env);
 assert.equal(pre.status,204);
 const denied=await worker.fetch(new Request(URL+'/api/calculate',{method:'OPTIONS',headers:{origin:'https://other.example'}}),env);
 assert.equal(denied.status,403);
});
