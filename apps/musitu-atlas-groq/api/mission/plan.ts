import {infer,text,guard,body,respond,fail} from '../_groq';
export default async function handler(req:any,res:any){
 if(!guard(req,res))return;
 try{
  const data=body(req),goal=text(data.goal,250);
  if(goal.length<10)return respond(res,400,{error:'Describe your goal using at least 10 characters.'});
  const focus=['Founder','Analyst','Creator'].includes(String(data.focus))?String(data.focus):'Founder';
  const context=text(data.background,600);
  const result=await infer([
   {role:'system',content:'You are a mission planner. Only return valid JSON with title (string), summary (string), steps (array of four to six objects each with string title, detail and success). Do not suggest that any actions were already performed. Include measurable definition-of-done per step.'},
   {role:'user',content:'Make a practical goal plan for a '+focus+'. Goal: '+goal+' Background: '+context+'. Return only JSON.'}
  ],'quality',true);
  const parsed=JSON.parse(result) as {title?:unknown;summary?:unknown;steps?:unknown};
  const steps=(Array.isArray(parsed.steps)?parsed.steps:[])
   .filter((x:any)=>x&&typeof x==='object').map((x:any)=>({
     title:text(x.title,110),detail:text(x.detail,350),success:text(x.success,200)
   })).filter((x:any)=>x.title&&x.detail&&x.success).slice(0,8);
  if(!steps.length)return respond(res,502,{error:'No valid action steps were generated.'});
  return respond(res,200,{title:text(parsed.title,100)||goal,summary:text(parsed.summary,350),steps});
 }catch(e){return fail(res,e);}
}