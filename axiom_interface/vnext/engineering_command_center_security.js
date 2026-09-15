export const ECC_SCHEMA='musitu.axiom.engineering-command-center.browser.v1';
export const ECC_MODE='PROJECT_BOUND_ENGINEERING_COMMAND_CENTER_NO_SELF_CERTIFICATION';
export const ROW_STATES=Object.freeze(['IMPLEMENTED_VERIFIED','IMPLEMENTED_BLOCKED_EXTERNAL','PARTIAL','NOT_PROVEN','FAILED']);
export const QUALIFICATION_STATES=Object.freeze(['QUALIFIED','REGISTERED','EXPERIMENTAL','UNQUALIFIED']);
export const DEPLOYMENT_STAGES=Object.freeze(['BUILD','TEST','SECURITY','A11Y','VISUAL','STAGING','SMOKE','CANARY','PRODUCTION','OBSERVE','ROLLBACK']);
export const SYSTEM_GRAPH_LAYERS=Object.freeze(['CODE','RUNTIME','DATA','NETWORK','SECURITY','DEPENDENCIES','DEPLOYMENT','CLAIMS','TESTS','OWNERSHIP','INCIDENTS']);
export const SPECIALIST_ROLES=Object.freeze(['PLANNER','ARCHITECT','FRONTEND','BACKEND','DATA','TEST','SECURITY','PERFORMANCE','ACCESSIBILITY','UX_QA','INTEGRATION','DEPLOYMENT','INDEPENDENT_VERIFIER','INCIDENT']);
export const BREADTH_SURFACES=Object.freeze(['home','projects','work','agents','research','analyze','twin','artifacts','create','build','computer','live','automations','evidence','trust','developer','marketplace','enterprise']);
export const IDE_CAPABILITIES=Object.freeze(['file_tree','editor','diff','diagnostics','search','tests','preview','worktrees','bounded_terminal','checkpoint_revert','build_receipts','test_receipts']);
export const IDE_QUALIFICATION_FEATURES=Object.freeze(['project_bound_workspace','editable_files','diff_accept_reject','code_search','diagnostics','bounded_terminal','isolated_worktrees','build_and_test_receipts','sandboxed_preview','hash_bound_checkpoint_revert','agent_command_context','deep_context_and_system_graph']);
export const MATRIX_ROWS=Object.freeze([
  Object.freeze({id:'IDE',baseline:'Windsurf-class',axiom:'AXIOM project/evidence context',external:false}),
  Object.freeze({id:'agent_fleet',baseline:'local+cloud command center',axiom:'workload identities/budgets/scopes/evidence',external:true}),
  Object.freeze({id:'spaces',baseline:'sessions/PRs/files/context',axiom:'full Project Graph',external:false}),
  Object.freeze({id:'context',baseline:'fast code context',axiom:'code+runtime+data+infra+traces+requirements+evidence',external:false}),
  Object.freeze({id:'maps',baseline:'code maps',axiom:'multi-layer System Graph',external:false}),
  Object.freeze({id:'terminal',baseline:'manual/automatic policy',axiom:'independent S0-S5 authorization',external:false}),
  Object.freeze({id:'checkpoints',baseline:'code revert',axiom:'complete engineering state',external:false}),
  Object.freeze({id:'preview',baseline:'browser preview',axiom:'Product Reality Lab',external:false}),
  Object.freeze({id:'cloud_handoff',baseline:'background isolated agent',axiom:'governed execution fabric',external:true}),
  Object.freeze({id:'models',baseline:'multi-model',axiom:'qualification/cost/privacy router',external:false}),
  Object.freeze({id:'deployment',baseline:'app deploy',axiom:'staging/canary/prod/rollback/evidence',external:true}),
  Object.freeze({id:'enterprise',baseline:'SSO/RBAC/admin',axiom:'agent/data/network/action policy graph',external:true}),
  Object.freeze({id:'security',baseline:'enterprise controls',axiom:'independent security authority+red team',external:true}),
  Object.freeze({id:'breadth',baseline:'must not narrow AXIOM',axiom:'retain Research/Analyze/Twins/Artifacts/Computer/Live/Governance',external:false}),
]);
export const MATRIX_ROW_IDS=Object.freeze(MATRIX_ROWS.map(row=>row.id));
const SECRET_RX=/(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)["']?\s*[:=]|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{10,}|\bbearer\s+[A-Za-z0-9._~-]{10,}/i;
export const clone=value=>structuredClone(value);
export const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
export const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
export async function sha256(value){const bytes=new TextEncoder().encode(canonical(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function rejectSecretLike(value,label='value'){if(SECRET_RX.test(typeof value==='string'?value:canonical(value)))throw new DOMException(`${label} contains plaintext secret-like material`,'SecurityError');}
export function requireDigest(value,label='digest'){const out=clean(value,64).toLowerCase();if(!/^[0-9a-f]{64}$/.test(out))throw new TypeError(`${label} must be sha256`);return out;}
export function matrixRow(id){const key=clean(id,80);const row=MATRIX_ROWS.find(item=>item.id===key);if(!row)throw new TypeError(`unknown acceptance row: ${key}`);return row;}
export function normalizeIndependentEvidence(raw,{required=false,label='external evidence'}={}){
  if(raw==null){if(required)throw new DOMException(`${label} required`,'SecurityError');return null;}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError(`${label} must be object`);
  const status=clean(raw.status,40).toUpperCase(),verifier_id=clean(raw.verifier_id,180),source_id=clean(raw.source_id,240),evidence_sha256=requireDigest(raw.evidence_sha256,`${label} evidence digest`),captured_at=clean(raw.captured_at,80);
  if(status!=='VERIFIED'||!verifier_id||!source_id||!captured_at||!Number.isFinite(Date.parse(captured_at)))throw new DOMException(`${label} must be independently VERIFIED with source and timestamp`,'SecurityError');
  rejectSecretLike(raw,label);
  return {status,verifier_id,source_id,evidence_sha256,captured_at:new Date(captured_at).toISOString()};
}
export async function normalizeRowEvidence(raw,{projectId}={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('matrix row evidence required');
  const row=matrixRow(raw.row_id),project_id=clean(raw.project_id,180),state=clean(raw.state,60).toUpperCase(),evidence_refs=[...new Set((raw.evidence_refs||[]).map(value=>clean(value,240)).filter(Boolean))].sort();
  if(projectId&&project_id!==projectId)throw new DOMException('cross-project matrix evidence blocked','SecurityError');
  if(!project_id)throw new TypeError('matrix evidence project id required');
  if(!ROW_STATES.includes(state))throw new TypeError('invalid matrix evidence state');
  const external_qualification=normalizeIndependentEvidence(raw.external_qualification,{required:false,label:`${row.id} external qualification`});
  if(row.external&&state==='IMPLEMENTED_VERIFIED'&&!external_qualification)throw new DOMException(`${row.id} cannot self-promote without independent external qualification`,'SecurityError');
  if(!row.external&&external_qualification&&raw.external_qualification?.status!=='VERIFIED')throw new DOMException('invalid independent evidence','SecurityError');
  const body={schema:'musitu.axiom.engineering-acceptance-row.browser.v1',row_id:row.id,project_id,state,evidence_refs,external_qualification,updated_at:clean(raw.updated_at||new Date().toISOString(),80),claim_boundary:clean(raw.claim_boundary||'IMPLEMENTATION_SCOPE_ONLY_NO_PRODUCTION_OR_SUPERIORITY_CLAIM',200)};
  rejectSecretLike(body,'matrix evidence');return {...body,row_sha256:await sha256(body)};
}
export function rowSatisfied(row){return row?.state==='IMPLEMENTED_VERIFIED';}
export function requireBreadth(routes=[]){const normalized=new Set(routes.map(value=>clean(value,80).toLowerCase()).filter(Boolean));const missing=BREADTH_SURFACES.filter(route=>!normalized.has(route));return {status:missing.length?'FAIL':'PASS',missing,routes:[...normalized].sort(),home_outcome_first:normalized.has('home')};}
export function normalizeCheckpointComponent(raw,label){
  if(raw==null)return {state:'NOT_PROVEN',sha256:null};
  if(typeof raw==='string')return {state:'PRESENT',sha256:requireDigest(raw,label)};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError(`${label} invalid`);
  const state=clean(raw.state,32).toUpperCase();if(!['PRESENT','NOT_PROVEN','NOT_APPLICABLE'].includes(state))throw new TypeError(`${label} state invalid`);
  const digest=state==='PRESENT'?requireDigest(raw.sha256,label):null;return {state,sha256:digest};
}
export async function sealCheckpoint(raw={}){
  const project_id=clean(raw.project_id,180),checkpoint_id=clean(raw.checkpoint_id,180),worktree_id=clean(raw.worktree_id,180),created_at=clean(raw.created_at||new Date().toISOString(),80);if(!project_id||!checkpoint_id||!worktree_id)throw new TypeError('project checkpoint and worktree ids required');
  const components={};for(const key of ['git_tree','dependencies','migration_state','environment','plan','acceptance','tests','browser_snapshot','security','artifacts','evidence'])components[key]=normalizeCheckpointComponent(raw.components?.[key],`checkpoint ${key}`);
  const body={schema:'musitu.axiom.engineering-checkpoint.browser.v1',project_id,checkpoint_id,worktree_id,components,created_at,production_state_mutated:false,authority_effect:'NONE'};rejectSecretLike(body,'checkpoint');return {...body,checkpoint_sha256:await sha256(body)};
}
export async function verifyCheckpoint(row={}){try{const body=Object.fromEntries(Object.entries(row).filter(([key])=>key!=='checkpoint_sha256'));if(await sha256(body)!==row.checkpoint_sha256)return {status:'FAIL',errors:['checkpoint_hash']};if(row.production_state_mutated!==false||row.authority_effect!=='NONE')return {status:'FAIL',errors:['checkpoint_authority']};for(const [key,value] of Object.entries(row.components||{}))if(value.state==='PRESENT'&&!/^[0-9a-f]{64}$/.test(value.sha256||''))return {status:'FAIL',errors:[`checkpoint_component:${key}`]};return {status:'PASS',errors:[]};}catch{return {status:'FAIL',errors:['checkpoint_invalid']};}}
export function normalizeModelCandidate(raw={}){const id=clean(raw.id,160),qualification=clean(raw.qualification,40).toUpperCase();if(!id||!QUALIFICATION_STATES.includes(qualification))throw new TypeError('model candidate id and qualification required');const metric=(name,{min=0,max=1}={})=>{const n=Number(raw[name]);if(!Number.isFinite(n)||n<min||n>max)throw new TypeError(`model ${name} invalid`);return n;};return {id,qualification,quality:metric('quality'),reliability:metric('reliability'),latency:metric('latency'),cost:metric('cost'),privacy:metric('privacy'),context:metric('context'),tool_support:metric('tool_support'),historical_success:metric('historical_success')};}
export function routeModel(candidates=[],weights={}){const rows=candidates.map(normalizeModelCandidate),eligible=rows.filter(row=>row.qualification==='QUALIFIED');if(!eligible.length)return {status:'BLOCKED',reason:'NO_QUALIFIED_MODEL',selected:null,candidates:rows};const w={quality:Number(weights.quality??2),reliability:Number(weights.reliability??2),latency:Number(weights.latency??1),cost:Number(weights.cost??1),privacy:Number(weights.privacy??2),context:Number(weights.context??1),tool_support:Number(weights.tool_support??1),historical_success:Number(weights.historical_success??1)};const score=row=>row.quality*w.quality+row.reliability*w.reliability+(1-row.latency)*w.latency+(1-row.cost)*w.cost+row.privacy*w.privacy+row.context*w.context+row.tool_support*w.tool_support+row.historical_success*w.historical_success;const ranked=eligible.map(row=>({...row,score:score(row)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));return {status:'ROUTED',selected:ranked[0],candidates:rows,unqualified_execution_allowed:false};}
export function validateDeploymentHistory(history=[]){const rows=Array.isArray(history)?history:[],errors=[];let last=-1;for(let i=0;i<rows.length;i++){const stage=clean(rows[i]?.stage,40).toUpperCase(),index=DEPLOYMENT_STAGES.indexOf(stage);if(index<0){errors.push(`unknown_stage:${i}`);continue;}if(i===0&&index!==0)errors.push('deployment_must_start_build');if(index!==last+1)errors.push(`deployment_skip:${i}:${stage}`);if(rows[i]?.evidence_sha256&&!/^[0-9a-f]{64}$/.test(clean(rows[i].evidence_sha256,64)))errors.push(`deployment_evidence:${i}`);last=index;}return {status:errors.length?'FAIL':'PASS',errors,highest_stage:last>=0?DEPLOYMENT_STAGES[last]:null,production_reached:last>=DEPLOYMENT_STAGES.indexOf('PRODUCTION')};}
