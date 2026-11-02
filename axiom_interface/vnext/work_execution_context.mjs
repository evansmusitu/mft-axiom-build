import {normalizeExecutionContext} from './execution_contract.mjs';

export function workExecutionContext(state,objective){
  const work=(state.work||[]).find(w=>w.contract_id===state.activeWorkId),controls={...state.controls};
  if(work){
    if(work.outcome!==objective)throw new TypeError('Use the selected Work objective or create a new Work contract.');
    if(!work.integrity_verified)throw new TypeError('Verify the selected Work contract before execution.');
    const c=work.constraints||{},stricter=(a,b,order)=>{
      if(!order.includes(a)||!order.includes(b))throw new TypeError('This Work policy requires an explicit supported execution policy.');
      return order[Math.min(order.indexOf(a),order.indexOf(b))];
    };
    controls.autonomy=stricter(c.autonomy,controls.autonomy,['Preview only','Approval each action','Policy-bounded']);
    controls.privacy=stricter(c.privacy,controls.privacy,['Private','Project','Organization']);
    controls.evidence=stricter(c.evidence,controls.evidence,['Independent validation','Verified','Standard']);
    controls.approval=c.approval;
    if(c.deadline){const time=new Date(c.deadline);if(!Number.isFinite(time.getTime()))throw new TypeError('The selected Work deadline is invalid.');controls.deadline=time.toISOString();}
    if(c.compute_budget!==null&&c.compute_budget!==undefined)controls.budget=Math.min(Number(c.compute_budget),controls.budget===''?1:Number(controls.budget));
  }
  return normalizeExecutionContext({project_id:state.activeProjectId||'project_default',...(work?{work_id:work.contract_id,success_criteria:[...work.success_criteria]}:{}),agent_id:'axiom-runtime-v1',controls});
}
