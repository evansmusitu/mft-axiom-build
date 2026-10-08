import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import * as control from '../control_plane.js';
import {D1CaseStore} from '../d1_case_store.js';

test('recovery identity hash is deterministic, opaque, and issuer-bound', async () => {
  assert.equal(typeof control.recoveryIdentityHash,'function');
  const a=await control.recoveryIdentityHash({issuer:'https://team.cloudflareaccess.com/',subject:'opaque-subject-123'});
  const b=await control.recoveryIdentityHash({issuer:'https://team.cloudflareaccess.com',subject:'opaque-subject-123'});
  const c=await control.recoveryIdentityHash({issuer:'https://other.cloudflareaccess.com',subject:'opaque-subject-123'});
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.equal(a.includes('opaque-subject-123'),false);
  await assert.rejects(()=>control.recoveryIdentityHash({issuer:'',subject:'x'}),/identity/i);
});

test('schema adds append-only recovery identity binding and rotation records without plaintext identity', async () => {
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS support_case_recovery_bindings/);
  assert.match(schema,/identity_hash TEXT NOT NULL CHECK \(length\(identity_hash\) = 64\)/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS support_case_recovery_rotations/);
  assert.match(schema,/prior_recovery_hash TEXT NOT NULL CHECK \(length\(prior_recovery_hash\) = 64\)/);
  assert.match(schema,/new_recovery_hash TEXT NOT NULL CHECK \(length\(new_recovery_hash\) = 64\)/);
  assert.match(schema,/support_case_recovery_binding_no_update/);
  assert.match(schema,/support_case_recovery_rotation_no_update/);
  assert.doesNotMatch(schema,/identity_email|email TEXT|jwt TEXT|otp TEXT/i);
});

test('D1 store exposes bind and rotate recovery operations', () => {
  assert.equal(typeof D1CaseStore.prototype.bindRecoveryIdentity,'function');
  assert.equal(typeof D1CaseStore.prototype.rotateRecoveryCredential,'function');
});

test('sensitive actions already classify account recovery as approval-gated', () => {
  assert.equal(control.SENSITIVE_ACTIONS.includes('ACCOUNT_RECOVERY'),true);
  const denied=control.evaluateSensitiveAction({
    action:'ACCOUNT_RECOVERY',actorRole:'support_agent',customerVerified:true,evidenceHashes:['a'.repeat(64)]
  });
  assert.equal(denied.allowed,false);
  assert.equal(denied.gate,'INDEPENDENT_HUMAN_APPROVAL');
});
