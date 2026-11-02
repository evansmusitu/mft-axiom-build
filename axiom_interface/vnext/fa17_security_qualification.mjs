const SOURCE_COMMIT='e88f4ecd09343bd04d1196b3379ed8d8c3677c82';
const SEVERITY=Object.freeze({INFO:0,LOW:1,MEDIUM:2,HIGH:3,CRITICAL:4});
const MANDATORY_SUITES=Object.freeze(['SAST','DAST','PROMPT_INJECTION','PRIVILEGE','SECRETS','SSRF','SUPPLY_CHAIN','EVALUATOR_TAMPER','ROLLBACK_EVIDENCE_TAMPER']);

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const canonical=value=>JSON.stringify(stable(value));
const clean=(value,limit=4000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);
const unique=value=>[...new Set((Array.isArray(value)?value:[]).map(item=>clean(item,240)).filter(Boolean))].sort();
const clone=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

export const FA17_EVALUATOR_POLICY=freeze({
  schema:'musitu.axiom.fa17.evaluator-policy.v1',
  phase:'FA-17',
  source_commit:SOURCE_COMMIT,
  required_suites:MANDATORY_SUITES,
  blocking_severities:Object.freeze(['HIGH','CRITICAL']),
  same_builder_and_verifier_forbidden:true,
  threshold_reduction_forbidden:true,
  missing_suite_fails_closed:true,
  production_authority:false
});

export const FA17_EVALUATOR_POLICY_SHA256='bc9d59b3fcfd850193f0d00314e8fcd1ff30f8bb5894b479ca7563e3bfa005fd';

export async function sha256(value){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:canonical(value)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function verifyEvaluatorPolicy(candidate=FA17_EVALUATOR_POLICY){
  return canonical(candidate)===canonical(FA17_EVALUATOR_POLICY)&&await sha256(candidate)===FA17_EVALUATOR_POLICY_SHA256;
}

const INJECTION_RX=/(?:ignore|override|bypass|disregard).{0,80}(?:instruction|policy|approval|security|system)|(?:reveal|export|exfiltrate).{0,80}(?:secret|token|credential|system prompt)|(?:grant|assume|give).{0,80}(?:admin|authority|permission)|(?:run|execute|deploy).{0,80}(?:command|production|shell)/i;

export function quarantineExternalContent(input={}){
  const provenance=clean(input.provenance||'UNTRUSTED_EXTERNAL',80).toUpperCase();
  const content=clean(input.content,16000);const instructions=(Array.isArray(input.instructions)?input.instructions:[]).map(value=>clean(value,2000));
  const injection_detected=INJECTION_RX.test([content,...instructions].join('\n'));
  return freeze({provenance,content,instructions,authority:'DATA_ONLY',injection_detected,can_change_policy:false,can_widen_scope:false,can_grant_network:false,can_access_secrets:false,can_approve:false,can_execute:false});
}

function isPrivateIpv4(host){
  const parts=host.split('.');if(parts.length!==4||parts.some(p=>!/^[0-9]{1,3}$/.test(p)||Number(p)>255))return false;
  const [a,b]=parts.map(Number);
  return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19);
}

function isForbiddenHost(host){
  const value=host.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(!value||value==='localhost'||value.endsWith('.localhost')||value.endsWith('.local')||value.endsWith('.internal')||value.endsWith('.lan')||value.endsWith('.home'))return true;
  if(value.includes(':'))return true;
  return isPrivateIpv4(value);
}

export function validateUntrustedEgress(raw,{allowHosts=[]}={}){
  let url;try{url=new URL(clean(raw,2048));}catch{throw new DOMException('valid HTTPS URL required','SecurityError');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new DOMException('credential-free HTTPS URL required','SecurityError');
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(isForbiddenHost(host))throw new DOMException('local, private or literal-IP destinations are forbidden','SecurityError');
  const allowed=unique(allowHosts).map(value=>value.toLowerCase().replace(/\.$/,''));
  if(!allowed.includes(host))throw new DOMException('destination is not exactly allow-listed','SecurityError');
  return freeze({url:url.toString(),host,network_scope:'EXACT_HOST_ONLY',redirect_revalidation_required:true,dns_pin_required:true});
}

export function assessActionReference(spec){
  const value=clean(spec,500),match=value.match(/^([^@\s]+)@([^\s]+)$/);if(!match)return freeze({status:'BLOCK',severity:'HIGH',reason:'INVALID_ACTION_REFERENCE'});
  const [,action,ref]=match;if(/^[a-f0-9]{40}$/.test(ref))return freeze({status:'PASS',severity:'INFO',action,ref,pinned:true});
  if(action.startsWith('actions/'))return freeze({status:'RESIDUAL',severity:'MEDIUM',action,ref,pinned:false,reason:'OFFICIAL_ACTION_MAJOR_TAG_NOT_IMMUTABLE'});
  return freeze({status:'BLOCK',severity:'HIGH',action,ref,pinned:false,reason:'THIRD_PARTY_ACTION_NOT_IMMUTABLY_PINNED'});
}

export function evaluateSecurityReport(input={}){
  const suiteResults=input.suite_results&&typeof input.suite_results==='object'?input.suite_results:{};
  const findings=(Array.isArray(input.findings)?input.findings:[]).map((finding,index)=>freeze({id:clean(finding.id||`finding-${index+1}`,160),severity:clean(finding.severity||'HIGH',16).toUpperCase(),status:clean(finding.status||'OPEN',32).toUpperCase(),title:clean(finding.title||'Untitled finding',500)}));
  const missing=MANDATORY_SUITES.filter(name=>suiteResults[name]!=='PASS');
  const blocking=findings.filter(finding=>(SEVERITY[finding.severity]??SEVERITY.CRITICAL)>=SEVERITY.HIGH&&!['RESOLVED','FALSE_POSITIVE','ACCEPTED_BY_AUTHORIZED_POLICY'].includes(finding.status));
  if(clean(input.source_commit,40)!==SOURCE_COMMIT)blocking.push(freeze({id:'SOURCE_COMMIT_MISMATCH',severity:'CRITICAL',status:'OPEN',title:'Qualification source is not the frozen FA-16 head'}));
  if(missing.length)blocking.push(freeze({id:'MANDATORY_SUITE_MISSING',severity:'HIGH',status:'OPEN',title:`Missing or failed suites: ${missing.join(', ')}`}));
  const passed=blocking.length===0;
  return freeze({schema:'musitu.axiom.fa17.security-verdict.v1',status:passed?'PASS_NO_OPEN_HIGH_SEVERITY':'BLOCKED_HIGH_SEVERITY',source_commit:SOURCE_COMMIT,required_suites:MANDATORY_SUITES,suite_results:clone(suiteResults),findings,blocking_findings:blocking,residual_findings:findings.filter(finding=>!blocking.includes(finding)),qualification_earned:passed,production_authority:false,tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER'});
}

export async function createEvidenceEnvelope(input={}){
  const body={schema:'musitu.axiom.fa17.evidence-envelope.v1',source_commit:SOURCE_COMMIT,policy_sha256:FA17_EVALUATOR_POLICY_SHA256,builder_identity:clean(input.builder_identity,180),verifier_identity:clean(input.verifier_identity,180),security_verdict:clean(input.security_verdict,80),open_high_severity:Number(input.open_high_severity),candidate_sha256:clean(input.candidate_sha256,64),rollback_origin_sha256:clean(input.rollback_origin_sha256,64),restored_candidate_sha256:clean(input.restored_candidate_sha256,64),production_authority:false};
  if(!body.builder_identity||!body.verifier_identity||body.builder_identity===body.verifier_identity)throw new DOMException('builder and verifier must be distinct','SecurityError');
  for(const key of ['candidate_sha256','rollback_origin_sha256','restored_candidate_sha256'])if(!/^[a-f0-9]{64}$/.test(body[key]))throw new DOMException(`${key} must be SHA-256`,'SecurityError');
  if(body.candidate_sha256!==body.restored_candidate_sha256)throw new DOMException('rollback restoration does not match the candidate','SecurityError');
  if(body.security_verdict!=='PASS_NO_OPEN_HIGH_SEVERITY'||body.open_high_severity!==0)throw new DOMException('blocking security findings remain','SecurityError');
  return freeze({...body,evidence_sha256:await sha256(body)});
}

export async function verifyEvidenceEnvelope(envelope){
  if(!envelope||envelope.schema!=='musitu.axiom.fa17.evidence-envelope.v1'||envelope.source_commit!==SOURCE_COMMIT||envelope.policy_sha256!==FA17_EVALUATOR_POLICY_SHA256||envelope.production_authority!==false)return false;
  if(envelope.builder_identity===envelope.verifier_identity||envelope.security_verdict!=='PASS_NO_OPEN_HIGH_SEVERITY'||envelope.open_high_severity!==0||envelope.candidate_sha256!==envelope.restored_candidate_sha256)return false;
  const body=Object.fromEntries(Object.entries(envelope).filter(([key])=>key!=='evidence_sha256'));
  return await sha256(body)===envelope.evidence_sha256;
}

export const FA17_SOURCE_COMMIT=SOURCE_COMMIT;
export const FA17_MANDATORY_SUITES=MANDATORY_SUITES;
