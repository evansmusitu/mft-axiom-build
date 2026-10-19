import {generate,choice,text,guard,body,respond,fail} from './_frontier.js';
const tasks:Record<string,{title:string;instruction:string}>={
 brief:{title:'Intelligence brief',instruction:'Generate a strategic brief with factual knowns, unverified hypotheses, three differentiated opportunities, risks, decision criteria and immediate priorities.'},
 ideas:{title:'Opportunity scanner',instruction:'Provide five customer-facing opportunities with target user, pain, hypothesis, low-cost validation, risk and measurable success threshold, plus a justified recommendation.'},
 plan:{title:'Action architect',instruction:'Build an actionable seven-day plan with dependencies, role owners, checkpoints, deliverables, risks, measurable proof and an explicit first action.'}
};
export default async function handler(req:any,res:any){
 if(!guard(req,res))return;
 try{
  const data=body(req),kind=text(data.type,30);
  const task=Object.prototype.hasOwnProperty.call(tasks,kind)?tasks[kind]:null;
  if(!task)return respond(res,400,{error:'Invalid workflow type.'});
  const mode=choice(data.mode)||'groq_quality';
  const focus=['Founder','Analyst','Creator'].includes(String(data.focus))?String(data.focus):'Founder';
  const context=text(data.context,400)||'A software company with limited budget aiming for genuine customer value.';
  const response=await generate([
   {role:'system',content:'You are an evidence-native strategy and execution analyst. Distinguish facts, inferred hypotheses and unverified assumptions. Be specific and rigorous. Give observable criteria for each deliverable. Never claim actual external actions, citations or research that have not occurred.'},
   {role:'user',content:'Focus: '+focus+'\nContext: '+context+'\nTask: '+task.instruction}
  ],mode,false,data.approved===true);
  return respond(res,200,{type:kind,title:task.title,result:response.answer,completedAt:new Date().toISOString(),model:response.model,provider:response.provider,steps:['Context prepared','Reasoning output generated','Deliverables proposed']});
 }catch(e){return fail(res,e);}
}