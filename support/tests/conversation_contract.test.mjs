import assert from 'node:assert/strict';
import test from 'node:test';
import * as support from '../control_plane.js';

test('support conversation messages classify customer, agent and internal visibility', async () => {
  assert.equal(typeof support.createConversationMessage, 'function');
  const customer = await support.createConversationMessage({
    caseId: 'AX-0123456789AB',
    type: 'CUSTOMER_MESSAGE',
    actor: 'requester',
    visibility: 'customer',
    body: 'Here is the requested reproduction detail.',
    at: '2026-10-08T10:00:00Z',
  });
  const agent = await support.createConversationMessage({
    caseId: 'AX-0123456789AB',
    type: 'AGENT_REPLY',
    actor: 'support_agent:owner',
    visibility: 'customer',
    body: 'We reproduced the issue and are investigating.',
    at: '2026-10-08T10:05:00Z',
  });
  const note = await support.createConversationMessage({
    caseId: 'AX-0123456789AB',
    type: 'INTERNAL_NOTE',
    actor: 'support_agent:owner',
    visibility: 'internal',
    body: 'Escalate to runtime engineering if the next trace confirms the hypothesis.',
    at: '2026-10-08T10:06:00Z',
  });
  assert.equal(customer.visibility, 'customer');
  assert.equal(agent.type, 'AGENT_REPLY');
  assert.equal(note.visibility, 'internal');
  assert.match(customer.message_id, /^AXM-[0-9A-HJKMNP-TV-Z]{16}$/);
  assert.equal(customer.case_id, 'AX-0123456789AB');
  assert.equal(customer.body, 'Here is the requested reproduction detail.');
});

test('conversation contract rejects visibility/type mismatch, secrets and invalid actors', async () => {
  assert.equal(typeof support.createConversationMessage, 'function');
  await assert.rejects(() => support.createConversationMessage({
    caseId: 'AX-0123456789AB', type: 'INTERNAL_NOTE', actor: 'support_agent:owner',
    visibility: 'customer', body: 'must not leak', at: '2026-10-08T10:00:00Z',
  }), /visibility/i);
  await assert.rejects(() => support.createConversationMessage({
    caseId: 'AX-0123456789AB', type: 'AGENT_REPLY', actor: 'requester',
    visibility: 'customer', body: 'wrong authority', at: '2026-10-08T10:00:00Z',
  }), /actor/i);
  await assert.rejects(() => support.createConversationMessage({
    caseId: 'AX-0123456789AB', type: 'CUSTOMER_MESSAGE', actor: 'requester',
    visibility: 'customer', body: 'Authorization: Bearer sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
    at: '2026-10-08T10:00:00Z',
  }), support.SecretMaterialError);
});

test('frontier-style public support labels map deterministically onto existing storage states', () => {
  assert.equal(typeof support.storageStateForPublicLabel, 'function');
  assert.equal(support.storageStateForPublicLabel('NEW'), 'NEW');
  assert.equal(support.storageStateForPublicLabel('IN_PROGRESS_MUSITU_SUPPORT'), 'IN_PROGRESS');
  assert.equal(support.storageStateForPublicLabel('ACTION_REQUIRED'), 'WAITING_FOR_CUSTOMER');
  assert.equal(support.storageStateForPublicLabel('SOLUTION_PROVIDED'), 'RESOLVED');
  assert.equal(support.storageStateForPublicLabel('CLOSED'), 'CLOSED');
  assert.equal(support.storageStateForPublicLabel('ESCALATED'), 'TRIAGED');
  assert.throws(() => support.storageStateForPublicLabel('UNKNOWN'), /unknown/i);
});
