const RISK_ORDER=Object.freeze({S0:0,S1:1,S2:2,S3:3,S4:4,S5:5});
const OFFLINE_ACTIONS=Object.freeze({
  LOCAL_DRAFT_SAVE:Object.freeze({scope:'mobile.local.draft',fields:Object.freeze(['project_id','draft_id','content','updated_at'])}),
  SUPERVISION_NOTE:Object.freeze({scope:'mobile.supervision.note',fields:Object.freeze(['work_id','note'])}),
  APPROVAL_RESPONSE_DRAFT:Object.freeze({scope:'mobile.approval.draft',fields:Object.freeze(['approval_id','decision','rationale'])}),
  AGENT_STEER_DRAFT:Object.freeze({scope:'mobile.agent-steer.draft',fields:Object.freeze(['work_id','instruction'])}),
  INTERRUPTION_REQUEST_DRAFT:Object.freeze({scope:'mobile.interruption.draft',fields:Object.freeze(['work_id','reason'])})
});
const DEVICE_SCENARIOS=Object.freeze(['PHONE_PORTRAIT','TABLET_PORTRAIT','OFFLINE_RELOAD','RECONNECT_REPLAY']);
const PREEXISTING_PHONE_SCENARIOS=Object.freeze(['PHONE_PORTRAIT','OFFLINE_RELOAD','RECONNECT_REPLAY']);
const PREEXISTING_PHONE_EVIDENCE=Object.freeze({
  status:'EVIDENCED',
  evidence_sha256:'03478e2f17eb82f68417c826e86c29a1fed716d57d5fbe1e81f4d5f1c49a42f6',
  source_candidate:'e88a14e12b68fffb95e2dff59493c2ef15e11d11',
  authority_handoff_sha256:'75a0d2a51ef6351c06809caae509afd681c04b29763fb6e30170234eaf414669',
  verified_scenarios:PREEXISTING_PHONE_SCENARIOS
});
const SECRET_KEY=/(authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
const SECRET_VALUE=/(?:\bBearer\s+[A-Za-z0-9._~+\/-]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr)[-_][A-Za-z0-9_-]{12,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{20,})/i;

const clean=(value,limit=4000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);
const unique=value=>[...new Set((Array.isArray(value)?value:[]).map(item=>clean(item,240)).filter(Boolean))].sort();
const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
const randomId=prefix=>`${prefix}:${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
};
const canonical=value=>JSON.stringify(stable(value));
const bytes=value=>new TextEncoder().encode(value);

export class FA16BoundaryError extends Error{
  constructor(message,code='FA16_BOUNDARY'){super(message);this.name='FA16BoundaryError';this.code=code;}
}

export const FA16_BOUNDARY=Object.freeze({
  phase:'FA-16',
  scope:'MOBILE_PWA_OFFLINE_RECONNECT',
  mobileMode:'SUPERVISION_FIRST',
  offlineQueueMaxRisk:'S1',
  externalOfflineExecution:false,
  serviceWorkerSensitiveDataCaching:false,
  realDeviceStatus:'REAL_PHONE_EVIDENCED_TABLET_PENDING_CUSTOMER',
  realPhoneEvidence:'EVIDENCED',
  tabletEvidence:'DEFERRED_PENDING_FUTURE_CUSTOMER',
  phoneEvidenceSha256:PREEXISTING_PHONE_EVIDENCE.evidence_sha256,
  phaseProgressionAuthorized:true,
  phaseExitEarned:false,
  productionAuthority:false,
  legacyPhase14Unchanged:true,
  wolframParity:'NOT_CERTIFIED',
  superiority:'NOT_CERTIFIED'
});

export async function sha256(value){
  const subtle=globalThis.crypto?.subtle;
  if(!subtle)throw new FA16BoundaryError('Web Crypto SHA-256 is required','CRYPTO_UNAVAILABLE');
  const digest=await subtle.digest('SHA-256',bytes(typeof value==='string'?value:canonical(value)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function assertNoSecrets(value,path='payload'){
  if(Array.isArray(value)){value.forEach((item,index)=>assertNoSecrets(item,`${path}[${index}]`));return;}
  if(value&&typeof value==='object'){
    for(const [key,item] of Object.entries(value)){
      if(SECRET_KEY.test(key))throw new FA16BoundaryError(`Secret-bearing field rejected at ${path}.${key}`,'SECRET_FIELD');
      assertNoSecrets(item,`${path}.${key}`);
    }
    return;
  }
  if(typeof value==='string'&&SECRET_VALUE.test(value))throw new FA16BoundaryError(`Secret-like value rejected at ${path}`,'SECRET_VALUE');
}

function normalizePayload(kind,payload){
  const contract=OFFLINE_ACTIONS[kind];
  if(!contract)throw new FA16BoundaryError(`Offline action ${kind||'<empty>'} is not allow-listed`,'ACTION_NOT_ALLOWLISTED');
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new FA16BoundaryError('Offline payload must be an object','PAYLOAD_TYPE');
  const extra=Object.keys(payload).filter(key=>!contract.fields.includes(key));
  if(extra.length)throw new FA16BoundaryError(`Unsupported offline payload fields: ${extra.sort().join(', ')}`,'PAYLOAD_FIELDS');
  assertNoSecrets(payload);
  const normalized={};
  for(const field of contract.fields){
    if(payload[field]!==undefined)normalized[field]=clean(payload[field],field==='content'||field==='note'||field==='instruction'||field==='rationale'?12000:320);
  }
  if(!Object.keys(normalized).length)throw new FA16BoundaryError('Offline payload is empty','PAYLOAD_EMPTY');
  return Object.freeze(normalized);
}

function normalizeAuthority(input={}){
  const max=clean(input.max_risk_class||'S1',2).toUpperCase();
  if(!(max in RISK_ORDER)||RISK_ORDER[max]>RISK_ORDER.S1)throw new FA16BoundaryError('Offline authority may not exceed S1','AUTHORITY_RISK');
  const scopes=unique(input.scopes);
  if(!scopes.length)throw new FA16BoundaryError('Frozen offline authority scopes are required','AUTHORITY_SCOPE');
  return Object.freeze({
    actor_id:clean(input.actor_id||'local-user',180),
    project_id:clean(input.project_id||'',180),
    scopes:Object.freeze(scopes),
    max_risk_class:max,
    network_allowlist:Object.freeze([]),
    public_effect:false,
    destructive:false,
    external_execution:false
  });
}

function recordCore(record){
  return {
    schema:record.schema,
    action_id:record.action_id,
    idempotency_key:record.idempotency_key,
    kind:record.kind,
    scope:record.scope,
    risk_class:record.risk_class,
    payload:record.payload,
    authority_snapshot:record.authority_snapshot,
    authority_sha256:record.authority_sha256,
    created_at:record.created_at,
    expires_at:record.expires_at,
    external:record.external,
    public_effect:record.public_effect,
    destructive:record.destructive,
    execution_mode:record.execution_mode
  };
}

export class FA16OfflineQueue{
  constructor({clock=()=>new Date(),idFactory=randomId}={}){this.clock=clock;this.idFactory=idFactory;this.records=new Map();this.receipts=new Map();}

  async prepare(input={}){
    const kind=clean(input.kind,80).toUpperCase();
    const contract=OFFLINE_ACTIONS[kind];
    if(!contract)throw new FA16BoundaryError(`Offline action ${kind||'<empty>'} is not allow-listed`,'ACTION_NOT_ALLOWLISTED');
    const risk=clean(input.risk_class||'S1',2).toUpperCase();
    if(!(risk in RISK_ORDER)||RISK_ORDER[risk]>RISK_ORDER.S1)throw new FA16BoundaryError('Offline queue accepts only S0/S1 local actions','RISK_NOT_OFFLINE_SAFE');
    if(input.external||input.public_effect||input.destructive)throw new FA16BoundaryError('External, public or destructive work cannot enter the offline queue','CONSEQUENTIAL_OFFLINE_ACTION');
    const authority=normalizeAuthority(input.authority_snapshot);
    if(!authority.scopes.includes(contract.scope))throw new FA16BoundaryError(`Frozen authority does not include ${contract.scope}`,'SCOPE_NOT_GRANTED');
    const payload=normalizePayload(kind,input.payload);
    const now=this.clock();
    const createdAt=now instanceof Date?now:new Date(now);
    const ttl=Math.min(Math.max(Number(input.ttl_ms)||86400000,60000),604800000);
    const actionId=clean(input.action_id||this.idFactory('offline-action'),180);
    const draft={
      schema:'musitu.axiom.fa16.offline-action.v1',action_id:actionId,
      idempotency_key:clean(input.idempotency_key||actionId,180),kind,scope:contract.scope,risk_class:risk,payload,
      authority_snapshot:authority,authority_sha256:await sha256(authority),created_at:createdAt.toISOString(),
      expires_at:new Date(createdAt.getTime()+ttl).toISOString(),external:false,public_effect:false,destructive:false,
      execution_mode:'LOCAL_ONLY_AFTER_POLICY_REVALIDATION'
    };
    const previewSha=await sha256(draft);
    return Object.freeze({...draft,preview_sha256:previewSha,status:'PREVIEW_ONLY'});
  }

  async enqueue(preview,expectedPreviewSha256){
    if(!preview||preview.schema!=='musitu.axiom.fa16.offline-action.v1')throw new FA16BoundaryError('A prepared FA16 preview is required','PREVIEW_REQUIRED');
    const supplied=clean(expectedPreviewSha256,64);
    const draft={...clone(preview)};delete draft.preview_sha256;delete draft.status;
    const actual=await sha256(draft);
    if(!supplied||supplied!==preview.preview_sha256||actual!==preview.preview_sha256)throw new FA16BoundaryError('Offline preview changed or is stale','PREVIEW_MISMATCH');
    if(this.records.has(preview.action_id))return clone(this.records.get(preview.action_id));
    const record={...draft,preview_sha256:preview.preview_sha256,status:'QUEUED',envelope_sha256:await sha256(recordCore(draft))};
    await this.verifyRecord(record);
    this.records.set(record.action_id,clone(record));
    return Object.freeze(clone(record));
  }

  async verifyRecord(record){
    if(!record||record.schema!=='musitu.axiom.fa16.offline-action.v1')throw new FA16BoundaryError('Invalid offline record schema','RECORD_SCHEMA');
    assertNoSecrets(record.payload);
    if(record.external||record.public_effect||record.destructive||RISK_ORDER[record.risk_class]>RISK_ORDER.S1)throw new FA16BoundaryError('Offline record crossed the consequential-action boundary','RECORD_AUTHORITY');
    const authorityHash=await sha256(record.authority_snapshot);
    if(authorityHash!==record.authority_sha256)throw new FA16BoundaryError('Frozen authority snapshot was altered','AUTHORITY_TAMPER');
    const envelopeHash=await sha256(recordCore(record));
    if(envelopeHash!==record.envelope_sha256)throw new FA16BoundaryError('Offline queue record failed integrity verification','RECORD_TAMPER');
    return true;
  }

  async hydrate(records=[]){
    for(const record of records){await this.verifyRecord(record);this.records.set(record.action_id,clone(record));}
    return this.records.size;
  }

  async replay(actionId,{online=false,policyRevalidate,applyLocal}={}){
    const id=clean(actionId,180);
    if(this.receipts.has(id))return Object.freeze(clone(this.receipts.get(id)));
    const record=this.records.get(id);
    if(!record)throw new FA16BoundaryError('Offline action not found','ACTION_NOT_FOUND');
    await this.verifyRecord(record);
    if(Date.parse(record.expires_at)<=this.clock().getTime())return Object.freeze({action_id:id,status:'EXPIRED_REQUIRES_USER_REVIEW',external_side_effect:false,execution_allowed:false});
    if(!online)return Object.freeze({action_id:id,status:'DEFERRED_OFFLINE',external_side_effect:false,execution_allowed:false});
    if(typeof policyRevalidate!=='function')return Object.freeze({action_id:id,status:'AWAITING_POLICY_REVALIDATION',external_side_effect:false,execution_allowed:false});
    const gate=await policyRevalidate(clone(record));
    if(!gate||gate.authorized!==true||gate.scope!==record.scope||gate.authority_sha256!==record.authority_sha256){
      return Object.freeze({action_id:id,status:'BLOCKED_POLICY_REVALIDATION',external_side_effect:false,execution_allowed:false});
    }
    if(typeof applyLocal!=='function')return Object.freeze({action_id:id,status:'READY_FOR_LOCAL_REPLAY',external_side_effect:false,execution_allowed:false});
    const localResult=await applyLocal(clone(record));
    const receipt={
      schema:'musitu.axiom.fa16.replay-receipt.v1',receipt_id:this.idFactory('replay-receipt'),action_id:id,
      idempotency_key:record.idempotency_key,status:'COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT',result:clone(localResult??{}),
      authority_sha256:record.authority_sha256,record_sha256:record.envelope_sha256,external_side_effect:false,execution_allowed:true,
      completed_at:this.clock().toISOString()
    };
    receipt.receipt_sha256=await sha256(receipt);
    this.receipts.set(id,clone(receipt));
    this.records.set(id,{...record,status:'REPLAYED_LOCAL'});
    return Object.freeze(clone(receipt));
  }

  exportRecords(){return [...this.records.values()].map(clone);}
}

export class FA16ReconnectSupervisor{
  constructor({queue,onStateChange=()=>{}}={}){if(!(queue instanceof FA16OfflineQueue))throw new FA16BoundaryError('FA16OfflineQueue required','QUEUE_REQUIRED');this.queue=queue;this.state='UNKNOWN';this.onStateChange=onStateChange;}
  setState(state,detail={}){this.state=state;const snapshot=Object.freeze({state,...detail});this.onStateChange(snapshot);return snapshot;}
  async reconnect({browser_online=false,probe,policyRevalidate,applyLocal}={}){
    if(!browser_online)return this.setState('OFFLINE',{network_verified:false,receipts:[]});
    this.setState('RECONNECTING',{network_verified:false,receipts:[]});
    if(typeof probe!=='function')return this.setState('ONLINE_SIGNAL_UNVERIFIED',{network_verified:false,receipts:[]});
    let reachable=false;
    try{reachable=(await probe())===true;}catch{reachable=false;}
    if(!reachable)return this.setState('OFFLINE_UNREACHABLE',{network_verified:false,receipts:[]});
    const receipts=[];
    for(const record of this.queue.exportRecords()){
      if(record.status==='REPLAYED_LOCAL')continue;
      receipts.push(await this.queue.replay(record.action_id,{online:true,policyRevalidate,applyLocal}));
    }
    const blocked=receipts.some(receipt=>!['COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT','EXPIRED_REQUIRES_USER_REVIEW'].includes(receipt.status));
    return this.setState(blocked?'ONLINE_SYNC_BLOCKED':'ONLINE_SYNCED',{network_verified:true,receipts});
  }
}

export async function evaluateRealDeviceEvidence(rows=[],{verifyAttestation}={}){
  const byScenario=new Map((Array.isArray(rows)?rows:[]).map(row=>[clean(row?.scenario,80).toUpperCase(),row]));
  const outstanding=DEVICE_SCENARIOS.filter(scenario=>!PREEXISTING_PHONE_SCENARIOS.includes(scenario));
  const missing=outstanding.filter(scenario=>!byScenario.has(scenario));
  const rejected=[];const verified=[...PREEXISTING_PHONE_SCENARIOS];
  for(const scenario of outstanding){
    const row=byScenario.get(scenario);if(!row)continue;
    const structural=row.evidence_origin==='PHYSICAL_DEVICE'&&row.capture_mode==='DIRECT_DEVICE_CAPTURE'&&row.emulated===false&&/^[a-f0-9]{64}$/.test(clean(row.artifact_sha256,64))&&Boolean(clean(row.device_pseudonym,180))&&Boolean(clean(row.observed_at,80));
    if(!structural||typeof verifyAttestation!=='function'){rejected.push(scenario);continue;}
    let valid=false;try{valid=(await verifyAttestation(clone(row)))===true;}catch{valid=false;}
    if(valid)verified.push(scenario);else rejected.push(scenario);
  }
  const earned=missing.length===0&&rejected.length===0&&verified.length===DEVICE_SCENARIOS.length;
  return Object.freeze({
    status:earned?'REAL_DEVICE_MATRIX_EXTERNALLY_VERIFIED':'REAL_PHONE_EVIDENCED_TABLET_PENDING_CUSTOMER',required_scenarios:Object.freeze([...DEVICE_SCENARIOS]),
    verified_scenarios:Object.freeze(verified),missing_scenarios:Object.freeze(missing),rejected_scenarios:Object.freeze(rejected),
    preserved_phone_evidence:PREEXISTING_PHONE_EVIDENCE,tablet_evidence:earned?'EXTERNALLY_VERIFIED':'DEFERRED_PENDING_FUTURE_CUSTOMER',
    phase_progression_authorized:true,emulation_may_substitute:false,phase_exit_earned:earned,production_authority:false
  });
}

export function evaluatePWAInstallState({standalone=false,prompt_available=false,appinstalled_event=false,service_worker_controlled=false}={}){
  if(standalone||appinstalled_event)return Object.freeze({status:'INSTALLED_CONFIRMED_BY_BROWSER',installed:true,prompt_allowed:false});
  if(prompt_available)return Object.freeze({status:'INSTALL_PROMPT_READY',installed:false,prompt_allowed:true});
  return Object.freeze({status:service_worker_controlled?'PWA_SHELL_ACTIVE_INSTALL_NOT_PROVEN':'INSTALL_NOT_AVAILABLE',installed:false,prompt_allowed:false});
}

export const FA16_OFFLINE_ACTIONS=OFFLINE_ACTIONS;
export const FA16_DEVICE_SCENARIOS=DEVICE_SCENARIOS;
export const FA16_PREEXISTING_PHONE_EVIDENCE=PREEXISTING_PHONE_EVIDENCE;
