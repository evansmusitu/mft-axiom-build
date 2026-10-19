import {generate,choice,respond,text,guard,body,fail} from './_frontier.js';
export default async function handler(req:any,res:any){
 if(!guard(req,res))return;
 try{
  const data=body(req),question=text(data.question,2000);
  if(!question)return respond(res,400,{error:'A question is required.'});
  const mode=choice(data.mode)||'groq_quality';
  const focus=['Founder','Analyst','Creator'].includes(String(data.focus))?String(data.focus):'Founder';
  const history=Array.isArray(data.history)?data.history.slice(-8)
   .filter((m:any)=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')
   .map((m:any)=>({role:m.role as 'user'|'assistant',content:text(m.text,2000)})):[];
  const response=await generate([
   {role:'system',content:'You are MUSITU ATLAS, an evidence-oriented execution intelligence system serving a '+focus+'. Clarify the true goal, reason carefully, distinguish direct evidence from assumptions, and suggest verifiable next steps. Do not invent citations, data, account access, or completed real-world actions. Strive for a higher standard than generic chat: specific, actionable, candid and precise.'},
   ...(history.length?history:[{role:'user' as const,content:question}])
  ],mode,false,data.approved===true,data.accessCode);
  return respond(res,200,{answer:response.answer,model:response.model,provider:response.provider});
 }catch(e){return fail(res,e);}
}