import {AUTONOMY_LEVELS,EXECUTION_MODE,MAX_DELEGATION_DEPTH,NETWORK_POLICY,SECRETS_POLICY,grantIsSubset,sha256} from '../agent_security.js';

const uniq = values => [...new Set(values)];
const array = value => Array.isArray(value) ? value : [];
const active = agent => agent?.status === 'ACTIVE' && agent?.kill_switch_engaged !== true;
const exactSubset = (candidate, parent) => { try { return grantIsSubset(candidate, parent); } catch { return false; } };
const hasAll = (haystack, needles) => array(needles).every(value => array(haystack).includes(value));

export function redirectReceiptBody(row){
  return {schema:'musitu.axiom.mission-control.redirect-receipt.browser.v1',receipt_id:row.receipt_id,project_id:row.project_id,actor_id:row.actor_id,source_agent_id:row.source_agent_id,target_agent_id:row.target_agent_id,source_grant_sha256:row.source_grant_sha256,target_grant_sha256:row.target_grant_sha256,required_tool_scopes:array(row.required_tool_scopes),required_data_scopes:array(row.required_data_scopes),confirmation_sha256:row.confirmation_sha256,project_edge_id:row.project_edge_id,execution_mode:row.execution_mode,status:row.status,external_action_executed:row.external_action_executed,network_request_performed:row.network_request_performed,plaintext_secret_access:row.plaintext_secret_access,created_at:row.created_at};
}

export function redirectEventBody(event){
  return {schema:'musitu.axiom.mission-control.event.browser.v1',event_id:event.event_id,sequence:event.sequence,kind:event.kind,actor_id:event.actor_id,project_id:event.project_id,receipt_id:event.receipt_id,source_agent_id:event.source_agent_id,target_agent_id:event.target_agent_id,payload:event.payload ?? {},created_at:event.created_at,previous_event_sha256:event.previous_event_sha256 ?? null};
}

export async function verifyMissionControlSnapshot(snapshot={}){
  const errors=[];
  const agents=array(snapshot.agents),automations=array(snapshot.automations),agentReceipts=array(snapshot.agentReceipts),redirects=array(snapshot.redirects),redirectEvents=array(snapshot.redirectEvents).slice().sort((a,b)=>Number(a.sequence)-Number(b.sequence)),projectObjects=array(snapshot.projectObjects),projectEdges=array(snapshot.projectEdges);
  const agentMap=new Map(agents.map(row=>[row.agent_id,row])),receiptMap=new Map(agentReceipts.map(row=>[row.receipt_id,row])),objectMap=new Map(projectObjects.map(row=>[row.object_id,row]));
  if(snapshot.agentIntegrity?.status!=='PASS')errors.push('agent_store_integrity');

  const activeWorkloadIds=[];
  for(const agent of agents){
    if(active(agent)){if(!agent.workload_identity_id)errors.push(`workload_identity_missing:${agent.agent_id}`);else activeWorkloadIds.push(agent.workload_identity_id);}
    if(agent.grant?.network_policy!==NETWORK_POLICY)errors.push(`network_policy:${agent.agent_id}`);
    if(agent.grant?.secrets_policy!==SECRETS_POLICY)errors.push(`secrets_policy:${agent.agent_id}`);
    if(AUTONOMY_LEVELS.indexOf(agent.grant?.autonomy)<0)errors.push(`autonomy:${agent.agent_id}`);
    if(Number(agent.usage?.runs)>Number(agent.grant?.budget?.max_runs)||Number(agent.usage?.compute_units)>Number(agent.grant?.budget?.max_compute_units))errors.push(`budget:${agent.agent_id}`);
    if((agent.status==='KILLED')!==(agent.kill_switch_engaged===true))errors.push(`kill_state:${agent.agent_id}`);
    if(agent.parent_agent_id){
      const parent=agentMap.get(agent.parent_agent_id);
      if(!parent||parent.project_id!==agent.project_id||agent.organization_id!==parent.organization_id||Number(agent.delegation_depth)!==Number(parent.delegation_depth)+1||Number(agent.delegation_depth)>MAX_DELEGATION_DEPTH||!exactSubset(agent.grant,parent.grant))errors.push(`delegation:${agent.agent_id}`);
      if(parent?.status==='KILLED'&&agent.status!=='KILLED')errors.push(`kill_cascade:${agent.agent_id}`);
    } else if(Number(agent.delegation_depth||0)!==0)errors.push(`delegation_root_depth:${agent.agent_id}`);
    if(!objectMap.has(agent.project_object_id)||objectMap.get(agent.project_object_id)?.type!=='agent')errors.push(`project_agent_object:${agent.agent_id}`);
  }
  if(uniq(activeWorkloadIds).length!==activeWorkloadIds.length)errors.push('workload_identity_duplicate');

  for(const automation of automations){
    const agent=agentMap.get(automation.agent_id);
    if(!agent||automation.project_id!==agent.project_id||!array(agent.grant?.tool_scopes).includes(automation.action_scope))errors.push(`automation_grant:${automation.automation_id}`);
    if(automation.execution_mode!==EXECUTION_MODE)errors.push(`automation_execution_mode:${automation.automation_id}`);
    if(automation.status==='ENABLED'){
      const receipt=receiptMap.get(automation.approval_receipt_id);
      if(!active(agent)||!receipt||receipt.decision!=='APPROVED'||receipt.config_sha256!==automation.config_sha256)errors.push(`automation_authority:${automation.automation_id}`);
    }
    if(automation.external_action_execution_claimed===true||automation.cloud_scheduler_claimed===true)errors.push(`automation_external_claim:${automation.automation_id}`);
  }

  let previous=null;
  for(let i=0;i<redirectEvents.length;i++){
    const event=redirectEvents[i];
    if(Number(event.sequence)!==i||event.previous_event_sha256!==previous)errors.push(`redirect_event_chain:${i}`);
    if(await sha256(redirectEventBody(event))!==event.event_sha256)errors.push(`redirect_event_hash:${i}`);
    previous=event.event_sha256;
  }

  const redirectIds=new Set(redirects.map(row=>row.receipt_id));
  for(const redirect of redirects){
    const source=agentMap.get(redirect.source_agent_id),target=agentMap.get(redirect.target_agent_id);
    if(!source||!target||source.agent_id===target.agent_id||source.project_id!==target.project_id||redirect.project_id!==source.project_id)errors.push(`redirect_agents:${redirect.receipt_id}`);
    if(!active(source)||!active(target))errors.push(`redirect_activity:${redirect.receipt_id}`);
    if(source&&target&&!exactSubset(target.grant,source.grant))errors.push(`redirect_escalation:${redirect.receipt_id}`);
    if(source&&!hasAll(source.grant?.tool_scopes,redirect.required_tool_scopes))errors.push(`redirect_source_tool_scope:${redirect.receipt_id}`);
    if(target&&!hasAll(target.grant?.tool_scopes,redirect.required_tool_scopes))errors.push(`redirect_target_tool_scope:${redirect.receipt_id}`);
    if(source&&!hasAll(source.grant?.data_scopes,redirect.required_data_scopes))errors.push(`redirect_source_data_scope:${redirect.receipt_id}`);
    if(target&&!hasAll(target.grant?.data_scopes,redirect.required_data_scopes))errors.push(`redirect_target_data_scope:${redirect.receipt_id}`);
    if(redirect.source_grant_sha256!==source?.grant_sha256||redirect.target_grant_sha256!==target?.grant_sha256)errors.push(`redirect_grant_binding:${redirect.receipt_id}`);
    if(redirect.execution_mode!==EXECUTION_MODE||redirect.status!=='RECORDED'||redirect.external_action_executed!==false||redirect.network_request_performed!==false||redirect.plaintext_secret_access!==false)errors.push(`redirect_boundary:${redirect.receipt_id}`);
    if(await sha256(redirectReceiptBody(redirect))!==redirect.receipt_sha256)errors.push(`redirect_receipt_hash:${redirect.receipt_id}`);
    const edge=projectEdges.find(row=>row.edge_id===redirect.project_edge_id);
    if(!edge||edge.project_id!==redirect.project_id||edge.from_id!==source?.project_object_id||edge.to_id!==target?.project_object_id||edge.relation!=='mission-control-redirect'||edge.provenance?.source!==`mission-control:${redirect.receipt_id}`)errors.push(`redirect_provenance:${redirect.receipt_id}`);
    if(!redirectEvents.some(event=>event.receipt_id===redirect.receipt_id&&event.kind==='agent.redirected'))errors.push(`redirect_event_missing:${redirect.receipt_id}`);
  }
  for(const edge of projectEdges.filter(row=>row.relation==='mission-control-redirect')){
    const source=String(edge.provenance?.source||''),receiptId=source.startsWith('mission-control:')?source.slice('mission-control:'.length):'';
    if(!receiptId||!redirectIds.has(receiptId))errors.push(`redirect_orphan_edge:${edge.edge_id}`);
  }
  const result={schema:'musitu.axiom.mission-control-integrity.browser.v1',status:errors.length?'FAIL':'PASS',agents:agents.length,automations:automations.length,redirects:redirects.length,redirect_events:redirectEvents.length,errors:uniq(errors).sort()};
  result.integrity_sha256=await sha256(result);return result;
}
