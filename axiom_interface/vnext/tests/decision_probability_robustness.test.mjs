import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateDecision,normalizeDecision} from '../decision_analysis.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const cases=JSON.parse(readFileSync(new URL('../../../frontier_v5/fixtures/decision_probability_robustness_v1.json',import.meta.url),'utf8')).cases;
function subset(expected,actual){
  if(expected&&typeof expected==='object'&&!Array.isArray(expected)){for(const [key,value] of Object.entries(expected))subset(value,actual[key]);}
  else if(Array.isArray(expected)){assert.equal(actual.length,expected.length);expected.forEach((value,index)=>subset(value,actual[index]));}
  else if(typeof expected==='number')assert.ok(Math.abs(expected-actual)<1e-10,`${actual} != ${expected}`);
  else assert.deepEqual(actual,expected);
}
for(const row of cases)test(`probability robustness hand oracle: ${row.id}`,async()=>{
  const value=await evaluateDecision(row.problem);subset(row.expected,value.robustness);
  assert.equal(value.robustness.scope,'TWO_STATE_EXPECTED_UTILITY_ONLY');
  assert.equal(value.robustness.probabilities_empirically_validated,false);
  assert.equal(value.authority_granted,false);assert.equal(value.source_evidence_verified,false);
});

test('probability robustness full Python/JS outputs and commitments agree',async()=>{
  for(const row of cases){
    const python=JSON.parse(execFileSync('python3',['-m','frontier_v5.runtime.decision_analysis'],{cwd:root,input:JSON.stringify(row.problem),encoding:'utf8'}));
    const js=await evaluateDecision(row.problem);
    assert.equal(js.input_sha256,python.input_sha256,row.id);assert.deepEqual(js,python,row.id);
  }
});

test('omitting range preserves prior input commitment and output shape',async()=>{
  const problem=structuredClone(cases[0].problem);delete problem.probability_range;
  const value=await evaluateDecision(problem);
  assert.equal(Object.hasOwn(value,'robustness'),false);
  assert.equal(Object.hasOwn(normalizeDecision(problem),'probability_range'),false);
  assert.equal(value.input_sha256,'5de6ef7ff4a6209ee1a61110dbe01a4e63a875ab693738554c956a7fb6cc9748');
});

test('range changes are bound into the input commitment',async()=>{
  const one=structuredClone(cases[0].problem),two=structuredClone(one);two.probability_range.upper=0.8;
  assert.notEqual((await evaluateDecision(one)).input_sha256,(await evaluateDecision(two)).input_sha256);
});

test('an action optimal only inside the interval is retained',async()=>{
  const problem=structuredClone(cases[0].problem);
  problem.probability_range={state_id:'high',lower:0,upper:1};
  problem.actions=[{id:'left',utilities:{high:0,low:2}},{id:'middle',utilities:{high:1.25,low:1.25}},{id:'right',utilities:{high:2,low:0}}];
  const {robustness}=await evaluateDecision(problem);
  assert.deepEqual(robustness.optimal_at_lower,['left']);assert.deepEqual(robustness.optimal_at_upper,['right']);
  assert.deepEqual(robustness.possible_optimal_actions,['left','middle','right']);assert.deepEqual(robustness.robust_optimal_actions,[]);
});

test('invalid and unsupported probability range declarations fail closed',async()=>{
  const mutations=[p=>p.probability_range=null,p=>p.probability_range=[],p=>p.probability_range.lower=NaN,p=>p.probability_range.upper=Infinity,
    p=>p.probability_range.lower=true,p=>p.probability_range.lower=-0.1,p=>p.probability_range.upper=1.1,p=>p.probability_range.lower=0.7,
    p=>p.probability_range.upper=0.4,p=>p.probability_range.state_id='unknown',p=>p.probability_range.complement_state_id='low',p=>delete p.probability_range.upper,
    p=>p.states.push({id:'third',probability:0}),p=>p.signal_model={signals:[{id:'known',likelihoods:{high:1,low:1}}]}];
  for(const mutate of mutations){const problem=structuredClone(cases[0].problem);mutate(problem);await assert.rejects(()=>evaluateDecision(problem));}
});

test('subnormal endpoint and remote exact crossing displays are preserved',async()=>{
  const tiny=(await evaluateDecision(cases.find(row=>row.id.startsWith('subnormal_')).problem)).robustness;
  assert.equal(tiny.utility_ranges.a.maximum,Number.MIN_VALUE);
  const remote=(await evaluateDecision(cases.find(row=>row.id.startsWith('unrepresentably_')).problem)).robustness.pairwise_break_even[0];
  assert.deepEqual(remote.exact_probability,{numerator:(1n<<1074n).toString(),denominator:'1'});
  assert.equal(remote.probability,null);
});

test('range action limit bounds pairwise proofs while point analysis still permits 100 actions',async()=>{
  const problem=structuredClone(cases[0].problem);
  const actions=count=>Array.from({length:count},(_,i)=>({id:`a${i}`,utilities:{high:i/101,low:-i/103}}));
  problem.actions=actions(20);
  assert.equal((await evaluateDecision(problem)).robustness.pairwise_break_even.length,190);
  problem.actions=actions(21);await assert.rejects(()=>evaluateDecision(problem),/20 actions/);
  delete problem.probability_range;problem.actions=actions(100);
  assert.equal(Object.hasOwn(await evaluateDecision(problem),'robustness'),false);
});

test('common positive affine utility transformation preserves all robust preference sets',async()=>{
  const original=structuredClone(cases[0].problem),changed=structuredClone(original);
  for(const action of changed.actions)for(const key of Object.keys(action.utilities))action.utilities[key]=3*action.utilities[key]+7;
  const before=(await evaluateDecision(original)).robustness,after=(await evaluateDecision(changed)).robustness;
  for(const key of ['optimal_at_lower','optimal_at_upper','robust_optimal_actions','possible_optimal_actions','pairwise_break_even'])assert.deepEqual(after[key],before[key]);
});
