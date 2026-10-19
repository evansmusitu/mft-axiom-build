import {generate,choice,text,guard,body,respond,fail} from './_frontier.js';
const MAX_PROMPT=420;
export default async function handler(req:any,res:any){
 if(!guard(req,res))return;
 try{
  const data=body(req),mode=choice(data.mode);
  if(!mode)return respond(res,400,{error:'Select a valid model.'});
  const prompt=text(data.prompt,MAX_PROMPT);
  if(prompt.length<12)return respond(res,400,{error:'Provide a specific test question (12 to 420 characters).'});
  const start=Date.now();
  const result=await generate([
   {role:'system',content:'You are participating in a transparent technical evaluation. Respond to the same user request with a concise, accurate, useful answer, explicitly flag uncertainty. Do not pretend to have tools or outside facts. Limit answer to 300 words. No additional framing.'},
   {role:'user',content:prompt}
  ],mode,false,data.approved===true,data.accessCode,1100);
  const latencyMs=Date.now()-start;
  return respond(res,200,{
   model:result.model,provider:result.provider,answer:result.answer.slice(0,12000),
   latencyMs,answerWords:result.answer.trim().split(/\s+/).length,
   measuredAt:new Date().toISOString(),
   note:'Latency and length are objective metrics. Model intelligence and reliability need separate blinded evaluation.'
  });
 }catch(e){return fail(res,e);}
}