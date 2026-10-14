import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('Phase 1 release is blocked in absence of independently earned live approvals',()=>{
 const r=spawnSync(process.execPath,['scripts/phase1-release-gate.mjs'],{encoding:'utf8'});
 assert.equal(r.status,2);const o=JSON.parse(r.stdout);
 assert.equal(o.status,'PHASE1_RELEASE_BLOCKED');
 assert.ok(o.blocked.includes('native_postgresql_17_migrations_rls_concurrency_recovery'));
 assert.ok(o.blocked.includes('authorized_meta_development_account_end_to_end'));
 assert.ok(o.blocked.includes('live_keycloak_oidc_and_membership_mfa'));
});
