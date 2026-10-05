import {REALITY_CHANNELS,clean,clone,evidenceSatisfiesChannel,normalizeObservation,sha256} from './product_reality_security.js';
const without=(row,...fields)=>Object.fromEntries(Object.entries(row).filter(([key])=>!fields.includes(key)));
const uniq=values=>[...new Set(values)].sort();
function error(errors,value){errors.push(clean(value,400));}
export async function observationBody(raw){return normalizeObservation(raw);}
export async function withObservationHash(raw){const body=await observationBody(raw);return {...body,observation_sha256:await sha256(body)};}
export async function verifyRealitySnapshot(snapshot={}){
  const errors=[];
  const session=snapshot.session||{};
  const projectId=clean(session.project_id,180),sessionId=clean(session.session_id,180),generation=Number(session.generation);
  if(!projectId||!sessionId||!Number.isInteger(generation)||generation<1)error(errors,'session_identity');
  if(!session.session_sha256)error(errors,'session_hash_missing');
  else if(await sha256(without(session,'session_sha256'))!==session.session_sha256)error(errors,'session_hash');
  if(session.physical_device_verified===true)error(errors,'session_cannot_self_assert_physical_device');
  const observations=[];
  for(const raw of snapshot.observations||[]){
    try{
      const o=normalizeObservation(raw);observations.push(o);
      if(raw.observation_sha256&&await sha256(o)!==raw.observation_sha256)error(errors,`observation_hash:${o.observation_id}`);
      if(o.project_id!==projectId||o.session_id!==sessionId)error(errors,`observation_scope:${o.observation_id}`);
      if(o.generation>generation)error(errors,`observation_future_generation:${o.observation_id}`);
    }catch(reason){error(errors,`observation_invalid:${clean(reason?.message||reason,200)}`);}
  }
  const current=new Map();
  for(const o of observations.filter(o=>o.generation===generation).sort((a,b)=>a.captured_at.localeCompare(b.captured_at)))current.set(o.channel,o);
  for(const kind of REALITY_CHANNELS)if(!current.has(kind))error(errors,`channel_missing:${kind}`);
  const findings=snapshot.findings||[];
  const repairs=snapshot.repairs||[];
  const findingIds=new Set();
  for(const f of findings){
    const id=clean(f.finding_id,180);if(!id||findingIds.has(id))error(errors,`finding_identity:${id||'missing'}`);findingIds.add(id);
    if(clean(f.project_id,180)!==projectId||clean(f.session_id,180)!==sessionId)error(errors,`finding_scope:${id}`);
    if(Number(f.created_generation)>generation||Number(f.created_generation)<1)error(errors,`finding_generation:${id}`);
    const body=without(f,'finding_sha256');if(f.finding_sha256&&await sha256(body)!==f.finding_sha256)error(errors,`finding_hash:${id}`);
    const status=clean(f.status,40).toUpperCase();
    if(status==='RESOLVED'){
      if(!f.resolved_by_observation_id||Number(f.resolved_generation)<=Number(f.created_generation))error(errors,`finding_self_closed_or_stale:${id}`);
      const obs=observations.find(o=>o.observation_id===f.resolved_by_observation_id);
      if(!obs||obs.generation!==Number(f.resolved_generation)||obs.generation>generation)error(errors,`finding_resolution_observation:${id}`);
    }
  }
  for(const r of repairs){
    const id=clean(r.repair_id,180);if(clean(r.project_id,180)!==projectId||clean(r.session_id,180)!==sessionId)error(errors,`repair_scope:${id}`);
    if(!findingIds.has(clean(r.finding_id,180)))error(errors,`repair_finding_missing:${id}`);
    if(clean(r.status,60).toUpperCase()==='CLOSED'||clean(r.status,60).toUpperCase()==='RESOLVED')error(errors,`repair_cannot_self_close:${id}`);
    const body=without(r,'repair_sha256');if(r.repair_sha256&&await sha256(body)!==r.repair_sha256)error(errors,`repair_hash:${id}`);
  }
  const events=(snapshot.events||[]).slice().sort((a,b)=>a.sequence-b.sequence);let previous=null;
  for(let i=0;i<events.length;i++){
    const e=events[i],body=without(e,'event_sha256');
    if(e.sequence!==i||e.previous_event_sha256!==previous)error(errors,`event_chain:${i}`);
    if(clean(e.project_id,180)!==projectId||clean(e.session_id,180)!==sessionId)error(errors,`event_scope:${i}`);
    if(await sha256(body)!==e.event_sha256)error(errors,`event_hash:${i}`);previous=e.event_sha256;
  }
  const blockers=findings.filter(f=>['OPEN','BLOCKING','REPAIR_IMPLEMENTED_PENDING_REINSPECTION'].includes(clean(f.status,80).toUpperCase())&&clean(f.severity,40).toUpperCase()==='BLOCKING');
  const unsatisfied=REALITY_CHANNELS.filter(kind=>!current.has(kind)||!evidenceSatisfiesChannel(current.get(kind)));
  for(const [kind,o] of current.entries()){if(o.payload?.blocking===true||clean(o.payload?.status,20).toUpperCase()==='FAIL')error(errors,`channel_blocking:${kind}`);}
  const screenshot=current.get('screenshot');
  if(!screenshot||!evidenceSatisfiesChannel(screenshot))error(errors,'visual_completion_requires_qualified_screenshot');
  const accessibility=current.get('accessibility');
  if(!accessibility||!evidenceSatisfiesChannel(accessibility))error(errors,'accessibility_not_proven');
  const headers=current.get('headers');if(!headers||!evidenceSatisfiesChannel(headers))error(errors,'headers_not_proven');
  if(blockers.length)error(errors,`blocking_findings:${blockers.map(x=>clean(x.finding_id,180)).sort().join(',')}`);
  const integrityErrors=uniq(errors);
  const canPass=integrityErrors.length===0&&unsatisfied.length===0&&blockers.length===0;
  const requested=clean(snapshot.verdict?.status||'NOT_PROVEN',40).toUpperCase();
  if(requested==='PASS'&&!canPass)error(errors,'fake_visual_completion_blocked');
  const finalErrors=uniq(errors);
  return {
    schema:'musitu.axiom.product-reality.verification.browser.v1',
    project_id:projectId,
    session_id:sessionId,
    generation,
    status:finalErrors.length?'FAIL':'PASS',
    reality_verdict:canPass?'PASS':'NOT_PROVEN',
    channel_states:Object.fromEntries(REALITY_CHANNELS.map(kind=>[kind,current.get(kind)?.truth_state||'MISSING'])),
    unsatisfied_channels:uniq(unsatisfied),
    blocking_findings:blockers.map(f=>clean(f.finding_id,180)).sort(),
    physical_device_verified:observations.some(o=>o.physical_device_verified===true&&((o.truth_state==='OBSERVED'&&o.source_kind==='QUALIFIED_DEVICE_CAPTURE')||(o.truth_state==='EXTERNAL_EVIDENCE'&&o.source_kind==='QUALIFIED_PHYSICAL_DEVICE_EVIDENCE'&&o.independent_verification?.status==='VERIFIED'))),
    errors:finalErrors,
  };
}
export async function sealRealityVerification(snapshot){const result=await verifyRealitySnapshot(snapshot);return {...result,verification_sha256:await sha256(result)};}
