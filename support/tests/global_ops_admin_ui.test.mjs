import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1CaseStore} from '../d1_case_store.js';
import {handleOperatorRequest,processSupportQueues} from '../worker.js';

test('store exposes advanced global operations administration primitives',()=>{
 for(const name of [
  'scanSlaBreaches','bindEmailThread','appendInboundEmailByThread','upsertOrganization','setOrganizationEntitlement',
  'createWebhookSubscription','enqueueWebhookForCase','createOperatorMacro','listOperatorMacros','recordQaReview',
  'updateIncidentStatus','setCaseTriage','listSlaBreaches'
 ]) assert.equal(typeof D1CaseStore.prototype[name],'function',name);
});

function fake(){const calls=[];return {calls,
 async globalOpsAnalytics(){return {open_cases:2,sla_breached:1};},
 async upsertOrganization(i,p){calls.push(['org',i,p]);return {org_ref:i.org_ref,plan:i.plan};},
 async setOrganizationEntitlement(ref,i,p){calls.push(['entitlement',ref,i,p]);return {org_ref:ref,capability:i.capability,enabled:i.enabled};},
 async createWebhookSubscription(i,p){calls.push(['webhook',i,p]);return {webhook_ref:i.webhook_ref,enabled:true};},
 async createOperatorMacro(i,p){calls.push(['macro',i,p]);return {macro_id:'AXK-0123456789ABCDEF',name:i.name};},
 async listOperatorMacros(p){return [{macro_id:'AXK-0123456789ABCDEF',name:'Request logs'}];},
 async recordQaReview(id,i,p){calls.push(['qa',id,i,p]);return {review_id:'AXJ-0123456789ABCDEF',case_id:id};},
 async updateIncidentStatus(id,i,p){calls.push(['incident-status',id,i,p]);return {incident_id:id,state:i.state};},
 async setCaseTriage(id,i,p){calls.push(['triage',id,i,p]);return {case_id:id,lane:i.lane,language:i.language};},
 async listSlaBreaches(){return [{case_id:'AX-0123456789AB',breach:'ACK'}];},
 async scanSlaBreaches(){calls.push(['sla-scan']);return {new_breaches:1};},
 async listPendingNotifications(){return [];},async listPendingWebhookDeliveries(){return [];}
};}
const env=store=>({ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_OPERATOR_VERIFY:async()=>({actor_ref:'support_agent:owner',role:'support_agent'})});

test('operator admin routes manage organizations, entitlements, webhooks, macros, QA, status and triage',async()=>{
 const s=fake(),e=env(s);
 const cases=[
  ['/api/v1/operator/organizations','POST',{org_ref:'org:acme001',plan:'ENTERPRISE'},201],
  ['/api/v1/operator/organizations/org:acme001/entitlements','POST',{capability:'priority_support',enabled:true},201],
  ['/api/v1/operator/webhooks','POST',{webhook_ref:'webhook:acme001',org_ref:'org:acme001',endpoint_ref:'vault:endpoint001',secret_ref:'vault:secret001',event_types:['case.updated']},201],
  ['/api/v1/operator/macros','POST',{name:'Request logs',body:'Please attach sanitized logs.'},201],
  ['/api/v1/operator/cases/AX-0123456789AB/qa','POST',{quality:5,policy:5,accuracy:5,notes:'Good handling.'},201],
  ['/api/v1/operator/incidents/AXI-0123456789ABCDEF/status','POST',{state:'MONITORING',public_message:'Fix deployed; monitoring.'},200],
  ['/api/v1/operator/cases/AX-0123456789AB/triage','POST',{lane:'PRODUCT_ENGINEERING',language:'en'},200]
 ];
 for(const [path,method,body,status] of cases){const r=await handleOperatorRequest(new Request('https://ops.example'+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)}),e);assert.equal(r.status,status,path);}
 const macros=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/macros'),e);assert.equal(macros.status,200);
 const sla=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/sla/breaches'),e);assert.equal(sla.status,200);
});

test('scheduled processing scans SLA breaches before delivery queues',async()=>{
 const s=fake();const result=await processSupportQueues(env(s));
 assert.equal(result.sla.new_breaches,1);assert.equal(s.calls[0][0],'sla-scan');
});

test('status and operator UI expose global operations without claiming 24/7 staffing',async()=>{
 const [statusHtml,consoleHtml,consoleJs,publicHtml]=await Promise.all([
  readFile(new URL('../status/index.html',import.meta.url),'utf8'),
  readFile(new URL('../console/index.html',import.meta.url),'utf8'),
  readFile(new URL('../console/app.js',import.meta.url),'utf8'),
  readFile(new URL('../index.html',import.meta.url),'utf8')
 ]);
 assert.match(statusHtml,/Service status/i);assert.match(statusHtml,/api\/v1\/status/i);
 for(const label of ['SLA','Incidents','Escalations','Analytics','QA','Macros'])assert.match(consoleHtml,new RegExp(label,'i'));
 assert.match(consoleJs,/\/api\/v1\/operator\/analytics/);assert.match(consoleJs,/\/api\/v1\/operator\/sla\/breaches/);
 assert.match(publicHtml,/diagnostics/i);assert.match(publicHtml,/attachment/i);assert.match(publicHtml,/satisfaction|feedback/i);
 assert.doesNotMatch(statusHtml,/24\/7 guaranteed|guaranteed 24\/7/i);
});
