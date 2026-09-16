import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createResearchRecord,addResearchSource,addResearchClaim,verifyResearch,buildResearchOutcomePackage,
  createAnalysisResult,verifyAnalysis,analysisInspector,createScenarioResult,verifyScenario,assertScenarioNotObserved,
  createArtifactRecord,addArtifactVersion,verifyArtifact,approveArtifact,buildArtifactOutcomePackage,FA14GateError,FA14_BOUNDARY
} from '../fa14_evidence_native_engine.js';

const NOW=Date.parse('2026-09-16T00:00:00Z');

test('material research claims fail closed until permitted fresh evidence is bound',()=>{
  const r=createResearchRecord({researchId:'research:r1',projectId:'project:p1',question:'What is true?',sourcePolicy:{require_freshness:true,allowed_permissions:['ALLOWED','RESTRICTED']}});
  addResearchClaim(r,{claimId:'claim:c1',text:'A material claim',evidenceBindings:[]});
  let v=verifyResearch(r,{now:NOW});
  assert.equal(v.status,'BLOCKED');
  assert.equal(v.claim_source_coverage,0);
  assert.throws(()=>buildResearchOutcomePackage(r,{now:NOW}),FA14GateError);

  addResearchSource(r,{sourceId:'source:s1',title:'Primary source',locator:'doc://one#p1',publishedAt:'2026-09-15T00:00:00Z',capturedAt:'2026-09-16T00:00:00Z',freshnessMaxDays:30,permission:'ALLOWED'});
  r.claims[0].evidence_bindings=[{source_id:'source:s1',locator:'p.1'}];
  v=verifyResearch(r,{now:NOW});
  assert.equal(v.status,'PASS_CLAIM_SOURCE_GATE');
  assert.equal(v.claim_source_coverage,1);
  const pkg=buildResearchOutcomePackage(r,{now:NOW});
  assert.equal(pkg.publication_execution_allowed,false);
  assert.equal(pkg.citations.length,1);
});

test('contradicting evidence is preserved rather than collapsed',()=>{
  const r=createResearchRecord({researchId:'research:r2',projectId:'project:p1',question:'Which conclusion survives?'});
  for(const [id,title] of [['source:a','A'],['source:b','B']])addResearchSource(r,{sourceId:id,title,locator:`doc://${title}`,publishedAt:'2026-09-15',freshnessMaxDays:30,permission:'ALLOWED'});
  addResearchClaim(r,{claimId:'claim:a',text:'Claim A',evidenceBindings:[{source_id:'source:a',locator:'line 1'}]});
  addResearchClaim(r,{claimId:'claim:b',text:'Claim B conflicts with A',evidenceBindings:[{source_id:'source:b',locator:'line 2'}],contradictionOf:['claim:a']});
  const v=verifyResearch(r,{now:NOW});
  assert.equal(v.status,'PASS_CLAIM_SOURCE_GATE');
  assert.deepEqual(v.contradictions_preserved,[{claim_id:'claim:b',contradiction_of:['claim:a']}]);
  const pkg=buildResearchOutcomePackage(r,{now:NOW});
  assert.equal(pkg.claims.length,2);
});

test('denied or stale research sources cannot satisfy claim gate',()=>{
  const r=createResearchRecord({researchId:'research:r3',projectId:'project:p1',question:'Fresh?'});
  addResearchSource(r,{sourceId:'source:denied',title:'Denied',locator:'doc://denied',publishedAt:'2026-09-15',freshnessMaxDays:30,permission:'DENIED'});
  addResearchSource(r,{sourceId:'source:stale',title:'Stale',locator:'doc://stale',publishedAt:'2020-01-01',freshnessMaxDays:30,permission:'ALLOWED'});
  addResearchClaim(r,{claimId:'claim:x',text:'X',evidenceBindings:[{source_id:'source:denied',locator:'x'},{source_id:'source:stale',locator:'y'}]});
  const v=verifyResearch(r,{now:NOW});
  assert.equal(v.status,'BLOCKED');
  assert.ok(v.findings.some(x=>x.type==='SOURCE_PERMISSION_BLOCKED'));
  assert.ok(v.findings.some(x=>x.type==='SOURCE_STALE'));
});

test('analysis gate requires lineage, transformations, qualified capability and reproducibility',()=>{
  const a=createAnalysisResult({analysisId:'analysis:a1',projectId:'project:p1',title:'Analysis',sourceLineage:[{source_id:'evidence:d1',locator:'table A'}],transformations:[{operation:'mean',formula:'sum(x)/n'}],capability:{id:'statistics.describe',qualification:'CERTIFIED_ATOMIC'},uncertainty:'Sampling uncertainty reported',reproducibility:{environment:'node test',seed:'42',input_hashes:['abc'],code_or_formula_version:'v1'}});
  assert.equal(verifyAnalysis(a).status,'PASS_LINEAGE_GATE');
  assert.equal(analysisInspector(a).exact_capability.id,'statistics.describe');
  const bad={...a,capability:{id:'candidate.x',qualification:'DISCOVERED_CANDIDATE'}};
  assert.equal(verifyAnalysis(bad).status,'BLOCKED');
  assert.ok(verifyAnalysis(bad).findings.some(x=>x.type==='UNQUALIFIED_CAPABILITY'));
});

test('Twin results remain simulated, uncertain and NOT_CERTIFIED',()=>{
  const s=createScenarioResult({scenarioId:'scenario:s1',projectId:'project:p1',title:'Price scenario',baseline:'Current state',assumptions:['Demand stays flat'],inputSources:[{source_id:'evidence:e1',locator:'baseline dataset'}],modelTool:{id:'simulation.runner',qualification:'REGISTERED_DERIVED'},variables:{price:12},result:{revenue:100},uncertainty:{low:80,high:120,unit:'USD',method:'range'}});
  const v=verifyScenario(s);
  assert.equal(v.status,'PASS_SIMULATION_TRUTH_GATE');
  assert.equal(s.observed_reality,false);
  assert.equal(s.certification,'NOT_CERTIFIED');
  assert.equal(v.may_be_relabelled_observed,false);
  assert.throws(()=>assertScenarioNotObserved(s),FA14GateError);
});

test('artifact packages require evidence, provenance and versions; public approval stays external',()=>{
  const a=createArtifactRecord({artifactId:'artifact:a1',projectId:'project:p1',title:'Outcome',kind:'report',evidenceRefs:['evidence:e1'],provenance:[{type:'research',ref:'research:r1'}]});
  assert.equal(verifyArtifact(a).status,'BLOCKED');
  addArtifactVersion(a,{contentSha256:'0123456789abcdef0123456789abcdef',summary:'v1'});
  assert.equal(verifyArtifact(a).status,'PASS_ARTIFACT_LINEAGE_GATE');
  const pkg=buildArtifactOutcomePackage(a);
  assert.equal(pkg.publication_execution_allowed,false);
  assert.equal(pkg.required_next_gate,'AUTHORIZATION_APPROVAL');
  assert.throws(()=>approveArtifact(a,{risk_class:'S4',decision:'ALLOW',receipt_id:'approval:r1',human_approval:false}),FA14GateError);
  approveArtifact(a,{risk_class:'S4',decision:'ALLOW',receipt_id:'approval:r2',human_approval:true});
  const approved=buildArtifactOutcomePackage(a);
  assert.equal(approved.required_next_gate,'GOVERNED_EXTERNAL_EXECUTOR');
  assert.equal(approved.publication_execution_allowed,false);
});

test('FA-14 final-app boundary does not relabel historical Phase 14 or grant production authority',()=>{
  assert.equal(FA14_BOUNDARY.legacyPhase14Unchanged,true);
  assert.equal(FA14_BOUNDARY.productionAuthority,false);
  assert.equal(FA14_BOUNDARY.externalPublicationExecutor,false);
  assert.equal(FA14_BOUNDARY.superiority,'NOT_CERTIFIED');
});
