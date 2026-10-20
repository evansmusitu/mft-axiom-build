import {infer,respond,text,guard,body,fail} from './_groq.js';
import {createHash,timingSafeEqual} from 'node:crypto';
import {viaGateway,viaZeroRatedGateway,generationCost} from './_gateway.js';
export {respond,text,guard,body,fail};
type Message={role:'system'|'user'|'assistant';content:string};
export type ModelChoice='groq_fast'|'groq_quality'|'openai_sol'|'openai_astra'|'claude_sonnet'|'claude_opus'|'gemini_free'|'nemotron_free'|'beam_free'|'openai_luna';
export const MODEL_IDS:Record<ModelChoice,string>={
 groq_fast:'openai/gpt-oss-20b',groq_quality:'openai/gpt-oss-120b',
 openai_sol:'gpt-6.1-sol',openai_astra:'gpt-6-astra',openai_luna:'gpt-6-luna',
 claude_sonnet:'claude-sonnet-5-5',claude_opus:'claude-opus-5-5',
 gemini_free:'gemini-3.8-flash',nemotron_free:'nvidia/nemotron-3-ultra-550b-a55b:free',beam_free:'reflection/beam-free'
};
export function choice(input:unknown):ModelChoice|null{
 const x=typeof input==='string'?input:'';
 if(x==='fast')return 'groq_fast';
 if(x==='quality')return 'groq_quality';
 return Object.prototype.hasOwnProperty.call(MODEL_IDS,x)?x as ModelChoice:null;
}
export function frontierEnabled():boolean {return process.env.ATLAS_ENABLE_PAID_AI==='enabled';}
export function catalog(){
 const on=frontierEnabled() && Boolean(process.env.ATLAS_FRONTIER_ACCESS_CODE) && (process.env.ATLAS_FRONTIER_ACCESS_CODE||'').length>=16;
 const usesGateway=process.env.ATLAS_LAB_USE_GATEWAY==='enabled';
 const gatewayReady=usesGateway&&process.env.ATLAS_GATEWAY_BUDGET_VERIFIED==='yes';
 const hasO=gatewayReady||Boolean(process.env.OPENAI_API_KEY),hasA=gatewayReady||Boolean(process.env.ANTHROPIC_API_KEY);
 const freeEnabled=process.env.ATLAS_FREE_LAB_ACCESS==='enabled';
 return [
  {id:'openai_sol',label:'GPT-6.1 Sol',provider:'OpenAI',model:MODEL_IDS.openai_sol,available:on&&hasO,tier:'frontier'},
  {id:'openai_astra',label:'GPT-6 Astra',provider:'OpenAI',model:MODEL_IDS.openai_astra,available:on&&hasO,tier:'frontier'},
  {id:'openai_luna',label:'GPT-6 Luna · High-volume efficiency',provider:'OpenAI',model:MODEL_IDS.openai_luna,available:on&&hasO,tier:'frontier'},
  {id:'claude_sonnet',label:'Claude Sonnet 5.5',provider:'Anthropic',model:MODEL_IDS.claude_sonnet,available:on&&hasA,tier:'frontier'},
  {id:'claude_opus',label:'Claude Opus 5.5',provider:'Anthropic',model:MODEL_IDS.claude_opus,available:on&&hasA,tier:'frontier'},
  {id:'beam_free',label:'Beam 1.0 · Guaranteed free-only slug',provider:'Vercel Gateway',model:MODEL_IDS.beam_free,available:usesGateway,tier:'free'},
  {id:'gemini_free',label:'Gemini 3.8 Flash · Free API',provider:'Google',model:MODEL_IDS.gemini_free,available:freeEnabled&&Boolean(process.env.GEMINI_API_KEY),tier:'free'},
  {id:'nemotron_free',label:'Nemotron 3 Ultra · Free API',provider:'OpenRouter',model:MODEL_IDS.nemotron_free,available:freeEnabled&&Boolean(process.env.OPENROUTER_API_KEY),tier:'free'},
  {id:'groq_quality',label:'GPT-OSS 120B · Sandbox',provider:'Groq',model:MODEL_IDS.groq_quality,available:Boolean(process.env.GROQ_API_KEY),tier:'sandbox'},
  {id:'groq_fast',label:'GPT-OSS 20B · Sandbox',provider:'Groq',model:MODEL_IDS.groq_fast,available:Boolean(process.env.GROQ_API_KEY),tier:'sandbox'}
 ];
}
function businessError(status:number,message:string){return Object.assign(new Error(message),{code:status});}
async function request(url:string,headers:Record<string,string>,payload:unknown){
 const reply=await fetch(url,{
   method:'POST',
   headers,
   body:JSON.stringify(payload),
   signal:AbortSignal.timeout(55000)
 });
 if(!reply.ok){
  if(reply.status===429)throw businessError(429,'Provider rate limit. Please retry later.');
  if(reply.status===402)throw businessError(503,'Provider account balance or billing needs attention.');
  if(reply.status===401||reply.status===403)throw businessError(503,'Provider credentials or model access need administrator attention.');
  throw businessError(502,'The selected AI provider rejected the request ('+reply.status+').');
 }
 return reply.json();
}
export async function generate(messages:Message[],mode:ModelChoice,jsonFormat:boolean,approved:boolean,accessCode:unknown,tokenLimit?:number):Promise<{answer:string;model:string;provider:string;generationId?:string;costUsd?:number;promptTokens?:number|null;completionTokens?:number|null}>{
 if(mode==='beam_free'){
  const v=await viaZeroRatedGateway(MODEL_IDS.beam_free,messages,tokenLimit??500);
  return {answer:v.answer,model:v.model,provider:v.provider,promptTokens:v.promptTokens,completionTokens:v.completionTokens,...(v.generationId?{generationId:v.generationId}:{})};
 }
 if(mode==='gemini_free'||mode==='nemotron_free'){
  if(process.env.ATLAS_FREE_LAB_ACCESS!=='enabled')throw businessError(403,'Free-API private lab has not been authorized.');
  const isGemini=mode==='gemini_free';
  const key=isGemini?process.env.GEMINI_API_KEY:process.env.OPENROUTER_API_KEY;
  if(!key)throw businessError(503,'Free inference provider key is not configured.');
  if(isGemini){
   const contents=messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
   const res=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents,generationConfig:{maxOutputTokens:Math.min(1000,tokenLimit??850),thinkingConfig:{thinkingLevel:'medium'}}}),signal:AbortSignal.timeout(55000)});
   if(!res.ok)throw businessError(res.status===429?429:502,'Google Gemini free-tier request unavailable (HTTP '+res.status+').');
   const raw=await res.json();const answer=(raw.candidates?.[0]?.content?.parts||[]).filter((p:any)=>typeof p.text==='string').map((p:any)=>p.text).join('\n');
   if(!answer.trim())throw businessError(502,'Google Gemini returned no text.');
   return {answer,model:MODEL_IDS[mode],provider:'Google Gemini API'};
  }
  const raw=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','HTTP-Referer':'https://musitu-atlas-groq.vercel.app'},body:JSON.stringify({model:MODEL_IDS.nemotron_free,messages,max_tokens:Math.min(850,tokenLimit??850)}),signal:AbortSignal.timeout(55000)});
  if(!raw.ok)throw businessError(raw.status===429?429:502,'OpenRouter free endpoint unavailable (HTTP '+raw.status+').');
  const data=await raw.json();const answer=data.choices?.[0]?.message?.content;
  if(typeof answer!=='string'||!answer.trim())throw businessError(502,'Nemotron returned no text.');
  return {answer,model:MODEL_IDS[mode],provider:'OpenRouter'};
 }
 if(mode==='groq_fast'||mode==='groq_quality'){
  const answer=await infer(messages,mode==='groq_fast'?'fast':'quality',jsonFormat);
  return {answer,provider:'Groq',model:MODEL_IDS[mode]};
 }
 // Paid APIs are OFF BY DEFAULT, and require both a server-side release gate
 // and an explicit acknowledgement for each invocation.
 if(!frontierEnabled())throw businessError(403,'Frontier API access has not been enabled. Sandbox mode remains available.');
 if(!approved)throw businessError(403,'Explicit approval is required before requesting a paid frontier model.');
 const expected=process.env.ATLAS_FRONTIER_ACCESS_CODE||'';
 if(expected.length<16 || typeof accessCode!=='string')throw businessError(403,'A private frontier access code is required for paid preview requests.');
 const a=createHash('sha256').update(accessCode).digest(),b=createHash('sha256').update(expected).digest();
 if(!timingSafeEqual(a,b))throw businessError(403,'The private frontier access code is not valid.');
 if(process.env.ATLAS_LAB_USE_GATEWAY==='enabled'){
  const ids:{[k:string]:string}={openai_sol:'openai/gpt-6.1-sol',openai_astra:'openai/gpt-6-astra',openai_luna:'openai/gpt-6-luna',claude_sonnet:'anthropic/claude-sonnet-5.5',claude_opus:'anthropic/claude-opus-5.5'};
  const model=ids[mode];
  const v=await viaGateway(model,messages,tokenLimit??650);
  // The actual cost is queried by generation ID; pending ingestion is reported as unknown.
  const cost=v.generationId?await generationCost(v.generationId):null;
  return {answer:v.answer,model:v.model,provider:v.provider, promptTokens:v.promptTokens,completionTokens:v.completionTokens,...(v.generationId?{generationId:v.generationId}:{}),...(cost!==null?{costUsd:cost}:{})};
 }
 const key=mode.startsWith('openai_')?process.env.OPENAI_API_KEY:process.env.ANTHROPIC_API_KEY;
 if(!key)throw businessError(503,'The selected provider is not configured. Contact the administrator.');
 if(mode.startsWith('openai_')){
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const input=messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:m.content}));
  const result=await request('https://api.openai.com/v1/responses',{
   Authorization:'Bearer '+key,'Content-Type':'application/json'
  },{
   model:MODEL_IDS[mode],instructions:system,input,store:false,
   reasoning:{effort:mode==='openai_astra'?'high':'medium'},
   max_output_tokens:Math.max(200,Math.min(4000,tokenLimit??(mode==='openai_astra'?4000:3000)))
  });
  if(result.status==='incomplete')throw businessError(502,'The model stopped early; retry with a smaller request.');
  const answer=typeof result.output_text==='string'?result.output_text:
    (Array.isArray(result.output)?result.output.flatMap((o:any)=>Array.isArray(o.content)?o.content:[])
      .filter((c:any)=>c.type==='output_text').map((c:any)=>c.text||'').join('\n'):'');
  if(!answer.trim())throw businessError(502,'OpenAI produced no usable text.');
  return {answer:answer.trim(),model:MODEL_IDS[mode],provider:'OpenAI'};
 }
 const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
 const input=messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:m.content}));
 const result=await request('https://api.anthropic.com/v1/messages',{
  'x-api-key':key,'anthropic-version':'2023-06-01','Content-Type':'application/json'
 },{
  model:MODEL_IDS[mode],system,messages:input,max_tokens:Math.max(200,Math.min(2100,tokenLimit??2100))
 });
 const answer=Array.isArray(result.content)?result.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text||'').join('\n'):'';
 if(!answer.trim())throw businessError(502,'Anthropic produced no usable text.');
 return {answer:answer.trim(),model:MODEL_IDS[mode],provider:'Anthropic'};
}
