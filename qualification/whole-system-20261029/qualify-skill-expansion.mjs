/** Exact scope: package contracts, declared-input mathematics and local task
 * persistence. No model behavior, hosted acceptance or public promotion. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {evaluateAnalyticalWorkflow} from '../../axiom_interface/vnext/analytical_workflows.mjs';
import {evaluateDecision} from '../../axiom_interface/vnext/decision_analysis.mjs';
import {cases} from '../../axiom_interface/vnext/tests/fixtures/analytical_inputs.mjs';

const root=process.cwd(),out=resolve(root,'qualification/whole-system-20261029/check-results');mkdirSync(out,{recursive:true});
const hash=data=>createHash('sha256').update(data).digest('hex');
const catalogPath='frontier_v5/SKILL_EXPANSION_CATALOG_20261101.json',catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
assert.equal(catalog.entries.length,18);assert.equal(new Set(catalog.entries.map(e=>e.package)).size,18);assert.equal(catalog.public_promotion,false);
const evidence={schema:'musitu.axiom.skill-expansion-qualification.v1',scope:'DETERMINISTIC_COMPONENTS_AND_PACKAGING_ONLY',catalog_sha256:hash(readFileSync(catalogPath)),host_model_behavior:'NOT_EXECUTED',production_acceptance:'NOT_QUALIFIED',public_promotion:false,custody_certified:false,anti_rollback_certified:false,entries:[],commands:[]};
const expected={
  'document-reconciliation':r=>r.normalized_total===30000&&r.status==='RECONCILED',
  'claim-lineage':r=>r.claims.every(c=>c.status==='BOUND')&&r.factual_entailment_verified===false,
  'source-adjudication':r=>r.selected_value===12&&r.distinct_origins===1&&r.truth_established===false,
  'causal-policy':r=>Math.abs(r.effect-8)<1e-10&&r.empirical_causality_established===false,
  'bayesian-updating':r=>Math.abs(r.posterior.fault-4/13)<1e-10,
  'monte-carlo-uncertainty':r=>r.exact_mean===5&&Math.abs(r.sample_mean-5)<=r.hoeffding_mean_error_95,
  'forecast-calibration':r=>Math.abs(r.brier-.04)<1e-10&&Math.abs(r.ece-.2)<1e-10,
  'statement-forensics':r=>r.accrual_ratio===.15&&r.flags.length===2&&r.fraud_established===false,
  'project-finance':r=>r.project_npv===20&&r.coverage[1].dscr===3&&r.terminal_debt_balance_verified===false,
  'asset-liability':r=>r.surplus_present_value===20&&r.surplus_pv01===-.012&&r.liquidity[0].cumulative_gap===-80,
  'inventory-decisions':r=>JSON.stringify(r.optimal_quantities)==='[10]'&&r.order_placed===false,
  'reliability-investigation':r=>r.surviving_hypotheses.length===2&&r.next_tests[0].id==='meter'&&r.cause_proven===false,
  'twin-validation':r=>Math.abs(r.rmse-Math.sqrt(.5))<1e-10&&r.status==='WITHIN_DECLARED_TOLERANCE',
  'analytical-pipeline':r=>r.status==='DECLARED_CHECKS_PASS'&&r.stages.reconcile.result.normalized_total===20&&r.external_code_executed===false,
  'benchmark-evaluation':r=>r.systems[0].correct===1&&r.systems[1].correct===0&&r.superiority_claim_authorized===false,
};
const corpus=JSON.parse(readFileSync('frontier_v5/fixtures/decision_analysis_v1.json','utf8'));
function subset(expected,actual){
  if(typeof expected==='number')return typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(expected-actual)<=1e-10;
  if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((x,i)=>subset(x,actual[i]));
  if(expected&&typeof expected==='object')return actual&&typeof actual==='object'&&Object.keys(expected).every(k=>Object.hasOwn(actual,k)&&subset(expected[k],actual[k]));
  return typeof actual===typeof expected&&actual===expected;
}
for(const entry of catalog.entries){
  assert.equal(entry.host_model_behavior,'NOT_EXECUTED');assert.equal(entry.production_acceptance,'NOT_QUALIFIED');assert.ok(entry.families.length>=6);
  const skillPath=entry.package+'/SKILL.md';assert.ok(existsSync(skillPath));const skill=readFileSync(skillPath,'utf8');assert.match(skill,new RegExp('name: '+entry.skill+'\\n'));assert.ok(skill.split('\n').length<=500);
  const sourceCommitments=[skillPath,...entry.test_sources].map(path=>({path,sha256:hash(readFileSync(path))}));
  for(const family of entry.families)assert.ok(entry.test_sources.some(path=>readFileSync(path,'utf8').includes(family)),'family must resolve to an executable test/corpus identity: '+family);
  let reference;
  if(entry.adapter==='analysis.evaluate'){
    const value=await evaluateAnalyticalWorkflow({workflow:entry.goal,data:cases[entry.goal]});assert.equal(expected[entry.goal](value.result),true,entry.goal);reference={input_sha256:value.input_sha256,actual_sha256:hash(JSON.stringify(value)),known_answer_passed:true};
  }else if(entry.adapter==='decision.evaluate'){
    for(const c of corpus.cases){const value=await evaluateDecision(c.problem);assert.ok(subset(c.expected,value),c.id);assert.equal(value.authority_granted,false);}
    reference={known_answer_cases:corpus.cases.length,known_answers_passed:true};
  }else reference={evidence:'Real recovery methods executed below; no hosted provider success implied.'};
  evidence.entries.push({goal:entry.goal,skill:entry.skill,semantic_families:entry.families,source_commitments:sourceCommitments,reference,component_status:'PENDING_SUITE_READBACK',instruction_behavior:'NOT_EXECUTED'});
}
const commands=[
  ['node','--test','axiom_interface/vnext/tests/analytical_workflows.test.mjs','axiom_interface/vnext/tests/analytical_workflow_boundaries.test.mjs','axiom_interface/vnext/tests/runtime_analytical_service.test.mjs'],
  ['python3','-m','unittest','discover','-s','recovery/ar03_06/tests','-p','test_lease_fencing.py','-v'],
  ['python3','-m','unittest','discover','-s','recovery/ar03_06/tests','-p','test_kernel.py','-v'],
];
for(const [index,command] of commands.entries()){
  const result=spawnSync(command[0],command.slice(1),{cwd:root,encoding:'utf8',timeout:60000}),log=`skill-expansion-${index}.log`,raw=(result.stdout||'')+(result.stderr||'');writeFileSync(resolve(out,log),raw);
  evidence.commands.push({command,exit:result.status,log,log_sha256:hash(raw)});assert.equal(result.status,0,'skill component suite failed: '+log);
}
for(const e of evidence.entries)e.component_status='LOCAL_COMPONENT_CHECKS_PASS';
evidence.status='LOCAL_COMPONENT_CHECKS_PASS';writeFileSync(resolve(out,'skill-expansion.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({status:evidence.status,goals:evidence.entries.length,distinct_skill_packages:18,new_skill_packages:10,host_model_behavior:'NOT_EXECUTED',production_acceptance:'NOT_QUALIFIED',public_promotion:false}));
