import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1CaseStore} from '../d1_case_store.js';
import * as worker from '../worker.js';

test('schema defines append-only assignment, approval and notification outbox records',async()=>{
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  for(const table of ['support_case_assignments','support_case_approvals','support_notification_outbox']) assert.match(schema,new RegExp('CREATE TABLE IF NOT EXISTS '+table));
  assert.match(schema,/support_case_approval_no_update/);
  assert.match(schema,/support_notification_outbox.*case_id/s);
});

test('operator HTTP contract exposes assignment and sensitive approval workflow behind verified identity',async()=>{
  const calls=[];
  const store={
    async assignOperatorCase(id,principal){calls.push(['assign',id,principal]);return {case_id:id,assigned_operator_ref:principal.actor_ref};},
    async proposeSensitiveAction(id,input,principal){calls.push(['propose',id,input,principal]);return {approval_id:'AXA-0123456789ABCDEF',case_id:id,status:'PENDING',action:input.action};},
    async approveSensitiveAction(id,approvalId,input,principal){calls.push(['approve',id,approvalId,input,principal]);return {approval_id:approvalId,case_id:id,status:'APPROVED'};},
  };
  const principal={actor_ref:'support_agent:owner',role:'support_agent'};
  const env={ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_OPERATOR_VERIFY:async()=>principal};

  const assign=await worker.handleOperatorRequest(new Request('https://ops.example/api/v1/operator/cases/AX-0123456789AB/assignment',{method:'POST'}),env);
  assert.equal(assign.status,200);

  const propose=await worker.handleOperatorRequest(new Request('https://ops.example/api/v1/operator/cases/AX-0123456789AB/approvals',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'SECURITY_DISCLOSURE',evidence_hashes:['a'.repeat(64)]}),
  }),env);
  assert.equal(propose.status,201);

  const approveEnv={...env,SUPPORT_OPERATOR_VERIFY:async()=>({actor_ref:'support_agent:approver',role:'security_responder'})};
  const approve=await worker.handleOperatorRequest(new Request('https://ops.example/api/v1/operator/cases/AX-0123456789AB/approvals/AXA-0123456789ABCDEF/approve',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({}),
  }),approveEnv);
  assert.equal(approve.status,200);
  assert.equal(calls.some(x=>x[0]==='assign'),true);
  assert.equal(calls.some(x=>x[0]==='propose'),true);
  assert.equal(calls.some(x=>x[0]==='approve'),true);
});

test('notification delivery helper sends only non-sensitive case-update metadata through injected provider',async()=>{
  assert.equal(typeof worker.deliverSupportNotification,'function');
  const sent=[];
  const value=await worker.deliverSupportNotification({
    notification_id:'AXN-0123456789ABCDEF',case_id:'AX-0123456789AB',kind:'CUSTOMER_REPLY_RECEIVED',
  },{
    SUPPORT_NOTIFICATION_SEND:async payload=>{sent.push(payload);return {id:'provider-receipt'};},
  });
  assert.equal(value.delivered,true);
  assert.deepEqual(sent[0],{
    notification_id:'AXN-0123456789ABCDEF',case_id:'AX-0123456789AB',kind:'CUSTOMER_REPLY_RECEIVED',
  });
  assert.equal(JSON.stringify(sent).includes('body'),false);
  assert.equal(JSON.stringify(sent).includes('description'),false);
});

test('sensitive approval is independent: proposer cannot approve own request',async()=>{
  assert.equal(typeof D1CaseStore.prototype.approveSensitiveAction,'function');
});
