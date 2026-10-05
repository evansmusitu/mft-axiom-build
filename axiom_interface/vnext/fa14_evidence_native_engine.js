const TEXT_LIMIT=12000;
const ID_PATTERN=/^[a-z0-9][a-z0-9._:-]{0,179}$/i;
const clean=(value,max=TEXT_LIMIT)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const arr=value=>Array.isArray(value)?value:[];
const copy=value=>structuredClone(value);
const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const iso=value=>{
  if(!value)return '';
  const d=new Date(value);
  return Number.isFinite(d.getTime())?d.toISOString():'';
};
const requireText=(name,value,max=TEXT_LIMIT)=>{
  const v=clean(value,max);
  if(!v)throw new FA14GateError(`${name} is required`,name);
  return v;
};
const requireId=(name,value)=>{
  const v=requireText(name,value,180);
  if(!ID_PATTERN.test(v))throw new FA14GateError(`${name} is invalid`,name);
  return v;
};
const uid=prefix=>`${prefix}:${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

export class FA14GateError extends Error{
  constructor(message,code='FA14_GATE'){super(message);this.name='FA14GateError';this.code=code;}
}

export const FA14_BOUNDARY=Object.freeze({
  phase:'FA-14',
  program:'FINAL_APP_PROGRAM',
  legacyPhase14Unchanged:true,
  storage:'BROWSER_LOCAL_CANDIDATE_STATE',
  retrievedContentAuthority:'DATA_ONLY',
  externalPublicationExecutor:false,
  productionAuthority:false,
  superiority:'NOT_CERTIFIED',
  wolframParity:'NOT_CERTIFIED'
});

export function classifyFreshness(source,{now=Date.now()}={}){
  const maxDays=finite(source?.freshness_max_days);
  const basis=iso(source?.published_at)||iso(source?.captured_at);
  if(maxDays===null||maxDays<0||!basis)return 'UNKNOWN';
  const age=Math.max(0,(Number(now)-new Date(basis).getTime())/86400000);
  return age<=maxDays?'FRESH':'STALE';
}

export function createResearchRecord({researchId=uid('research'),projectId,workId='',question,scope='Project',sourcePolicy={require_freshness:true,allowed_permissions:['ALLOWED','RESTRICTED']}}={}){
  return {
    schema:'musitu.axiom.fa14.research.v1',
    research_id:requireId('researchId',researchId),
    project_id:requireId('projectId',projectId),
    work_id:clean(workId,180),
    question:requireText('question',question,4000),
    scope:clean(scope,240)||'Project',
    source_policy:{
      require_freshness:sourcePolicy?.require_freshness!==false,
      allowed_permissions:arr(sourcePolicy?.allowed_permissions).length?arr(sourcePolicy.allowed_permissions).map(x=>clean(x,40)):['ALLOWED','RESTRICTED']
    },
    sources:[],claims:[],notes:[],created_at:new Date().toISOString(),
    authority_boundary:'RETRIEVED_CONTENT_IS_DATA_NOT_AUTHORITY'
  };
}

export function addResearchSource(record,input={}){
  if(record?.schema!=='musitu.axiom.fa14.research.v1')throw new FA14GateError('research record required','research');
  const permission=clean(input.permission||'UNKNOWN',40).toUpperCase();
  if(!['ALLOWED','RESTRICTED','DENIED','UNKNOWN'].includes(permission))throw new FA14GateError('invalid source permission','permission');
  const row={
    source_id:requireId('sourceId',input.sourceId||uid('source')),
    title:requireText('source title',input.title,500),
    locator:requireText('source locator',input.locator,2000),
    captured_at:iso(input.capturedAt)||new Date().toISOString(),
    published_at:iso(input.publishedAt),
    freshness_max_days:finite(input.freshnessMaxDays),
    permission,
    provenance:clean(input.provenance||'user-supplied',240),
    content_sha256:clean(input.contentSha256,128),
    authority:'DATA_ONLY',instruction_authority:false
  };
  if(record.sources.some(x=>x.source_id===row.source_id))throw new FA14GateError('duplicate source id','source_id');
  record.sources.push(row);
  return copy(row);
}

export function addResearchClaim(record,input={}){
  if(record?.schema!=='musitu.axiom.fa14.research.v1')throw new FA14GateError('research record required','research');
  const bindings=arr(input.evidenceBindings).map(b=>({
    source_id:requireId('binding source_id',b?.source_id),
    locator:requireText('binding locator',b?.locator,2000),
    span_sha256:clean(b?.span_sha256,128)
  }));
  const row={
    claim_id:requireId('claimId',input.claimId||uid('claim')),
    text:requireText('claim text',input.text,6000),
    material:input.material!==false,
    evidence_bindings:bindings,
    contradiction_of:arr(input.contradictionOf).map(x=>requireId('contradiction claim id',x)),
    confidence:finite(input.confidence),
    state:'DRAFT'
  };
  if(row.confidence!==null&&(row.confidence<0||row.confidence>1))throw new FA14GateError('confidence must be between 0 and 1','confidence');
  if(record.claims.some(x=>x.claim_id===row.claim_id))throw new FA14GateError('duplicate claim id','claim_id');
  record.claims.push(row);
  return copy(row);
}

export function verifyResearch(record,{now=Date.now()}={}){
  const sourceMap=new Map(arr(record?.sources).map(s=>[s.source_id,s]));
  const claimIds=new Set(arr(record?.claims).map(c=>c.claim_id));
  const material=arr(record?.claims).filter(c=>c.material!==false);
  const findings=[];
  let covered=0;
  for(const claim of material){
    const valid=[];
    for(const b of arr(claim.evidence_bindings)){
      const s=sourceMap.get(b.source_id);
      if(!s){findings.push({type:'MISSING_SOURCE',claim_id:claim.claim_id,source_id:b.source_id});continue;}
      if(!arr(record.source_policy?.allowed_permissions).includes(s.permission)){
        findings.push({type:'SOURCE_PERMISSION_BLOCKED',claim_id:claim.claim_id,source_id:s.source_id,permission:s.permission});continue;
      }
      const freshness=classifyFreshness(s,{now});
      if(record.source_policy?.require_freshness&&freshness!=='FRESH'){
        findings.push({type:`SOURCE_${freshness}`,claim_id:claim.claim_id,source_id:s.source_id});continue;
      }
      valid.push(b);
    }
    if(valid.length)covered++;
    else findings.push({type:'MATERIAL_CLAIM_UNBOUND',claim_id:claim.claim_id});
    for(const target of arr(claim.contradiction_of)) if(!claimIds.has(target))findings.push({type:'UNKNOWN_CONTRADICTION_TARGET',claim_id:claim.claim_id,target});
  }
  const coverage=material.length?covered/material.length:0;
  const contradictions=arr(record?.claims).filter(c=>arr(c.contradiction_of).length).map(c=>({claim_id:c.claim_id,contradiction_of:[...c.contradiction_of]}));
  const passed=material.length>0&&coverage===1&&!findings.length;
  return {
    schema:'musitu.axiom.fa14.research-verification.v1',
    status:passed?'PASS_CLAIM_SOURCE_GATE':'BLOCKED',
    material_claims:material.length,
    bound_material_claims:covered,
    claim_source_coverage:coverage,
    contradictions_preserved:contradictions,
    findings,
    synthesis_allowed:passed,
    export_allowed:passed
  };
}

export function buildResearchOutcomePackage(record,options={}){
  const verification=verifyResearch(record,options);
  if(!verification.export_allowed)throw new FA14GateError('research export blocked until every material claim has permitted fresh evidence','claim_source_gate');
  return {
    schema:'musitu.axiom.fa14.research-outcome-package.v1',
    research_id:record.research_id,project_id:record.project_id,work_id:record.work_id,
    question:record.question,claims:copy(record.claims),sources:copy(record.sources),
    citations:record.claims.flatMap(c=>c.evidence_bindings.map(b=>({claim_id:c.claim_id,...b}))),
    contradictions:verification.contradictions_preserved,
    verification,
    provenance:{generated_by:'FA14_EVIDENCE_NATIVE_RESEARCH_ENGINE',generated_at:new Date().toISOString()},
    publication_execution_allowed:false
  };
}

export function createAnalysisResult(input={}){
  return {
    schema:'musitu.axiom.fa14.analysis.v1',
    analysis_id:requireId('analysisId',input.analysisId||uid('analysis')),
    project_id:requireId('projectId',input.projectId),
    work_id:clean(input.workId,180),
    title:requireText('analysis title',input.title,500),
    source_lineage:arr(input.sourceLineage).map(x=>({source_id:requireId('source_id',x?.source_id),locator:requireText('source locator',x?.locator,2000),sha256:clean(x?.sha256,128)})),
    transformations:arr(input.transformations).map((x,i)=>({step:i+1,operation:requireText('transformation operation',x?.operation,240),formula:clean(x?.formula,2000),parameters:copy(x?.parameters||{})})),
    capability:{id:requireText('capability id',input.capability?.id,240),qualification:clean(input.capability?.qualification,80)},
    outputs:copy(input.outputs||{}),
    uncertainty:clean(input.uncertainty,2000),
    budget:copy(input.budget||{}),
    reproducibility:{environment:clean(input.reproducibility?.environment,1000),seed:clean(input.reproducibility?.seed,240),input_hashes:arr(input.reproducibility?.input_hashes).map(x=>clean(x,128)),code_or_formula_version:clean(input.reproducibility?.code_or_formula_version,240)},
    created_at:new Date().toISOString()
  };
}

export function verifyAnalysis(result){
  const findings=[];
  if(!arr(result?.source_lineage).length)findings.push({type:'MISSING_SOURCE_LINEAGE'});
  if(!arr(result?.transformations).length)findings.push({type:'MISSING_TRANSFORMATION_HISTORY'});
  if(!result?.capability?.id)findings.push({type:'MISSING_CAPABILITY'});
  if(!['CERTIFIED_ATOMIC','REGISTERED_DERIVED'].includes(result?.capability?.qualification))findings.push({type:'UNQUALIFIED_CAPABILITY',qualification:result?.capability?.qualification||'UNKNOWN'});
  if(!result?.reproducibility?.environment||!result?.reproducibility?.code_or_formula_version)findings.push({type:'INCOMPLETE_REPRODUCIBILITY'});
  return {schema:'musitu.axiom.fa14.analysis-verification.v1',status:findings.length?'BLOCKED':'PASS_LINEAGE_GATE',findings,reproducible:!findings.length};
}

export function analysisInspector(result){
  return {
    source_lineage:copy(result?.source_lineage||[]),
    transformation_history:copy(result?.transformations||[]),
    exact_capability:copy(result?.capability||{}),
    budget:copy(result?.budget||{}),
    reproducibility:copy(result?.reproducibility||{}),
    uncertainty:clean(result?.uncertainty,2000)
  };
}

export function createScenarioResult(input={}){
  const low=finite(input.uncertainty?.low), high=finite(input.uncertainty?.high);
  if(low===null||high===null||low>high)throw new FA14GateError('valid uncertainty bounds are required','uncertainty');
  return {
    schema:'musitu.axiom.fa14.scenario.v1',
    scenario_id:requireId('scenarioId',input.scenarioId||uid('scenario')),
    project_id:requireId('projectId',input.projectId),
    work_id:clean(input.workId,180),
    title:requireText('scenario title',input.title,500),
    baseline:clean(input.baseline,1000),
    assumptions:arr(input.assumptions).map(x=>requireText('assumption',x,2000)),
    input_sources:arr(input.inputSources).map(x=>({source_id:requireId('source_id',x?.source_id),locator:requireText('source locator',x?.locator,2000)})),
    model_tool:{id:requireText('model/tool id',input.modelTool?.id,240),qualification:clean(input.modelTool?.qualification||'UNKNOWN',80)},
    variables:copy(input.variables||{}),
    result:copy(input.result||{}),
    uncertainty:{low,high,unit:clean(input.uncertainty?.unit,80),method:clean(input.uncertainty?.method,500)},
    calibration:clean(input.calibration,2000),
    classification:'SIMULATED_SCENARIO',observed_reality:false,certification:'NOT_CERTIFIED',
    created_at:new Date().toISOString()
  };
}

export function verifyScenario(scenario){
  const findings=[];
  if(scenario?.classification!=='SIMULATED_SCENARIO'||scenario?.observed_reality!==false)findings.push({type:'REALITY_LABEL_VIOLATION'});
  if(scenario?.certification!=='NOT_CERTIFIED')findings.push({type:'CERTIFICATION_LABEL_VIOLATION'});
  if(!arr(scenario?.assumptions).length)findings.push({type:'MISSING_ASSUMPTIONS'});
  if(!arr(scenario?.input_sources).length)findings.push({type:'MISSING_INPUT_SOURCES'});
  if(!scenario?.model_tool?.id)findings.push({type:'MISSING_MODEL_TOOL'});
  if(!scenario?.uncertainty||finite(scenario.uncertainty.low)===null||finite(scenario.uncertainty.high)===null)findings.push({type:'MISSING_UNCERTAINTY'});
  return {schema:'musitu.axiom.fa14.scenario-verification.v1',status:findings.length?'BLOCKED':'PASS_SIMULATION_TRUTH_GATE',findings,may_be_relabelled_observed:false,certification:'NOT_CERTIFIED'};
}

export function assertScenarioNotObserved(){
  throw new FA14GateError('simulated scenario output cannot be relabelled as observed reality or certified evidence','simulation_truth_boundary');
}

export function createArtifactRecord(input={}){
  return {
    schema:'musitu.axiom.fa14.artifact.v1',
    artifact_id:requireId('artifactId',input.artifactId||uid('artifact')),
    project_id:requireId('projectId',input.projectId),work_id:clean(input.workId,180),
    title:requireText('artifact title',input.title,500),kind:requireText('artifact kind',input.kind,100),
    evidence_refs:arr(input.evidenceRefs).map(x=>requireId('evidence ref',x)),
    provenance:arr(input.provenance).map(x=>({type:requireText('provenance type',x?.type,100),ref:requireText('provenance ref',x?.ref,2000),sha256:clean(x?.sha256,128)})),
    versions:[],approval_state:'DRAFT',publication_intent:null,created_at:new Date().toISOString()
  };
}

export function addArtifactVersion(artifact,input={}){
  const row={version:artifact.versions.length+1,content_sha256:requireText('content sha256',input.contentSha256,128),summary:clean(input.summary,1000),created_at:new Date().toISOString()};
  artifact.versions.push(row);return copy(row);
}

export function verifyArtifact(artifact){
  const findings=[];
  if(!arr(artifact?.evidence_refs).length)findings.push({type:'MISSING_EVIDENCE_BINDING'});
  if(!arr(artifact?.provenance).length)findings.push({type:'MISSING_PROVENANCE'});
  if(!arr(artifact?.versions).length)findings.push({type:'MISSING_VERSION_HISTORY'});
  return {schema:'musitu.axiom.fa14.artifact-verification.v1',status:findings.length?'BLOCKED':'PASS_ARTIFACT_LINEAGE_GATE',findings};
}

export function approveArtifact(artifact,receipt={}){
  const risk=clean(receipt.risk_class,8).toUpperCase();
  if(!['S0','S1','S2','S3','S4','S5'].includes(risk))throw new FA14GateError('valid risk class required','risk_class');
  if(receipt.decision!=='ALLOW')throw new FA14GateError('authorization gateway ALLOW receipt required','authorization');
  if(['S4','S5'].includes(risk)&&receipt.human_approval!==true)throw new FA14GateError('human approval required for public/critical publication','human_approval');
  artifact.approval_state='APPROVED';
  artifact.publication_intent={risk_class:risk,authorization_receipt_id:requireId('receipt id',receipt.receipt_id),human_approval:receipt.human_approval===true,external_executor_required:true};
  return copy(artifact.publication_intent);
}

export function buildArtifactOutcomePackage(artifact){
  const verification=verifyArtifact(artifact);
  if(verification.status!=='PASS_ARTIFACT_LINEAGE_GATE')throw new FA14GateError('artifact package blocked until evidence, provenance and version history are complete','artifact_lineage_gate');
  return {
    schema:'musitu.axiom.fa14.artifact-outcome-package.v1',artifact:copy(artifact),verification,
    publication_execution_allowed:false,
    required_next_gate:artifact.approval_state==='APPROVED'?'GOVERNED_EXTERNAL_EXECUTOR':'AUTHORIZATION_APPROVAL'
  };
}

export function serializeFA14State(state){
  const payload={schema:'musitu.axiom.fa14.browser-state.v1',research:arr(state?.research),analyses:arr(state?.analyses),scenarios:arr(state?.scenarios),artifacts:arr(state?.artifacts)};
  return JSON.stringify(payload);
}

export function parseFA14State(text){
  try{
    const value=JSON.parse(String(text||''));
    if(value?.schema!=='musitu.axiom.fa14.browser-state.v1')throw new Error('schema');
    return {research:arr(value.research),analyses:arr(value.analyses),scenarios:arr(value.scenarios),artifacts:arr(value.artifacts)};
  }catch{return {research:[],analyses:[],scenarios:[],artifacts:[]};}
}
