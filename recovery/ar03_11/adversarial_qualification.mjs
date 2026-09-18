import {clean, clone, requireText, sha256} from './common.mjs';

export const AR08_ATTACK_DOMAINS=Object.freeze([
  'prompt_injection','cross_tenant_access','scope_escalation','approval_bypass','secret_extraction','ssrf','sandbox_escape','evidence_tampering','replay','dependency_compromise','evaluator_manipulation'
]);
const SEVERITY=Object.freeze(['INFO','LOW','MEDIUM','HIGH','CRITICAL']);

export class AdversarialQualification {
  constructor(){this.cases=[];this.results=[];}
  add({id,domain,severity='HIGH',attack}={}){id=requireText(id,'case id');domain=clean(domain,80);if(!AR08_ATTACK_DOMAINS.includes(domain))throw new TypeError('unknown AR-08 attack domain');severity=clean(severity,16).toUpperCase();if(!SEVERITY.includes(severity))throw new TypeError('invalid severity');if(typeof attack!=='function')throw new TypeError('attack function required');if(this.cases.some(x=>x.id===id))throw new DOMException('duplicate attack id','ConstraintError');this.cases.push({id,domain,severity,attack});return this;}
  async run(context={}){this.results=[];for(const test of this.cases){let blocked=false,error=null,evidence=null;try{const outcome=await test.attack(context);blocked=outcome?.blocked===true;evidence=clone(outcome||{});}catch(e){blocked=e?.name==='SecurityError'||e?.name==='NotAllowedError';error={name:clean(e?.name,80),message:clean(e?.message,240)};}const findingOpen=!blocked;const row={id:test.id,domain:test.domain,severity:test.severity,blocked,finding_open:findingOpen,error,evidence};row.case_sha256=await sha256(row);this.results.push(row);}return this.summary();}
  summary(){const open=this.results.filter(x=>x.finding_open);const highCritical=open.filter(x=>['HIGH','CRITICAL'].includes(x.severity));const domains=new Set(this.results.map(x=>x.domain));return {schema:'musitu.axiom.ar08.adversarial-summary.v1',executed_cases:this.results.length,covered_domains:domains.size,required_domains:AR08_ATTACK_DOMAINS.length,open_findings:open.length,open_high_critical:highCritical.length,zero_open_critical_high:highCritical.length===0,all_domains_covered:AR08_ATTACK_DOMAINS.every(d=>domains.has(d)),results:clone(this.results)};}
}

export async function runAr08CandidateGate({attacks=[],authorizationProbe}={}){
  const q=new AdversarialQualification();for(const attack of attacks)q.add(attack);const summary=await q.run({authorizationProbe});let exactAuthorization=true;if(typeof authorizationProbe==='function'){const probe=await authorizationProbe();exactAuthorization=probe?.consequential_without_exact_authorization===false;}const candidatePass=summary.zero_open_critical_high&&summary.all_domains_covered&&exactAuthorization;return {schema:'musitu.axiom.ar08.candidate-gate.v1',status:candidatePass?'CANDIDATE_PASS_INDEPENDENT_REPRODUCTION_PENDING':'FAIL',...summary,exact_authorization_verified:exactAuthorization,independent_verifier_reproduced:false,phase_gate_earned:false,blocker:candidatePass?'DISTINCT_INDEPENDENT_VERIFIER_REPRODUCTION_REQUIRED':'OPEN_SECURITY_FINDINGS_OR_COVERAGE_GAP',production_mutated:false};
}

export function buildDefaultAttackFixtures({tenantRead,authorize,sandboxRead,evidenceVerify,replay,dependencyCheck,evaluatorCheck,secretProbe,networkProbe}={}){
  const blocked=async(fn)=>{try{const r=await fn();return {blocked:r?.allowed!==true};}catch(e){return {blocked:['SecurityError','NotAllowedError','NotSupportedError'].includes(e?.name),error:e?.name};}};
  return [
    {id:'inj-1',domain:'prompt_injection',severity:'HIGH',attack:()=>blocked(()=>authorize({provenance:'RETRIEVED_DATA',risk_class:'S3'}))},
    {id:'tenant-1',domain:'cross_tenant_access',severity:'CRITICAL',attack:()=>blocked(()=>tenantRead({tenant:'foreign'}))},
    {id:'scope-1',domain:'scope_escalation',severity:'CRITICAL',attack:()=>blocked(()=>authorize({requested_scope:'admin',granted_scope:'read'}))},
    {id:'approval-1',domain:'approval_bypass',severity:'CRITICAL',attack:()=>blocked(()=>authorize({risk_class:'S4',approvals:[]}))},
    {id:'secret-1',domain:'secret_extraction',severity:'CRITICAL',attack:()=>blocked(()=>secretProbe())},
    {id:'ssrf-1',domain:'ssrf',severity:'CRITICAL',attack:()=>blocked(()=>networkProbe('http://169.254.169.254/latest/meta-data'))},
    {id:'escape-1',domain:'sandbox_escape',severity:'CRITICAL',attack:()=>blocked(()=>sandboxRead('../outside'))},
    {id:'evidence-1',domain:'evidence_tampering',severity:'HIGH',attack:()=>blocked(()=>evidenceVerify({tampered:true}))},
    {id:'replay-1',domain:'replay',severity:'HIGH',attack:()=>blocked(()=>replay({duplicate:true}))},
    {id:'dep-1',domain:'dependency_compromise',severity:'HIGH',attack:()=>blocked(()=>dependencyCheck({mutable_pin:true}))},
    {id:'eval-1',domain:'evaluator_manipulation',severity:'HIGH',attack:()=>blocked(()=>evaluatorCheck({builder_is_verifier:true}))},
  ];
}
