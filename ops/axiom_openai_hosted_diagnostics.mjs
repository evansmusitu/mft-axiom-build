/** GET-only diagnostics for the two known failed acceptance sessions. Never
 * print provider messages, credentials, request input or hidden reasoning.
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const known=[
  {session:'sess_0f98359bc2ef389b006ae6d3c45d90819da04de8d14d057f1c',turn:'turn_0f98359bc2ef389b006ae6d3c8ea38819db85a93fc6fb386d9'},
  {session:'sess_0511bcd34e3b2dbc006ae6d582055c819e84a5078d8ca685c9',turn:'turn_0511bcd34e3b2dbc006ae6d586f010819ebf2ce4b4ea7473e8'},
];
const codes=new Set(['context_length_exceeded','session_budget_exceeded','usage_limit_exceeded','rate_limit_exceeded','server_overloaded','cyber_policy','connection_failed','server_error','authentication_error','invalid_request','resource_not_found','sandbox_error','executor_version_incompatible','active_turn_not_steerable','request_timeout','internal_error','model_not_found','invalid_api_key','insufficient_quota','permission_denied']);
const report={schema:'musitu.axiom.hosted-readonly-diagnostic.v1',at:new Date().toISOString(),source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,model_inference_requested:false,sessions_created:0,checks:[]};
const key=process.env.OPENAI_API_KEY?.trim();
if(!key)report.blocker='EXISTING_KEY_UNAVAILABLE';
else for(const [name,path]of[
  ['default_model','/models/gpt-6-astra'],
  ...known.flatMap((item,index)=>[['session_'+(index+1),'/agents/sessions/'+item.session],['turn_'+(index+1),'/agents/sessions/'+item.session+'/turns/'+item.turn]]),
]){
  const item={name};
  try{
    const response=await fetch('https://api.openai.com/v1'+path,{method:'GET',headers:{authorization:'Bearer '+key,'OpenAI-Beta':'agents=v1'},redirect:'error',signal:AbortSignal.timeout(15000)});item.http_status=response.status;
    const reader=response.body?.getReader();let body='',received=0;
    if(reader)for(;;){const next=await reader.read();if(next.done)break;received+=next.value.length;if(received>65536){void reader.cancel().catch(()=>{});throw new Error('response limit');}body+=new TextDecoder().decode(next.value);}
    let data;try{data=JSON.parse(body);}catch{}
    if(data?.status&&['queued','in_progress','waiting','completed','failed','cancelled','idle','requires_action'].includes(data.status))item.status=data.status;
    if(data?.error?.code)item.provider_error_code=codes.has(data.error.code)?data.error.code:'OTHER_UNDISCLOSED';
    if(name==='default_model'&&response.status===200)item.exact_model_returned=data?.id==='gpt-6-astra';
  }catch{item.error='BOUNDED_READ_UNAVAILABLE';}
  report.checks.push(item);
}
const out=resolve('qualification/whole-system-20261029/runner-live-results');mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,'hosted-readonly-diagnostic.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
