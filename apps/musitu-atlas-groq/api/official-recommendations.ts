import {officialPicks,officialBenchmarkDate,classifyPrompt,pick} from './_officialBenchmarks.js';
import {catalog} from './_frontier.js';
export default function handler(req:any,res:any){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const registered=catalog();
 const catalogById=new Map(registered.map(v=>[v.id,v]));
 const q=typeof req.query?.q==='string'?req.query.q.slice(0,700):'';
 const task=typeof req.query?.task==='string'?req.query.task:classifyPrompt(q);
 const suggestion=pick(task);
 res.setHeader('Cache-Control','no-store');
 return res.status(200).json({
   methodology:'Published provider evidence + task-specific MUSITU routing policy, not an independent benchmark or proof of model superiority',
   asOf:officialBenchmarkDate,
   selectedTask:suggestion.task,
   recommendedModel:suggestion.model,
   recommendationAvailable:Boolean(catalogById.get(suggestion.model)?.available),
   recommendations:officialPicks.map(v=>({...v,available:Boolean(catalogById.get(v.model)?.available)})),
   didRunModels:false,
   didSpendCredits:false,
   automaticFallback:false,
   note:'Using a premium model still requires explicit per-request consent and the private testing gate.'
 });
}
