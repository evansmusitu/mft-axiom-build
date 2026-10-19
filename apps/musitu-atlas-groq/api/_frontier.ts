import {infer,respond,text,guard,body,fail} from './_groq.js';
import {createHash,timingSafeEqual} from 'node:crypto';
export {respond,text,guard,body,fail};
type Message={role:'system'|'user'|'assistant';content:string};
export type ModelChoice='groq_fast'|'groq_quality'|'openai_sol'|'openai_astra'|'claude_sonnet'|'claude_opus';
export const MODEL_IDS:Record<ModelChoice,string>={
 groq_fast:'openai/gpt-oss-20b',groq_quality:'openai/gpt-oss-120b',
 openai_sol:'gpt-6.1-sol',openai_astra:'gpt-6-astra',
 claude_sonnet:'claude-sonnet-5-5',claude_opus:'claude-opus-5-5'
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
 const hasO=Boolean(process.env.OPENAI_API_KEY),hasA=Boolean(process.env.ANTHROPIC_API_KEY);
 return [
  {id:'openai_sol',label:'GPT-6.1 Sol',provider:'OpenAI',model:MODEL_IDS.openai_sol,available:on&&hasO,tier:'frontier'},
  {id:'openai_astra',label:'GPT-6 Astra',provider:'OpenAI',model:MODEL_IDS.openai_astra,available:on&&hasO,tier:'frontier'},
  {id:'claude_sonnet',label:'Claude Sonnet 5.5',provider:'Anthropic',model:MODEL_IDS.claude_sonnet,available:on&&hasA,tier:'frontier'},
  {id:'claude_opus',label:'Claude Opus 5.5',provider:'Anthropic',model:MODEL_IDS.claude_opus,available:on&&hasA,tier:'frontier'},
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
export async function generate(messages:Message[],mode:ModelChoice,jsonFormat:boolean,approved:boolean,accessCode:unknown):Promise<{answer:string;model:string;provider:string}>{
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
   max_output_tokens:mode==='openai_astra'?4000:3000
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
  model:MODEL_IDS[mode],system,messages:input,max_tokens:2100
 });
 const answer=Array.isArray(result.content)?result.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text||'').join('\n'):'';
 if(!answer.trim())throw businessError(502,'Anthropic produced no usable text.');
 return {answer:answer.trim(),model:MODEL_IDS[mode],provider:'Anthropic'};
}
