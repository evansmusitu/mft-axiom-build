import {generate,choice,text,guard,body,respond,fail} from '../_frontier.js';
export default async function handler(req:any,res:any){
 if(!guard(req,res))return;
 try{
  const data=body(req),goal=text(data.goal,250);
  if(goal.length<10)return respond(res,400,{error:'Describe your goal using at least 10 characters.'});
  const mode=choice(data.mode)||'groq_quality';
  const focus=['Founder','Analyst','Creator'].includes(String(data.focus))?String(data.focus):'Founder';
  const context=text(data.background,600);
  const response=await generate([
   {role:'system',content:'You are a mission architect producing plans that can be evaluated and evidenced. Output strictly one valid JSON object with string fields title, summary and steps array of four to six objects {title,detail,success}. Every success criterion is specific and objectively checkable. Label unverified dependencies and never invent real-world completion.'},
   {role:'user',content:'Focus: '+focus+'. Goal: '+goal+'. Context: '+context+'. Return only valid JSON.'}
  ],mode,true,data.approved===true);
  let parsed:{title?:unknown;summary?:unknown;steps?:unknown};
  try{parsed=JSON.parse(response.answer);}catch{return respond(res,502,{error:'Model did not produce a valid structured plan. Retry.'});}
  const steps=(Array.isArray(parsed.steps)?parsed.steps:[])
   .filter((x:any)=>x&&typeof x==='object')
   .map((x:any)=>({title:text(x.title,110),detail:text(x.detail,350),success:text(x.success,200)}))
   .filter((x:any)=>x.title&&x.detail&&x.success).slice(0,8);
  if(steps.length<3)return respond(res,502,{error:'Model returned too few valid milestones. Retry.'});
  return respond(res,200,{title:text(parsed.title,100)||goal,summary:text(parsed.summary,350),steps,model:response.model,provider:response.provider});
 }catch(e){return fail(res,e);}
}