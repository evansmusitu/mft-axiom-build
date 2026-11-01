/** Tests the acceptance runner with synthetic transport, not model capability. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('acceptance runner exercises observer loss, a durable receipt, fresh-process readback and revocation without real inference',()=>{
  const out=mkdtempSync(join(tmpdir(),'workers-ai-protocol-'));
  const preload=`globalThis.fetch=async(url,init)=>{
    if(url.startsWith('https://api.github.com/repos/'))return Response.json({name:'axiom-workers-ai-dispatch-20261101-01',workflow_run:{id:123},expired:false});
    if(url==='https://api.cloudflare.com/client/v4/graphql')return Response.json({data:{viewer:{accounts:[{aiInferenceAdaptiveGroups:[{count:0,sum:{totalNeurons:0,totalInputTokens:0,totalOutputTokens:0}}]}]}}});
    if(!url.includes('/ai/run/'))throw new Error('unexpected transport request');
    const body=JSON.parse(init.body);
    if(body.stream)return new Response(new ReadableStream({pull(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'1'},finish_reason:null}]})+'\\n\\n'));}},{highWaterMark:0}),{headers:{'content-type':'text/event-stream'}});
    const input=JSON.parse(body.messages[1].content.split('BOUND INPUT JSON:\\n')[1]);
    const plan={title:'Protocol fixture',needs_research:false,search_query:'',operation:null,operation_args:{}};
    const synthesis={title:'Protocol fixture',summary:input.objective,findings:['Synthetic transport only.'],limitations:['No real model was exercised.'],citations:[]};
    return Response.json({success:true,result:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(input.stage==='planning'?plan:synthesis)}}]}});
  };`;
  try{
    const r=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'qualification/whole-system-20261029/runner-workers-ai-free.mjs'],{encoding:'utf8',timeout:20000,env:{...process.env,GITHUB_REPOSITORY:'evansmusitu/mft-axiom-build',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',AXIOM_FREE_AUTHORIZATION:'user-just-use-that-account-20261101',AXIOM_REMOTE_CLAIM_ID:'456',GH_TOKEN:'not-a-real-credential',CLOUDFLARE_API_TOKEN:'not-a-real-credential',AXIOM_FREE_OUTPUT:out}});
    assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
    const report=JSON.parse(readFileSync(join(out,'acceptance.json'),'utf8'));
    assert.equal(report.status,'CONFIRMED_BOUNDED_COMPONENT_SCOPE');assert.equal(report.inference_calls,3);
    assert.equal(report.checks.fresh_process_readback.extra_model_calls,0);
    assert.equal(report.checks.active_stream_abort_and_work_revocation.successful_artifacts,0);
    assert.equal(report.hosted_d1_qualified,false);assert.equal(report.openai_agents_qualified,false);
  }finally{rmSync(out,{recursive:true,force:true});}
});
