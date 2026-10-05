import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORT_SURFACES, SUPPORT_CATEGORIES, CASE_STATES, PRIORITY_OBJECTIVES,
  inspectSecretMaterial, SecretMaterialError, validateIntake, derivePriority,
  createCaseRecord, appendCaseEvent, verifyEventChain, assertTransition,
  evaluateSensitiveAction, publicCaseView,
} from '../control_plane.js';

const intake = (overrides = {}) => ({
  surface: 'quantitative_result', category: 'calculation_dispute', affected_scope: 'self',
  summary: 'NPV result needs verification', description: 'The result differs from an independent worksheet.',
  reproduction: 'Use the listed cash-flow artifact reference.', impact: 'A decision is waiting for verification.',
  evidence_refs: [{kind: 'request_id', value: 'request_12345678'}], consent_to_process: true,
  ...overrides,
});

test('whole-product taxonomy covers provider, result, privacy, security and incident support', () => {
  for (const surface of ['web_app', 'mcp_openai', 'mcp_claude', 'oauth_account', 'quantitative_result', 'billing_commerce', 'privacy_data_rights', 'security', 'status_incident']) assert.ok(SUPPORT_SURFACES.includes(surface));
  for (const category of ['access', 'calculation_dispute', 'privacy_request', 'security_report', 'accessibility', 'incident']) assert.ok(SUPPORT_CATEGORIES.includes(category));
  assert.deepEqual(CASE_STATES.slice(0, 4), ['NEW', 'TRIAGED', 'WAITING_FOR_CUSTOMER', 'IN_PROGRESS']);
  assert.equal(PRIORITY_OBJECTIVES.P0.acknowledge_minutes, 15);
});

test('clean intake validates and forbids raw contact details', () => {
  assert.equal(validateIntake(intake()).ok, true);
  const invalid = validateIntake(intake({email: 'person@example.test'}));
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(' '), /raw contact details/);
});

test('secret detector reports only type and path and never echoes the match', () => {
  const submittedSecret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
  const result = inspectSecretMaterial({description: `accidentally pasted ${submittedSecret}`});
  assert.equal(result.safe, false);
  assert.deepEqual(result.findings[0], {path: 'intake.description', type: 'openai_key'});
  assert.doesNotMatch(JSON.stringify(result), new RegExp(submittedSecret));
  assert.throws(() => validateIntake(intake({description: `Authorization: Bearer ${submittedSecret}`})), SecretMaterialError);
});

test('payment-card candidates that pass Luhn are rejected before storage', () => {
  const result = inspectSecretMaterial({description: 'card 4111 1111 1111 1111'});
  assert.equal(result.safe, false);
  assert.equal(result.findings.some(item => item.type === 'payment_card_number'), true);
});

test('priority is impact-derived rather than customer selected', () => {
  assert.equal(derivePriority(intake({category: 'security_report', active_exploitation: true})), 'P0');
  assert.equal(derivePriority(intake({affected_scope: 'organization'})), 'P1');
  assert.equal(derivePriority(intake()), 'P2');
  assert.equal(derivePriority(intake({category: 'documentation'})), 'P3');
});

test('case creation stores only a recovery hash and produces a valid initial chain', async () => {
  const bundle = await createCaseRecord(intake(), {
    at: '2026-10-05T10:00:00Z', caseId: 'AX-0123456789AB', recoveryCode: '01234567-89ABCDEF-GHJKMNPQ',
  });
  assert.equal(bundle.case_record.case_id, 'AX-0123456789AB');
  assert.match(bundle.case_record.recovery_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(bundle.case_record.recovery_hash, bundle.recovery_code);
  assert.equal(bundle.case_record.last_event_hash, bundle.initial_event.event_hash);
  assert.equal(await verifyEventChain([bundle.initial_event]), true);
  const view = publicCaseView(bundle.case_record);
  assert.equal('recovery_hash' in view, false);
  assert.equal(view.service_objective_is_guarantee, false);
});

test('event chain rejects tampering and secret-bearing events', async () => {
  const bundle = await createCaseRecord(intake(), {at: '2026-10-05T10:00:00Z', caseId: 'AX-0123456789AB', recoveryCode: '01234567-89ABCDEF-GHJKMNPQ'});
  const second = await appendCaseEvent(bundle.case_record, {type: 'TRIAGED', actor: 'support_agent_1', visibility: 'customer', payload: {state: 'TRIAGED'}}, {at: '2026-10-05T10:05:00Z'});
  assert.equal(await verifyEventChain([bundle.initial_event, second]), true);
  assert.equal(await verifyEventChain([bundle.initial_event, {...second, payload: {state: 'CLOSED'}}]), false);
  await assert.rejects(() => appendCaseEvent(bundle.case_record, {type: 'NOTE', actor: 'support_agent_1', visibility: 'internal', payload: {password: 'do-not-store-this'}}, {at: '2026-10-05T10:05:00Z'}), SecretMaterialError);
});

test('state machine fails closed on invalid transitions', () => {
  assert.equal(assertTransition('NEW', 'TRIAGED'), true);
  assert.throws(() => assertTransition('NEW', 'RESOLVED'), /not allowed/);
  assert.throws(() => assertTransition('CLOSED', 'IN_PROGRESS'), /not allowed/);
});

test('sensitive actions need verification, evidence and an independent human', () => {
  const noCustomer = evaluateSensitiveAction({action: 'DATA_DELETION', actorRole: 'privacy_officer'});
  assert.deepEqual(noCustomer, {allowed: false, gate: 'CUSTOMER_VERIFICATION', authority_effect: 'NONE'});
  const noApprover = evaluateSensitiveAction({action: 'DATA_DELETION', actorRole: 'privacy_officer', customerVerified: true, evidenceHashes: ['a'.repeat(64)]});
  assert.equal(noApprover.gate, 'INDEPENDENT_HUMAN_APPROVAL');
  const allowed = evaluateSensitiveAction({action: 'DATA_DELETION', actorRole: 'privacy_officer', customerVerified: true, independentApprover: 'security_responder', evidenceHashes: ['a'.repeat(64)]});
  assert.deepEqual(allowed, {allowed: true, gate: 'OPERATION_SCOPED_EXECUTOR', authority_effect: 'ADMISSION_ONLY'});
});
