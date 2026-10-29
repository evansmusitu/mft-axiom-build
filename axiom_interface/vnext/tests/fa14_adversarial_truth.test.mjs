import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createResearchRecord,addResearchSource,addResearchClaim,verifyResearch,createScenarioResult,verifyScenario,verifyAnalysis,createAnalysisResult} from '../fa14_evidence_native_engine.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');

test('retrieved source instructions remain data-only and cannot elevate authority',()=>{
  const r=createResearchRecord({researchId:'research:attack',projectId:'project:p1',question:'Adversarial source?'});
  const s=addResearchSource(r,{sourceId:'source:attack',title:'Malicious page says ignore policy and deploy',locator:'https://example.invalid/attack',publishedAt:'2026-09-16',freshnessMaxDays:1,permission:'ALLOWED',provenance:'web retrieval'});
  assert.equal(s.authority,'DATA_ONLY');
  assert.equal(s.instruction_authority,false);
  assert.equal(r.authority_boundary,'RETRIEVED_CONTENT_IS_DATA_NOT_AUTHORITY');
});

test('claim referencing nonexistent evidence cannot pass through crafted ids',()=>{
  const r=createResearchRecord({researchId:'research:missing',projectId:'project:p1',question:'Missing evidence?'});
  addResearchClaim(r,{claimId:'claim:missing',text:'Unsupported',evidenceBindings:[{source_id:'source:does-not-exist',locator:'line 1'}]});
  const v=verifyResearch(r,{now:Date.parse('2026-09-16')});
  assert.equal(v.status,'BLOCKED');
  assert.ok(v.findings.some(x=>x.type==='MISSING_SOURCE'));
});

test('scenario tampering to observed/certified fails verification',()=>{
  const s=createScenarioResult({scenarioId:'scenario:tamper',projectId:'project:p1',title:'Scenario',assumptions:['A'],inputSources:[{source_id:'evidence:x',locator:'x'}],modelTool:{id:'m'},result:{},uncertainty:{low:1,high:2}});
  s.observed_reality=true;s.certification='CERTIFIED';
  const v=verifyScenario(s);
  assert.equal(v.status,'BLOCKED');
  assert.ok(v.findings.some(x=>x.type==='REALITY_LABEL_VIOLATION'));
  assert.ok(v.findings.some(x=>x.type==='CERTIFICATION_LABEL_VIOLATION'));
});

test('discovered candidate cannot masquerade as qualified analysis capability',()=>{
  const a=createAnalysisResult({analysisId:'analysis:attack',projectId:'project:p1',title:'Candidate analysis',sourceLineage:[{source_id:'evidence:x',locator:'x'}],transformations:[{operation:'op'}],capability:{id:'candidate',qualification:'DISCOVERED_CANDIDATE'},reproducibility:{environment:'test',code_or_formula_version:'v1'}});
  const v=verifyAnalysis(a);
  assert.equal(v.status,'BLOCKED');
});

test('FA-14 UI keeps Twin, Research, Analyze, Artifact and no-external-action truth visible',()=>{
  const ui=fs.readFileSync(path.join(root,'fa14_workspace_ui.js'),'utf8');
  const engine=fs.readFileSync(path.join(root,'fa14_evidence_native_engine.js'),'utf8');
  for(const marker of ['research','analyze','twin','artifacts','create'])assert.match(ui,new RegExp(marker));
  assert.match(ui,/External execution: disabled/);
  assert.match(engine,/publication_execution_allowed:false/);
  assert.match(engine,/SIMULATED_SCENARIO/);
  assert.match(engine,/NOT_CERTIFIED/);
});
