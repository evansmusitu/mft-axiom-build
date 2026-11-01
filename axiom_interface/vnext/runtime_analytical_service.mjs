import {evaluateAnalyticalWorkflow,ANALYTICAL_WORKFLOWS} from './analytical_workflows.mjs';
import {sha256Json,canonicalJson} from './execution_integrity.mjs';

export async function executeAnalyticalTask({objective,customer,input,governance,store=governance,emit=()=>{},idFactory,now=()=>new Date()}={}){
  if(!governance?.contract||store!==governance)throw new DOMException('one admitted execution contract required','NotAllowedError');
  await governance.assertBound({customer,objective});input=structuredClone(input);
  const input_commitment={kind:'analysis',sha256:await sha256Json(input)};
  if(governance.contract.input_commitment?.kind!=='analysis'||input_commitment.sha256!==governance.contract.input_commitment.sha256)throw new DOMException('analytical input differs from admitted Work','DataError');
  if(!ANALYTICAL_WORKFLOWS.includes(input?.workflow))throw new TypeError('unregistered analytical workflow');
  if(new TextEncoder().encode(canonicalJson(input)).length>131072)throw new TypeError('analytical input exceeds byte bound');
  if(input.workflow==='analytical-pipeline'){
    if(!Array.isArray(input.data?.stages)||input.data.stages.length<1||input.data.stages.length>20||input.data.stages.some(s=>!ANALYTICAL_WORKFLOWS.includes(s?.workflow)||s.workflow==='analytical-pipeline'))throw new TypeError('bounded registered analytical stages required');
    const draws=input.data.stages.filter(s=>s.workflow==='monte-carlo-uncertainty').reduce((n,s)=>n+(s.data?.samples??Infinity),0);
    if(!Number.isSafeInteger(draws)||draws>100000)throw new TypeError('aggregate pipeline simulation bound exceeded');
  }
  const task_id=idFactory?.()||`task_${crypto.randomUUID().replaceAll('-','')}`,request_id=`ANALYSIS-${task_id}`,started_at=now().toISOString();
  const base={schema:'musitu.axiom.runtime-task.v1',task_id,request_id,customer_id:String(customer.customer_id),objective,execution_contract:structuredClone(governance.contract),input_commitment,analysis_input:input,status:'RUNNING',started_at};
  const announce=phase=>{try{emit({schema:'musitu.axiom.runtime-task-event.v1',task_id,phase,at:now().toISOString()});}catch{}};
  await store.create(base);announce('ACCEPTED');
  try{
    const calls=[input.workflow,...(input.workflow==='analytical-pipeline'?(Array.isArray(input.data?.stages)?input.data.stages.map(s=>s.workflow):[]):[])];
    for(const operation of calls)await governance.reserve({kind:'analysis',operation});
    announce('EXECUTING');const analysis=await evaluateAnalyticalWorkflow(input),c=governance.contract,completed_at=now().toISOString();
    const execution={operation:'analysis.evaluate',request_id,http_status:200,result:analysis,receipt:{result_sha256:await sha256Json(analysis),result_commitment_verified:true,local_call_count:calls.length,compute_units:0,customer_metered:false,commitment_contract:'AXIOM_ANALYTICAL_WORKFLOW_V1'}};
    const artifact={schema:'musitu.axiom.runtime-artifact.v1',artifact_type:'ANALYTICAL_WORKFLOW',title:input.workflow,objective,project_id:c.project_id,work_id:c.work_id,agent_id:c.agent_id,contract_sha256:c.contract_sha256,analysis,citations:[],limitations:['Results replay the declared inputs; sources and factual conclusions are not independently attested.','Local call reservations are not a currency, token or billing cap.','No external action or promotion is authorized.'],synthesis_mode:'DETERMINISTIC_ANALYTICAL_WORKFLOW'};
    const payload={...base,status:'COMPLETED',completed_at,runtime:{build_id:'axiom-analytical-workflows-v1',operation_count:calls.length,fully_connected:false},sources:[],execution,artifact};
    const body={schema:'musitu.axiom.runtime-task-receipt.v1',task_id,request_id,customer_id:String(customer.customer_id),contract_sha256:c.contract_sha256,operation:execution.operation,runtime_result_sha256:execution.receipt.result_sha256,source_ids:[],source_commitments:[],artifact_sha256:await sha256Json(artifact),started_at,completed_at,status:'COMPLETED',verification_scope:analysis.verification_scope,task_payload_sha256:await sha256Json(payload)};
    const result={...payload,receipt:{...body,receipt_sha256:await sha256Json(body)}};announce('PERSISTING');await store.complete(result);announce('COMPLETED');return result;
  }catch(error){await store.fail({...base,status:'FAILED',completed_at:now().toISOString(),error_code:error.name||'AnalysisError',error_message:String(error.message||'Analysis failed').slice(0,300)});announce('FAILED');throw error;}
}
