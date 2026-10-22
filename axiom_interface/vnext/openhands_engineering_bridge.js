/** OpenHands historical evidence → Engineering Command Center, with no authority promotion. */
import {clean} from './engineering_command_center_security.js';

const REPO='evansmusitu/mft-axiom-build';
const HEX40=/^[0-9a-f]{40}$/;
const ALLOWED=new Set(['role','run_id','head_sha','repository','status','conclusion']);
const ROLE_ORDER=['native_live','native_worker_local','durable_workerd'];
export const OPENHANDS_VERIFIED_RUN_REFERENCES=Object.freeze([
  Object.freeze({role:'native_live',run_id:38272446481,head_sha:'704e36801628524744917015219f5bc9e0d9c412'}),
  Object.freeze({role:'native_worker_local',run_id:38425624156,head_sha:'af798a25346b9e08c4f25cfb90106f251a8ebab3'}),
  Object.freeze({role:'durable_workerd',run_id:38443675387,head_sha:'cef433d9053f7d9365db3dded6b965f642a7cc88'}),
]);

function validate(project_id,runs){
  const project=clean(project_id,180);
  if(!project||project!==project_id)throw new TypeError('project id required');
  if(!Array.isArray(runs)||runs.length!==ROLE_ORDER.length)throw new TypeError('three exact GitHub run receipts required');
  const seen=new Set();
  const statuses={};
  for(const run of runs){
    if(!run||Object.getPrototypeOf(run)!==Object.prototype||Object.keys(run).some(k=>!ALLOWED.has(k)))throw new TypeError('untrusted/unsupported receipt field');
    const expected=OPENHANDS_VERIFIED_RUN_REFERENCES.find(x=>x.role===run.role);
    if(!expected||seen.has(run.role)||run.run_id!==expected.run_id||run.head_sha!==expected.head_sha||!HEX40.test(run.head_sha)||run.repository!==REPO)
      throw new TypeError('invalid GitHub qualification provenance');
    if(!['completed','queued','in_progress'].includes(run.status)||!['success','failure','cancelled',null].includes(run.conclusion))throw new TypeError('invalid workflow status');
    seen.add(run.role);
    statuses[run.role]=run.status==='completed'&&run.conclusion==='success';
  }
  if(ROLE_ORDER.some(k=>!seen.has(k)))throw new TypeError('missing source provenance');
  return {project,statuses};
}

export function summarizeOpenHandsEngineering({project_id,runs}={}){
  const {project,statuses}=validate(project_id,runs);
  return Object.freeze({schema:'musitu.axiom.openhands-ecc-evidence.s0.v1',project_id:project,
    source:'HISTORICAL_GITHUB_ACTIONS_RUN_METADATA_NOT_REALTIME_RUNTIME',
    existing_live_native_agents:statuses.native_live?'HISTORICAL_CI_PASS_BOUNDED':'NOT_PROVEN',
    native_durable_workerd:statuses.native_worker_local&&statuses.durable_workerd?'HISTORICAL_CI_PASS_BOUNDED':'NOT_PROVEN',
    end_to_end_s3_engineering:'NOT_PROVEN',
    persistent_cloud_or_multi_region_agent:'NOT_PROVEN',
    local_mission_durability:'LOCAL_S0_TESTS_ONLY',
    independent_global_antirollback:'FAILED_IN_SYNTHETIC_ATTACK',
    external_verifier:'NOT_CERTIFIED',
    account_wide_zero_cost:'NOT_VERIFIED',
    external_action_executed:'NOT_PROVEN_BY_THIS_RECORD',
    production_authority:false,provider_dispatch_allowed:false,
    mission_control_rows:['agent_fleet','cloud_handoff'],
    evidence_refs:OPENHANDS_VERIFIED_RUN_REFERENCES.map(r=>`github-actions:${REPO}:${r.run_id}:${r.head_sha}`),
  });
}

/** Records bounded historical refs in existing ECC evidence storage without authorizing a worker. */
export async function registerOpenHandsEvidence({ecc,project_id,actor_id,runs}={}){
  const report=summarizeOpenHandsEngineering({project_id,runs});
  const actor=clean(actor_id,180);
  if(!actor||actor!==actor_id||typeof ecc?.setMatrixEvidence!=='function')throw new TypeError('governed ECC and actor required');
  // Do not downgrade a previously independently qualified row or overwrite its audit record.
  if(typeof ecc.snapshot==='function'){
    const existing=await ecc.snapshot(project_id,actor_id);
    if(existing.matrix?.some(x=>report.mission_control_rows.includes(x.row_id)&&x.state==='IMPLEMENTED_VERIFIED'))throw new DOMException('external verified row cannot be overwritten by historical S0 refs','SecurityError');
  }
  for(const row_id of report.mission_control_rows){
    await ecc.setMatrixEvidence(project_id,actor_id,{row_id,state:'IMPLEMENTED_BLOCKED_EXTERNAL',
      evidence_refs:report.evidence_refs,external_qualification:null,
      claim_boundary:'HISTORICAL_OPENHANDS_CI_ONLY_S3_AND_PRODUCTION_UNPROVEN'});
  }
  return report;
}
