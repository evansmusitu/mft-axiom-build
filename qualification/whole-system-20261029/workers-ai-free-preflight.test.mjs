import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inspectFreeWorkersAI,FREE_MODEL} from './workers-ai-free-preflight.mjs';

async function inspect({plans=[],denied=false,result_info}={}){
  const calls=[];
  const report=await inspectFreeWorkersAI({token:'test-only-not-a-real-token',fetchImpl:async(url,init)=>{
    calls.push({url,method:init.method??'GET'});
    assert.equal(init.redirect,'error');
    const subscriptions=url.endsWith('/subscriptions');
    const body=subscriptions?{success:!denied,result:plans,result_info,errors:denied?[{code:10000}]:[]}
      :{success:true,result:url.includes('/models/')?[{name:FREE_MODEL,id:'catalog-model'}]:{default_usage_model:'bundled'}};
    return Response.json(body,{status:subscriptions&&denied?403:200});
  }});
  assert.ok(calls.every(c=>c.method==='GET'));
  assert.equal(report.inference_calls,0);assert.equal(report.billing_changes,0);
  return report;
}
const free={price:0,rate_plan:{id:'workers_free',public_name:'Workers Free'}};
test('admission requires explicit zero-price Workers Free and exact model access',async()=>{
  assert.equal((await inspect({plans:[free]})).admitted,true);
  for(const plans of [[],[{price:0,rate_plan:{id:'free',public_name:'Free zone'}}],[{...free,price:5}],[free,{price:5,rate_plan:{id:'workers_paid'}}],[{rate_plan:free.rate_plan}]])assert.equal((await inspect({plans})).admitted,false);
});
test('unreadable or partial plan inventories cannot admit inference',async()=>{
  assert.equal((await inspect({plans:[free],denied:true})).admitted,false);
  assert.equal((await inspect({plans:[free],result_info:{total_pages:2}})).admitted,false);
});
test('missing credentials never cause network calls',async()=>{
  const report=await inspectFreeWorkersAI({fetchImpl:()=>assert.fail('must not call network')});
  assert.equal(report.admitted,false);assert.equal(report.blocker,'EXISTING_CLOUDFLARE_TOKEN_MISSING');
});
