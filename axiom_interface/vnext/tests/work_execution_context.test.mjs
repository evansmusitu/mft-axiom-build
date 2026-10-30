import test from 'node:test';
import assert from 'node:assert/strict';
import {workExecutionContext} from '../work_execution_context.mjs';
import {createD1ExecutionGovernance} from '../../../ops/axiom_execution_contract.mjs';
import {sqliteD1,applyExecutionSchema} from '../../tests/execution_test_helpers.mjs';

function state(extra={}){return {activeProjectId:'project-one',activeWorkId:'work-one',controls:{autonomy:'Policy-bounded',privacy:'Project',evidence:'Standard',budget:5},work:[{contract_id:'work-one',outcome:'Calculate 40+2.',success_criteria:['Return the calculation.'],integrity_verified:true,constraints:{autonomy:'Policy-bounded',privacy:'Private',evidence:'Standard',compute_budget:1,approval:'Every tool action',deadline:'2026-10-30T10:00:00+02:00',...extra}}]};}
test('selected Work sends its stricter policy, approval, deadline and budget to the enforced contract',async()=>{
  const context=workExecutionContext(state(),'Calculate 40+2.');
  assert.equal(context.controls.approval,'Every tool action');assert.equal(context.controls.deadline,'2026-10-30T08:00:00.000Z');assert.equal(context.controls.budget,1);assert.equal(context.controls.privacy,'Private');
  const db=applyExecutionSchema(sqliteD1()),gate=createD1ExecutionGovernance({db,customer:{customer_id:'owner'},now:()=>new Date('2026-10-30T07:59:00Z')});
  const b=await gate.admit({objective:'Calculate 40+2.',context});
  assert.equal(b.contract.expires_at,context.controls.deadline);await assert.rejects(()=>b.reserve({kind:'compute',operation:'arithmetic.evaluate'}),/action approval/);
});
test('expired selected Work and invalid deadlines cannot dispatch; local approval never grants server authority',async()=>{
  const context=workExecutionContext(state({approval:'Before consequential action'}),'Calculate 40+2.');
  const gate=createD1ExecutionGovernance({db:applyExecutionSchema(sqliteD1()),customer:{customer_id:'owner'},now:()=>new Date('2026-10-30T08:01:00Z')});
  await assert.rejects(()=>gate.admit({objective:'Calculate 40+2.',context}),/deadline has expired/);
  assert.throws(()=>workExecutionContext(state({deadline:'invalid'}),'Calculate 40+2.'),/deadline is invalid/);
  assert.throws(()=>workExecutionContext(state(),'A different objective'),/selected Work objective/);
});
