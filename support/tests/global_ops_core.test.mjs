import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import * as ops from '../global_ops.js';

test('SLA clocks are deterministic by priority and support plan',()=>{
  assert.equal(typeof ops.computeSlaClock,'function');
  const c=ops.computeSlaClock({priority:'P0',plan:'BUSINESS',createdAt:'2026-10-08T10:00:00Z'});
  assert.equal(c.ack_due_at,'2026-10-08T10:15:00.000Z');
  assert.equal(c.update_due_at,'2026-10-08T11:00:00.000Z');
  assert.ok(Date.parse(c.resolve_target_at)>Date.parse(c.update_due_at));
  assert.equal(c.contractual,false);
  assert.equal(ops.evaluateSla(c,{now:'2026-10-08T10:20:00Z',acknowledgedAt:null,lastMeaningfulUpdateAt:null,resolvedAt:null}).breaches.includes('ACK'),true);
});

test('routing maps sensitive domains to explicit escalation lanes',()=>{
  assert.equal(ops.escalationLane({category:'security_report'}),'SECURITY');
  assert.equal(ops.escalationLane({category:'privacy_request'}),'PRIVACY');
  assert.equal(ops.escalationLane({category:'billing'}),'BILLING');
  assert.equal(ops.escalationLane({category:'calculation_dispute',surface:'quantitative_result'}),'QUANT_ENGINEERING');
  assert.equal(ops.escalationLane({category:'bug',surface:'web_app'}),'PRODUCT_ENGINEERING');
});

test('support plans expose entitlements without promising staffing that is not evidenced',()=>{
  assert.deepEqual(ops.supportPlan('COMMUNITY').channels,['web']);
  assert.equal(ops.supportPlan('ENTERPRISE').customer_escalation,true);
  assert.equal(ops.supportPlan('ENTERPRISE').contractual_sla,false);
  assert.throws(()=>ops.supportPlan('ULTRA'),/unknown/i);
});

test('attachment metadata rejects unsafe size/type/name and requires external object storage',()=>{
  const good=ops.validateAttachmentMetadata({
    attachmentId:'AXF-0123456789ABCDEF',caseId:'AX-0123456789AB',filename:'trace.txt',
    contentType:'text/plain',bytes:1024,sha256:'a'.repeat(64),storageKey:'cases/AX-0123456789AB/AXF-0123456789ABCDEF'
  });
  assert.equal(good.ok,true);
  assert.equal(good.value.scan_state,'PENDING');
  assert.equal(good.value.inline_blob_allowed,false);
  assert.equal(ops.validateAttachmentMetadata({...good.value,filename:'payload.exe'}).ok,false);
  assert.equal(ops.validateAttachmentMetadata({...good.value,bytes:30*1024*1024}).ok,false);
});

test('diagnostics require explicit consent and reject forbidden auth-like keys',()=>{
  const denied=ops.validateDiagnostics({consent:false,browser:'Chrome',request_id:'r-1'});
  assert.equal(denied.ok,false);
  const good=ops.validateDiagnostics({consent:true,browser:'Chrome',os:'Android',app_version:'1.2.3',request_id:'r-1'});
  assert.equal(good.ok,true);
  const bad=ops.validateDiagnostics({consent:true,authorization:'Bearer abc',browser:'Chrome'});
  assert.equal(bad.ok,false);
});

test('language routing is bounded and AI triage is explicitly advisory',()=>{
  assert.equal(ops.normalizeLanguage('en-US'),'en');
  assert.equal(ops.normalizeLanguage('fr-FR'),'fr');
  assert.equal(ops.normalizeLanguage('xx-INVALID'),'und');
  const t=ops.buildTriageEnvelope({case_id:'AX-0123456789AB',priority:'P1',category:'incident',surface:'api_runtime',language:'en'});
  assert.equal(t.advisory_only,true);
  assert.equal(t.human_review_required,true);
  assert.equal(t.lane,'INCIDENT');
});

test('webhook events are metadata-only and CSAT/QA records validate bounded scores',()=>{
  const event=ops.buildWebhookEvent({type:'case.updated',caseId:'AX-0123456789AB',state:'IN_PROGRESS',priority:'P1',eventHash:'a'.repeat(64),at:'2026-10-08T10:00:00Z'});
  assert.equal(event.case_id,'AX-0123456789AB');
  assert.equal('body' in event,false);
  assert.equal(ops.validateCsat({score:5,reason:'resolved quickly'}).ok,true);
  assert.equal(ops.validateCsat({score:7}).ok,false);
  assert.equal(ops.validateQaReview({quality:4,policy:5,accuracy:5,reviewerRef:'support_agent:qa'}).ok,true);
});

test('operator leases prevent silent concurrent ownership',()=>{
  const lease=ops.createOperatorLease({caseId:'AX-0123456789AB',operatorRef:'support_agent:owner',at:'2026-10-08T10:00:00Z',minutes:10});
  assert.equal(lease.expires_at,'2026-10-08T10:10:00.000Z');
  assert.equal(ops.leaseActive(lease,'2026-10-08T10:09:59Z'),true);
  assert.equal(ops.leaseActive(lease,'2026-10-08T10:10:00Z'),false);
});

test('global operations schema contains required durable surfaces and avoids plaintext attachment blobs',async()=>{
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  for(const name of [
    'support_case_sla','support_case_escalations','support_incidents','support_incident_cases',
    'support_organizations','support_support_entitlements','support_attachments','support_diagnostics',
    'support_webhook_subscriptions','support_webhook_outbox','support_notification_attempts',
    'support_operator_leases','support_case_handoffs','support_operator_macros','support_case_triage',
    'support_case_languages','support_csat','support_qa_reviews','support_status_updates','support_email_threads'
  ]) assert.equal(schema.includes('CREATE TABLE IF NOT EXISTS '+name),true,name);
  assert.doesNotMatch(schema,/support_attachments[\s\S]{0,1200}\b(?:blob|body|content)\s+BLOB/i);
  assert.doesNotMatch(schema,/support_email_threads[\s\S]{0,1000}\bemail\s+TEXT/i);
});
