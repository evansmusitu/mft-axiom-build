import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('sensitive recovery schema has immutable request evidence and no raw identity fields',async()=>{
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS support_case_recovery_requests/);
  assert.match(schema,/request_id TEXT PRIMARY KEY CHECK \(request_id GLOB 'AXQ-\*'\)/);
  assert.match(schema,/identity_hash TEXT NOT NULL CHECK \(length\(identity_hash\) = 64\)/);
  assert.match(schema,/evidence_hash TEXT NOT NULL CHECK \(length\(evidence_hash\) = 64\)/);
  assert.match(schema,/support_case_recovery_request_no_update/);
  assert.doesNotMatch(schema,/support_case_recovery_requests[\s\S]{0,1000}(email|jwt|otp|subject) TEXT/i);
});

test('store source creates a deduplicated recovery approval request and metadata-only operator notification',async()=>{
  const source=await readFile(new URL('../d1_case_store.js',import.meta.url),'utf8');
  assert.match(source,/RECOVERY_APPROVAL_REQUIRED/);
  assert.match(source,/INSERT INTO support_case_recovery_requests/);
  assert.match(source,/support_notification_outbox/);
  assert.match(source,/RECOVERY_APPROVAL_REQUIRED['"]/);
  assert.match(source,/getOperatorCase[\s\S]*support_case_recovery_requests/);
  assert.doesNotMatch(source,/recovery_requests[\s\S]{0,600}identity_hash:item\.identity_hash/);
});

test('operator console exposes account-recovery governance and independent approval decision controls',async()=>{
  const [html,js]=await Promise.all([
    readFile(new URL('../console/index.html',import.meta.url),'utf8'),
    readFile(new URL('../console/app.js',import.meta.url),'utf8'),
  ]);
  assert.match(html,/ACCOUNT_RECOVERY/);
  assert.match(html,/id="recovery-governance"/);
  assert.match(js,/recovery_requests/);
  assert.match(js,/ACCOUNT_RECOVERY/);
  assert.match(js,/\/approvals\/.*\/approve/s);
  assert.match(js,/APPROVED/);
  assert.match(js,/REJECTED/);
});
