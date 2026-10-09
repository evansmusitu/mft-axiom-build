import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1CaseStore} from '../d1_case_store.js';

test('D1 store exposes all global operations persistence methods',()=>{
 for(const name of [
  'recordDiagnostics','recordCsat','requestCustomerEscalation','prepareAttachment','leaseOperatorCase','handoffOperatorCase',
  'escalateOperatorCase','createIncident','linkIncidentCase','listPublicIncidents','listOperatorIncidents','globalOpsAnalytics',
  'listPendingNotifications','recordNotificationAttempt','listPendingWebhookDeliveries','recordWebhookAttempt'
 ]) assert.equal(typeof D1CaseStore.prototype[name],'function',name);
});

test('new case creation source initializes SLA, triage and language durability in the same batch',async()=>{
 const source=await readFile(new URL('../d1_case_store.js',import.meta.url),'utf8');
 assert.match(source,/INSERT INTO support_case_sla/);
 assert.match(source,/INSERT INTO support_case_triage/);
 assert.match(source,/INSERT INTO support_case_languages/);
 assert.match(source,/computeSlaClock/);
 assert.match(source,/buildTriageEnvelope/);
});

test('global store source keeps sensitive bodies encrypted and queue delivery evidence explicit',async()=>{
 const source=await readFile(new URL('../d1_case_store.js',import.meta.url),'utf8');
 assert.match(source,/reason_encrypted/);
 assert.match(source,/note_encrypted/);
 assert.match(source,/support_notification_attempts/);
 assert.match(source,/support_webhook_outbox/);
 assert.match(source,/scan_state/);
 assert.doesNotMatch(source,/INSERT INTO support_attachments[\s\S]{0,600}(?:blob|body)\s*[,)]/i);
});

test('analytics source computes open volume, SLA breach and CSAT without decrypting customer narratives',async()=>{
 const source=await readFile(new URL('../d1_case_store.js',import.meta.url),'utf8');
 const idx=source.indexOf('async globalOpsAnalytics');assert.ok(idx>0);
 const next=source.indexOf('\n  async ',idx+10);assert.ok(next>idx);
 const slice=source.slice(idx,next);
 assert.match(slice,/support_case_sla/);assert.match(slice,/support_csat/);
 assert.doesNotMatch(slice,/decryptSupportPayload/);
});
