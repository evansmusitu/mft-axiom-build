// Checks retained real Neon results; never simulates or executes a restart.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(new URL('./neon-current-schema-recovery.json',import.meta.url),'utf8'));
assert.equal(r.scope,'REAL_NEON_DATABASE_RESTART_AND_HEAD_BRANCH_RECOVERY_COPY_NOT_OFFSITE_BACKUP');
assert.equal(r.phase1Complete,false);
assert.equal(r.restart.beforeRows.length,22);
assert.deepEqual(r.restart.afterRows,r.restart.beforeRows);
assert.notEqual(r.restart.afterContract.postmaster_started_at,r.restart.beforeContract.postmaster_started_at);
for(const field of ['schema_hash','roles','relations']){
 assert.deepEqual(r.restart.afterContract[field],r.restart.beforeContract[field]);
 assert.deepEqual(r.recoveryCopy.contract[field],r.restart.afterContract[field]);
}
assert.deepEqual(r.recoveryCopy.rows,r.restart.afterRows);
assert.deepEqual(r.recoveryCopy.afterProbeRows,r.recoveryCopy.rows);
for(const role of r.recoveryCopy.contract.roles){
 for(const key of ['superuser','bypassrls','inherit','create_role','create_db'])assert.equal(role[key],false);
 assert.equal(role.login,role.name!=='musitu_commands');
}
for(const t of r.recoveryCopy.contract.relations){
 assert.equal(t.rls,true);assert.equal(t.force_rls,true);
 assert.equal(t.owner,'musitu_whatsapp_phase1_owner');
}
const runtime=r.recoveryCopy.restrictedRuntimeLogin[0];
assert.equal(runtime.current_user,'musitu_runtime');assert.equal(runtime.session_user,'musitu_runtime');
assert.equal(runtime.command_role_member,false);
assert.equal(r.recoveryCopy.missingContext.length,22);
assert.ok(r.recoveryCopy.missingContext.every(t=>t.visible===0));
const transitions=r.recoveryCopy.scopeTransitions;
for(const i of [1,3]){
 assert.equal(transitions[i].length,21);assert.ok(transitions[i].every(t=>t.foreign_rows===0));
 for(const name of ['messages','contacts','faqs','action_audit'])assert.ok(transitions[i].find(t=>t.relation===name).visible>0);
}
assert.ok(transitions[5].every(t=>t.visible===0));
for(const [key,pattern] of [['invalidTenant',/invalid input syntax for type uuid/],['foreignActor',/ACCESS_DENIED/],['roleEscalation',/permission denied to set role/]]){
 const e=r.recoveryCopy.expectedFailures[key];assert.equal(e.isError,true);
 assert.match(e.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'),pattern);
}
assert.equal(r.recoveryCopy.newTransactionContext[0].tenant_context_cleared,true);
assert.equal(r.recoveryCopy.newTransactionContext[0].messages_visible,0);
assert.equal(r.recoveryCopy.newTransactionContext[0].ai_requests_visible,0);
assert.deepEqual(r.recoveryCopy.aiLedgerState[0].request_states,[{state:'COMPLETED',records:1},{state:'UNKNOWN',records:1}]);
assert.equal(r.recoveryCopy.aiLedgerState[0].all_ai_policies_disabled,true);
assert.equal(r.recoveryCopy.endpointFinal.disabled,true);assert.equal(r.recoveryCopy.endpointFinal.current_state,'idle');
assert.equal(r.recoveryCopy.endpointFinal.branch_id,r.recoveryCopy.branch.id);
assert.notEqual(r.recoveryCopy.branch.id,r.source.branch);assert.equal(r.recoveryCopy.branch.parent_id,r.source.branch);
assert.equal(r.recoveryCopy.branch.default,false);assert.equal(r.mapping.defaultBranch,r.source.branch);
assert.equal(r.mapping.sourceEndpointBranch,r.source.branch);
assert.equal(r.snapshot.currentAttempt.isError,true);
assert.match(r.snapshot.currentAttempt.content.map(c=>c.text).join('\n'),/snapshots limit exceeded/);
assert.deepEqual(r.snapshot.schedule.schedule,[]);
assert.equal(r.plan.observed,'free_v3');assert.equal(r.plan.paidUpgrade,false);
console.log('REAL_NEON_RETAINED_EVIDENCE_PASS: genuine restart, 22 exact table digests, current schema/roles/RLS, restricted tenant probes, disabled recovery compute; snapshot capacity remains blocked.');
