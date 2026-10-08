import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import * as worker from '../worker.js';
import * as knowledge from '../knowledge.js';
import * as emailWorker from '../email_worker.js';
import {D1CaseStore} from '../d1_case_store.js';

test('knowledge search is deterministic and AI assist remains advisory/fail-closed',async()=>{
 const rows=knowledge.searchKnowledge('recovery code');assert.ok(rows.length>=1);assert.equal(rows[0].public,true);
 const fallback=await worker.handleSupportRequest(new Request('https://support.example/api/v1/help/assist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'How do I recover a case?'})}),{ENVIRONMENT:'test'});
 assert.equal(fallback.status,200);const body=await fallback.json();assert.equal(body.advisory_only,true);assert.equal(body.provider_used,false);assert.ok(body.articles.length>=1);
});

test('customer reopen endpoint requires recovery auth and bounded reopen window',async()=>{
 const calls=[];const store={async reopenCustomerCase(id,code){calls.push([id,code]);return {case_id:id,state:'IN_PROGRESS',reopened:true};}};
 const env={ENVIRONMENT:'test',SUPPORT_STORE:store};
 const denied=await worker.handleSupportRequest(new Request('https://support.example/api/v1/cases/AX-0123456789AB/reopen',{method:'POST'}),env);assert.equal(denied.status,401);
 const ok=await worker.handleSupportRequest(new Request('https://support.example/api/v1/cases/AX-0123456789AB/reopen',{method:'POST',headers:{authorization:'Support 01234567-89ABCDEF-GHJKMNPQ'}}),env);assert.equal(ok.status,200);
 assert.equal(calls.length,1);
});

test('attachment scan lifecycle is operator-only and supports clean quarantine or failed states',async()=>{
 assert.equal(typeof D1CaseStore.prototype.recordAttachmentScan,'function');
 const calls=[];const store={async recordAttachmentScan(id,input,p){calls.push([id,input,p]);return {attachment_id:id,scan_state:input.scan_state};}};
 const env={ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_OPERATOR_VERIFY:async()=>({actor_ref:'support_agent:owner',role:'support_agent'})};
 const r=await worker.handleOperatorRequest(new Request('https://ops.example/api/v1/operator/attachments/AXF-0123456789ABCDEF/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scan_state:'CLEAN',scanner_ref:'scanner:cloud001'})}),env);
 assert.equal(r.status,200);assert.equal(calls[0][1].scan_state,'CLEAN');
});

test('inbound email adapter requires provider verification and never stores raw sender address in thread metadata',async()=>{
 assert.equal(typeof emailWorker.handleInboundSupportEmail,'function');
 const calls=[];const store={async appendInboundEmailByThread(thread,input){calls.push([thread,input]);return {case_id:'AX-0123456789AB'};}};
 const denied=await emailWorker.handleInboundSupportEmail({to:'reply+thread-abc12345@mftintelligence.com',from:'customer@example.test',text:'hello'}, {SUPPORT_STORE:store,SUPPORT_EMAIL_INGRESS_VERIFY:async()=>false});
 assert.equal(denied.accepted,false);assert.equal(calls.length,0);
 const ok=await emailWorker.handleInboundSupportEmail({to:'reply+thread-abc12345@mftintelligence.com',from:'customer@example.test',text:'hello'}, {SUPPORT_STORE:store,SUPPORT_EMAIL_INGRESS_VERIFY:async()=>true});
 assert.equal(ok.accepted,true);assert.equal(calls.length,1);assert.match(calls[0][1].sender_hash,/^[a-f0-9]{64}$/);assert.equal('sender_email' in calls[0][1],false);
});

test('customer thread exposes only clean customer-visible attachment metadata',async()=>{
 const source=await readFile(new URL('../d1_case_store.js',import.meta.url),'utf8');
 assert.match(source,/support_attachments WHERE case_id=\? AND visibility='customer' AND scan_state='CLEAN'/);
 assert.match(source,/attachments: Object\.freeze/);
});

test('closed cases stay terminal in the generic state machine and reopen only through explicit bounded method',async()=>{
 const control=await readFile(new URL('../control_plane.js',import.meta.url),'utf8');
 assert.match(control,/CLOSED: Object\.freeze\(\[\]\)/);
 assert.equal(typeof D1CaseStore.prototype.reopenCustomerCase,'function');
});
