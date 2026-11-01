import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readAINeurons,admitFreeAllowance,createBoundedWorkersAI} from './workers-ai-free-client.mjs';
import {FREE_MODEL} from './workers-ai-free-preflight.mjs';
const usage=()=>({neurons:0,observed_at:new Date().toISOString()});
test('usage reads aggregate account-wide neurons and rejects missing or failed analytics',async()=>{
  const query=async body=>readAINeurons({token:'test-only',fetchImpl:async(url,init)=>{assert.equal(url,'https://api.cloudflare.com/client/v4/graphql');assert.equal(init.redirect,'error');assert.ok(!JSON.parse(init.body).query.includes('modelId'));return Response.json(body);}});
  assert.equal((await query({data:{viewer:{accounts:[{aiInferenceAdaptiveGroups:[{count:2,sum:{totalNeurons:11}}]}]}}})).neurons,11);
  assert.equal((await query({data:{viewer:{accounts:[{aiInferenceAdaptiveGroups:[]}]}}})).neurons,0);
  for(const body of [{errors:[{message:'forbidden'}]},{data:{viewer:{accounts:[]}}},{data:{viewer:{accounts:[{aiInferenceAdaptiveGroups:[{sum:{}}]}]}}}])await assert.rejects(()=>query(body));
});
test('allowance admission rejects stale, invalid and insufficient usage headroom',()=>{
  assert.equal(admitFreeAllowance(usage()).max_calls,3);
  for(const input of [{...usage(),neurons:501},{...usage(),neurons:-1},{...usage(),neurons:NaN},{neurons:0,observed_at:'invalid'},{...usage(),observed_at:new Date(Date.now()-61000).toISOString()}])assert.throws(()=>admitFreeAllowance(input));
});
test('bounded transport reserves before dispatch and never retries or falls back',async()=>{
  let requests=0,observations=0;
  const client=createBoundedWorkersAI({token:'test-only',usage:usage(),observe:async calls=>{if(calls.at(-1).status==='BEFORE_DISPATCH'){observations++;assert.equal(requests,calls.length-1);}},fetchImpl:async()=>{requests++;throw new TypeError('network lost');}});
  // Observe failures separately; a failed request still consumes its reservation.
  for(let i=0;i<3;i++)await assert.rejects(()=>client.AI.run(FREE_MODEL,{messages:[],max_tokens:1800}));
  await assert.rejects(()=>client.AI.run(FREE_MODEL,{messages:[],max_tokens:1800}),/budget/);
  assert.equal(requests,3);assert.equal(client.calls.length,3);assert.ok(observations>=3);
});
test('model substitution, oversized inputs and excessive output caps never dispatch',async()=>{
  const client=createBoundedWorkersAI({token:'test-only',usage:usage(),fetchImpl:()=>assert.fail('must not dispatch')});
  for(const [model,input] of [['@cf/paid/model',{max_tokens:1}],[FREE_MODEL,{max_tokens:1801}],[FREE_MODEL,{max_tokens:0}],[FREE_MODEL,{max_tokens:100,messages:['x'.repeat(8001)]}]])await assert.rejects(()=>client.AI.run(model,input));
  assert.equal(client.calls.length,0);
});
