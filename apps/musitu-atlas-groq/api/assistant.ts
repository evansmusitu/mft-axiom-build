import {infer,text,guard,body,respond,fail} from './_groq';
export default async function handler(req:any,res:any){
 if(!guard(req,res))return;
 try{
  const data=body(req);
  const question=text(data.question,2000);
  if(!question)return respond(res,400,{error:'A question is required.'});
  const focus=['Founder','Analyst','Creator'].includes(String(data.focus))?String(data.focus):'Founder';
  const model=data.mode==='quality'?'quality':'fast';
  const history=Array.isArray(data.history)?data.history.slice(-8).filter((m:any)=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')
    .map((m:any)=>({role:m.role,content:text(m.text,2000)})):[];
  const answer=await infer([
   {role:'system',content:'You are MUSITU ATLAS, a practical AI collaborator for a '+focus+'. Give useful concise answers. Distinguish facts from assumptions, do not invent live data, and never pretend you have used tools or performed actions.'},
   ...(history.length?history:[{role:'user',content:question}])
  ],model);
  return respond(res,200,{answer,model:model==='fast'?'openai/gpt-oss-20b':'openai/gpt-oss-120b'});
 }catch(e){return fail(res,e);}
}