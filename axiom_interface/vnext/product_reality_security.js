export const TRUTH_STATES=Object.freeze(['OBSERVED','EMULATED','STATIC','EXTERNAL_EVIDENCE','MISSING','NOT_PROVEN']);
export const REALITY_CHANNELS=Object.freeze(['browser','dom','screenshot','accessibility','responsive','performance','network','console','auth_session','headers']);
export const VERDICT_STATES=Object.freeze(['PASS','BLOCKED','NOT_PROVEN']);
export const LOCAL_CAPTURE_MODE='BROWSER_LOCAL_INSPECTION_NO_FAKE_SCREENSHOT_NO_PHYSICAL_DEVICE_INFERENCE';
export const PHYSICAL_DEVICE_POLICY='EXPLICIT_EXTERNAL_EVIDENCE_ONLY_NEVER_INFER_FROM_VIEWPORT_OR_USER_AGENT';
export const SCREENSHOT_POLICY='QUALIFIED_PIXEL_CAPTURE_REQUIRED_FOR_VISUAL_PASS';
export const ACCESSIBILITY_POLICY='DOM_HEURISTIC_IS_NOT_ACCESSIBILITY_TREE';
export const HEADER_POLICY='TOP_LEVEL_RESPONSE_HEADERS_NOT_PROVEN_BY_ORDINARY_PAGE_JS';
const SECRET_RX=/(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)["']?\s*[:=]|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{10,}|\bbearer\s+[A-Za-z0-9._~-]{10,}/i;
export const clone=value=>structuredClone(value);
export const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
export const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
export async function sha256(value){const data=new TextEncoder().encode(canonical(value)),digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function rejectSecretLike(value,label='reality evidence'){if(SECRET_RX.test(typeof value==='string'?value:canonical(value)))throw new DOMException(`${label} contains forbidden secret-like material`,'SecurityError');}
export function truthState(value){const state=clean(value,40).toUpperCase();if(!TRUTH_STATES.includes(state))throw new DOMException('unrecognized reality truth state','SecurityError');return state;}
export function channel(value){const out=clean(value,40).toLowerCase();if(!REALITY_CHANNELS.includes(out))throw new DOMException('unrecognized reality channel','SecurityError');return out;}
export function truthRank(state){return {MISSING:0,NOT_PROVEN:1,STATIC:2,EMULATED:2,EXTERNAL_EVIDENCE:3,OBSERVED:4}[truthState(state)];}
export function normalizeObservation(raw={}){
  const out={
    schema:'musitu.axiom.product-reality.observation.browser.v1',
    observation_id:clean(raw.observation_id,180),
    session_id:clean(raw.session_id,180),
    project_id:clean(raw.project_id,180),
    generation:Number(raw.generation),
    channel:channel(raw.channel),
    truth_state:truthState(raw.truth_state),
    source_kind:clean(raw.source_kind,100),
    source_id:clean(raw.source_id,240)||null,
    captured_at:clean(raw.captured_at,80),
    payload:raw.payload==null?null:clone(raw.payload),
    physical_device_verified:raw.physical_device_verified===true,
    independent_verification:raw.independent_verification?clone(raw.independent_verification):null,
  };
  if(!out.observation_id||!out.session_id||!out.project_id||!Number.isInteger(out.generation)||out.generation<1||!out.source_kind||!Number.isFinite(Date.parse(out.captured_at)))throw new TypeError('complete reality observation identity required');
  rejectSecretLike(out,'reality observation');
  if(out.truth_state==='EMULATED'&&out.physical_device_verified)throw new DOMException('emulated evidence cannot become physical-device evidence','SecurityError');
  if(out.truth_state==='STATIC'&&out.physical_device_verified)throw new DOMException('static evidence cannot become physical-device evidence','SecurityError');
  if(out.channel==='screenshot'&&out.truth_state==='OBSERVED'&&!['QUALIFIED_BROWSER_CAPTURE','QUALIFIED_DEVICE_CAPTURE'].includes(out.source_kind))throw new DOMException('screenshot OBSERVED requires qualified pixel capture','SecurityError');
  if(out.truth_state==='EXTERNAL_EVIDENCE'){
    const verify=out.independent_verification;
    if(!verify||clean(verify.status,20).toUpperCase()!=='VERIFIED'||!clean(verify.verifier_id,180)||!clean(verify.evidence_sha256,64))out.independent_verification=null;
    if(out.physical_device_verified&&!out.independent_verification)throw new DOMException('physical-device external evidence requires independent verification','SecurityError');
  }
  if(out.physical_device_verified&&!['QUALIFIED_DEVICE_CAPTURE','QUALIFIED_PHYSICAL_DEVICE_EVIDENCE'].includes(out.source_kind))throw new DOMException('physical-device truth requires qualified device evidence source','SecurityError');
  return out;
}
export function localUnsupportedObservation({observation_id,session_id,project_id,generation,channel:kind,reason}){return normalizeObservation({observation_id,session_id,project_id,generation,channel:kind,truth_state:'MISSING',source_kind:'BROWSER_LOCAL_UNAVAILABLE',captured_at:new Date().toISOString(),payload:{reason:clean(reason,300)},physical_device_verified:false});}
export function evidenceSatisfiesChannel(observation){
  const o=normalizeObservation(observation);
  if(o.truth_state==='MISSING'||o.truth_state==='NOT_PROVEN'||o.truth_state==='STATIC')return false;
  if(o.channel==='screenshot')return o.truth_state==='OBSERVED'||(o.truth_state==='EXTERNAL_EVIDENCE'&&o.independent_verification?.status==='VERIFIED');
  if(o.channel==='accessibility')return o.truth_state==='OBSERVED'||(o.truth_state==='EXTERNAL_EVIDENCE'&&o.independent_verification?.status==='VERIFIED');
  if(o.channel==='headers')return o.truth_state==='OBSERVED'||(o.truth_state==='EXTERNAL_EVIDENCE'&&o.independent_verification?.status==='VERIFIED');
  if(o.truth_state==='EXTERNAL_EVIDENCE')return o.independent_verification?.status==='VERIFIED';
  if(o.channel==='responsive')return ['OBSERVED','EMULATED'].includes(o.truth_state);
  return o.truth_state==='OBSERVED';
}
