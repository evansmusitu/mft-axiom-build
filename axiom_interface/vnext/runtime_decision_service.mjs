import {evaluateDecision} from './decision_analysis.mjs';
import {sha256Json} from './execution_integrity.mjs';

// A deterministic recommendation workflow. Probabilities and utilities remain
// declared assumptions; this adapter cannot authorize an external action.
export async function executeDecisionTask({objective,customer,problem,governance,store=governance,emit=()=>{},idFactory,now=()=>new Date()}={}){
  if(!governance?.contract||store!==governance)throw new DOMException('one admitted execution contract required','NotAllowedError');
  await governance.assertBound({customer,objective});
  problem=structuredClone(problem);
  const input_commitment={kind:'decision',sha256:await sha256Json(problem)};
  if(governance.contract.input_commitment?.sha256!==input_commitment.sha256||governance.contract.input_commitment?.kind!=='decision')throw new DOMException('decision input differs from admitted Work','DataError');
  const supplied=idFactory?.(),id=supplied||`task_${crypto.randomUUID().replaceAll('-','')}`;
  const rid=`MUSITU-DECISION-${id.replace(/[^A-Za-z0-9]/g,'').slice(0,48).toUpperCase()}`,startedAt=now().toISOString();
  const base={schema:'musitu.axiom.runtime-task.v1',task_id:id,request_id:rid,customer_id:String(customer.customer_id),objective,execution_contract:structuredClone(governance.contract),input_commitment,decision_input:problem,status:'RUNNING',started_at:startedAt};
  const announce=phase=>{try{emit({schema:'musitu.axiom.runtime-task-event.v1',task_id:id,phase,at:now().toISOString()});}catch{}};
  await store.create(base);announce('ACCEPTED');
  try{
    await governance.reserve({kind:'decision'});announce('EXECUTING');
    const decision=await evaluateDecision(problem),c=governance.contract;
    const execution={operation:'decision.evaluate',request_id:rid,http_status:200,result:decision,receipt:{result_sha256:await sha256Json(decision),result_commitment_verified:true,compute_units:0,customer_metered:false,commitment_contract:'AXIOM_LOCAL_DECISION_V1'}};
    const artifact={schema:'musitu.axiom.runtime-artifact.v1',artifact_type:'DECISION_ANALYSIS',title:'Decision tradeoffs',objective,project_id:c.project_id,work_id:c.work_id,agent_id:c.agent_id,contract_sha256:c.contract_sha256,
      summary:`${decision.recommended_action} has the highest expected utility under the supplied assumptions.`,findings:[`Expected utilities: ${JSON.stringify(decision.expected_utilities)}`,`Value of perfect information: ${decision.evpi} ${problem.utility_unit}`,`Minimax regret: ${JSON.stringify(decision.minimax_regret)}`],citations:[],limitations:['Probabilities and utilities are supplied assumptions; source evidence has not been independently verified.','This recommendation does not authorize an external action.'],decision,synthesis_mode:'DETERMINISTIC_DECISION_ANALYSIS'};
    const completedAt=now().toISOString(),body={schema:'musitu.axiom.runtime-task-receipt.v1',task_id:id,request_id:rid,customer_id:String(customer.customer_id),contract_sha256:c.contract_sha256,operation:'decision.evaluate',runtime_result_sha256:execution.receipt.result_sha256,source_ids:[],source_commitments:[],artifact_sha256:await sha256Json(artifact),started_at:startedAt,completed_at:completedAt,status:'COMPLETED',verification_scope:'DECLARED_DECISION_MODEL_AND_CONTENT_COMMITMENTS_ONLY'};
    const receipt={...body,receipt_sha256:await sha256Json(body)},result={...base,status:'COMPLETED',completed_at:completedAt,runtime:{build_id:'axiom-decision-analysis-v1',operation_count:1,fully_connected:false},sources:[],execution,artifact,receipt};
    announce('PERSISTING');await store.complete(result);announce('COMPLETED');return result;
  }catch(error){await store.fail({...base,status:'FAILED',completed_at:now().toISOString(),error_code:error.name||'DecisionError',error_message:String(error.message||'Decision failed').slice(0,300)});announce('FAILED');throw error;}
}
