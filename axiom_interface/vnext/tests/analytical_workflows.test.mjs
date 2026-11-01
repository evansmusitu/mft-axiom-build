import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAnalyticalWorkflow,ANALYTICAL_WORKFLOWS} from '../analytical_workflows.mjs';
import {cases} from './fixtures/analytical_inputs.mjs';

const run=(workflow,data)=>evaluateAnalyticalWorkflow({workflow,data});
const close=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('missing analytical goals have independent small numerical/reference answers',async()=>{
  assert.equal((await run('document-reconciliation',cases['document-reconciliation'])).result.normalized_total,30000);
  close((await run('bayesian-updating',cases['bayesian-updating'])).result.posterior.fault,4/13);
  const mc=(await run('monte-carlo-uncertainty',cases['monte-carlo-uncertainty'])).result;close(mc.exact_mean,5);assert.ok(Math.abs(mc.sample_mean-5)<=mc.hoeffding_mean_error_95);
  const forensic=(await run('statement-forensics',cases['statement-forensics'])).result;close(forensic.accrual_ratio,.15);assert.equal(forensic.flags.length,2);assert.equal(forensic.fraud_established,false);
  const finance=(await run('project-finance',cases['project-finance'])).result;close(finance.project_npv,20);close(finance.coverage[1].dscr,3);
  const alm=(await run('asset-liability',cases['asset-liability'])).result;close(alm.surplus_present_value,20);close(alm.surplus_pv01,-.012);assert.deepEqual(alm.liquidity.map(x=>x.cumulative_gap),[-80,20]);
  assert.deepEqual((await run('inventory-decisions',cases['inventory-decisions'])).result.optimal_quantities,[10]);
  const reliability=(await run('reliability-investigation',cases['reliability-investigation'])).result;assert.deepEqual(reliability.surviving_hypotheses,['power','sensor']);assert.equal(reliability.next_tests[0].id,'meter');assert.equal(reliability.cause_proven,false);
});

test('new workflow dispatch refuses unknown goals and nonfinite or unbounded inputs',async()=>{
  await assert.rejects(()=>run('unregistered',{}));
  for(const value of [NaN,Infinity,-Infinity])await assert.rejects(()=>run('bayesian-updating',{states:[{id:'x',prior:1,likelihood:value}]}));
  await assert.rejects(()=>run('monte-carlo-uncertainty',{...cases['monte-carlo-uncertainty'],samples:100001}));
  assert.ok(Object.isFrozen(ANALYTICAL_WORKFLOWS));
});

test('the reused analytical modules have independently checkable outputs',async()=>{
  assert.ok((await run('claim-lineage',cases['claim-lineage'])).result.claims.every(c=>c.status==='BOUND'));
  const sources=(await run('source-adjudication',cases['source-adjudication'])).result;assert.equal(sources.status,'CONSISTENT');assert.equal(sources.selected_value,12);assert.equal(sources.distinct_origins,1);
  close((await run('causal-policy',cases['causal-policy'])).result.effect,8);
  close((await run('forecast-calibration',cases['forecast-calibration'])).result.brier,.04);
  close((await run('twin-validation',cases['twin-validation'])).result.rmse,Math.sqrt(.5));
  assert.deepEqual((await run('benchmark-evaluation',cases['benchmark-evaluation'])).result.systems.map(s=>s.correct),[1,0]);
  assert.equal((await run('analytical-pipeline',cases['analytical-pipeline'])).result.status,'DECLARED_CHECKS_PASS');
});
