import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateDecision} from '../decision_analysis.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const fixture=process.env.AXIOM_DECISION_FIXTURES||new URL('../../../frontier_v5/fixtures/decision_analysis_v1.json',import.meta.url);
const cases=JSON.parse(readFileSync(fixture,'utf8')).cases;
function subset(expected,actual){
  if(expected&&typeof expected==='object'&&!Array.isArray(expected)){for(const [key,value] of Object.entries(expected))subset(value,actual[key]);}
  else if(typeof expected==='number')assert.ok(Math.abs(expected-actual)<1e-10,`${actual} != ${expected}`);
  else assert.deepEqual(actual,expected);
}
for(const row of cases)test(`hand oracle: ${row.id}`,async()=>{
  const result=await evaluateDecision(row.problem);subset(row.expected,result);
  assert.equal(result.authority_granted,false);assert.equal(result.source_evidence_verified,false);
  assert.equal(result.recommendation_only,true);assert.match(result.input_sha256,/^[0-9a-f]{64}$/);
  if(result.evsi!==null)assert.ok(result.evsi>=0&&result.evsi<=result.evpi);
});

test('Python and JS agree on full outputs and exact input commitments',async()=>{
  const cwd=process.env.AXIOM_DECISION_PYTHON_ROOT||root;
  for(const row of cases){
    const python=JSON.parse(execFileSync('python3',['-m','frontier_v5.runtime.decision_analysis'],{cwd,input:JSON.stringify(row.problem),encoding:'utf8'}));
    const js=await evaluateDecision(row.problem);
    assert.equal(js.input_sha256,python.input_sha256,row.id);subset(python,js);
  }
});

test('invalid/nonfinite/unbound decisions fail closed',async()=>{
  for(const mutate of [p=>p.states[0].probability=NaN,p=>p.actions[0].utilities.favorable=Infinity,p=>p.assumptions=[],p=>p.grant_authority=true,p=>delete p.actions[0].utilities.unfavorable]){
    const changed=structuredClone(cases[0].problem);mutate(changed);await assert.rejects(()=>evaluateDecision(changed));
  }
});
