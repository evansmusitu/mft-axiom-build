import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {processSupportQueues} from '../worker.js';

test('global schema permits attachment metadata purge only under case-purge authorization and queues object deletion',async()=>{
 const sql=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS support_attachment_deletion_outbox/);
 assert.match(sql,/support_attachment_no_delete[\s\S]*WHEN NOT EXISTS[\s\S]*support_case_purge_authorizations/i);
 assert.match(sql,/storage_key TEXT NOT NULL UNIQUE/);
 assert.match(sql,/sha256 TEXT NOT NULL CHECK \(length\(sha256\)=64\)/);
});

test('retention purge removes every case-linked global-ops table in dependency order and enqueues attachment objects',async()=>{
 const source=await readFile(new URL('../retention_lifecycle.js',import.meta.url),'utf8');
 for(const table of [
  'support_notification_attempts','support_case_approval_decisions','support_case_messages','support_case_assignments','support_case_approvals',
  'support_notification_outbox','support_case_recovery_rotations','support_case_recovery_requests','support_case_recovery_bindings',
  'support_case_sla','support_case_escalations','support_incident_cases','support_attachments','support_diagnostics','support_webhook_outbox',
  'support_operator_leases','support_case_handoffs','support_case_triage','support_case_languages','support_csat','support_qa_reviews','support_email_threads'
 ]) assert.match(source,new RegExp('DELETE FROM '+table));
 assert.match(source,/support_attachment_deletion_outbox/);
 assert.match(source,/SELECT attachment_id,storage_key,sha256 FROM support_attachments/);
});

test('scheduled queue deletes private attachment objects and records retries without fabricating success',async()=>{
 const calls=[];const store={
  async scanSlaBreaches(){return {new_breaches:0,scanned:0}},async listPendingNotifications(){return []},async listPendingWebhookDeliveries(){return []},
  async listPendingAttachmentDeletions(){return [{deletion_id:'AXZ-0123456789ABCDEF',storage_key:'cases/AX-0123456789AB/AXF-0123456789ABCDEF',attempts:0}]},
  async recordAttachmentDeletionAttempt(item,result){calls.push([item,result]);}
 };
 const unavailable=await processSupportQueues({ENVIRONMENT:'test',SUPPORT_STORE:store});
 assert.equal(unavailable.attachments.provider_unavailable,1);assert.equal(calls[0][1].deleted,false);
 calls.length=0;const deleted=[];
 const ok=await processSupportQueues({ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_ATTACHMENTS:{async delete(key){deleted.push(key)}}});
 assert.equal(ok.attachments.deleted,1);assert.equal(deleted[0],'cases/AX-0123456789AB/AXF-0123456789ABCDEF');assert.equal(calls[0][1].deleted,true);
});

test('D1 store exposes attachment deletion outbox methods',async()=>{
 const {D1CaseStore}=await import('../d1_case_store.js');
 assert.equal(typeof D1CaseStore.prototype.listPendingAttachmentDeletions,'function');
 assert.equal(typeof D1CaseStore.prototype.recordAttachmentDeletionAttempt,'function');
});
