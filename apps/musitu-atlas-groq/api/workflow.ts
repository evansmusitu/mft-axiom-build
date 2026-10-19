import {infer,text,guard,body,respond,fail} from './_groq.js';
const tasks:Record<string,{title:string;instruction:string}>={
 brief:{title:'Intelligence brief',instruction:'Generate a strategic situation brief with three key signals, three opportunities, risks, open questions and near-term actions.'},
 ideas:{title:'Opportunity scanner',instruction:'Generate five useful differentiated opportunities, audience, pain, validation experiment, drawbacks, and strongest recommendation.'},
 plan:{title:'Action architect',instruction:'Produce a practical prioritized 7-day plan with milestones, ownership roles, dependencies, deliverables and measurable completion criteria.'}
};
export default async function handler(req:any,res:any){
 if(!guard(req,res))return;
 try{
  const data=body(req),kind=text(data.type,30);
  const task=Object.prototype.hasOwnProperty.call(tasks,kind)?tasks[kind]:null;
  if(!task)return respond(res,400,{error:'Invalid workflow type.'});
  const focus=['Founder','Analyst','Creator'].includes(String(data.focus))?String(data.focus):'Founder';
  const context=text(data.context,400)||'A growing software company seeking useful customer outcomes.';
  const result=await infer([
   {role:'system',content:'You are a rigorous business and execution analyst. Use numbered sections and transparent assumptions, never claim tasks were actually performed, and do not fabricate current metrics.'},
   {role:'user',content:'Focus: '+focus+'\nContext: '+context+'\nTask: '+task.instruction}
  ],'quality');
  return respond(res,200,{type:kind,title:task.title,result,completedAt:new Date().toISOString(),steps:['Context prepared','AI analysis generated','Output composed']});
 }catch(e){return fail(res,e);}
}