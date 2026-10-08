import assert from 'node:assert/strict';
import test from 'node:test';
import {handleSupportRequest,handleOperatorRequest,processSupportQueues} from '../worker.js';

const caseId='AX-0123456789AB';
const recovery='01234567-89ABCDEF-GHJKMNPQ';
function fake(){
 const calls=[];
 return {calls,
  async recordDiagnostics(id,code,input){calls.push(['diag',id,code,input]);return {diagnostic_id:'AXG-0123456789ABCDEF',case_id:id};},
  async recordCsat(id,code,input){calls.push(['csat',id,code,input]);return {response_id:'AXC-0123456789ABCDEF',case_id:id,score:input.score};},
  async requestCustomerEscalation(id,code,input){calls.push(['cust-escalate',id,code,input]);return {escalation_id:'AXE-0123456789ABCDEF',case_id:id,lane:'PRODUCT_ENGINEERING'};},
  async prepareAttachment(id,code,input){calls.push(['attachment',id,code,input]);return {attachment_id:'AXF-0123456789ABCDEF',case_id:id,storage_key:'cases/'+id+'/AXF-0123456789ABCDEF',scan_state:'PENDING'};},
  async leaseOperatorCase(id,p,input){calls.push(['lease',id,p,input]);return {case_id:id,operator_ref:p.actor_ref,expires_at:'2026-10-08T10:10:00.000Z'};},
  async handoffOperatorCase(id,input,p){calls.push(['handoff',id,input,p]);return {handoff_id:'AXH-0123456789ABCDEF',case_id:id,to_lane:input.to_lane};},
  async escalateOperatorCase(id,input,p){calls.push(['op-escalate',id,input,p]);return {escalation_id:'AXE-1111111111111111',case_id:id,lane:input.lane};},
  async createIncident(input,p){calls.push(['incident',input,p]);return {incident_id:'AXI-0123456789ABCDEF',state:'INVESTIGATING'};},
  async linkIncidentCase(incidentId,id,p){calls.push(['incident-link',incidentId,id,p]);return {incident_id:incidentId,case_id:id};},
  async listPublicIncidents(){return [{incident_id:'AXI-0123456789ABCDEF',title:'Synthetic incident',severity:'P1',state:'INVESTIGATING',public_summary:'Investigating.'}];},
  async globalOpsAnalytics(){return {open_cases:3,sla_breached:1,csat_average:4.5};},
  async listPendingNotifications(){return [{notification_id:'AXN-0123456789ABCDEF',case_id:'AX-0123456789AB',kind:'AGENT_REPLY_AVAILABLE'}];},
  async recordNotificationAttempt(n,result){calls.push(['notify-attempt',n,result]);},
  async listPendingWebhookDeliveries(){return [{delivery_id:'AXW-0123456789ABCDEF',case_id:caseId,event_type:'case.updated',payload:{case_id:caseId}}];},
  async recordWebhookAttempt(d,result){calls.push(['webhook-attempt',d,result]);}
 };
}
const env=store=>({ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_OPERATOR_VERIFY:async()=>({actor_ref:'support_agent:owner',role:'support_agent'})});

test('customer recovery-authenticated global operations endpoints work and attachment provider fails closed',async()=>{
 const store=fake(),e=env(store);
 for(const [path,body,status] of [
  ['/api/v1/cases/'+caseId+'/diagnostics',{consent:true,browser:'Chrome'},201],
  ['/api/v1/cases/'+caseId+'/csat',{score:5,reason:'good'},201],
  ['/api/v1/cases/'+caseId+'/escalations',{reason_code:'NEEDS_ENGINEERING'},201]
 ]){
  const r=await handleSupportRequest(new Request('https://support.example'+path,{method:'POST',headers:{authorization:'Support '+recovery,'content-type':'application/json'},body:JSON.stringify(body)}),e);
  assert.equal(r.status,status,path);
 }
 const noProvider=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/attachments',{method:'POST',headers:{authorization:'Support '+recovery,'content-type':'application/json'},body:JSON.stringify({filename:'trace.txt',content_type:'text/plain',bytes:10,sha256:'a'.repeat(64)})}),e);
 assert.equal(noProvider.status,503);
 const withProvider=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/attachments',{method:'POST',headers:{authorization:'Support '+recovery,'content-type':'application/json'},body:JSON.stringify({filename:'trace.txt',content_type:'text/plain',bytes:10,sha256:'a'.repeat(64)})}),{...e,SUPPORT_ATTACHMENT_INIT:async meta=>({upload_url:'https://upload.invalid/'+meta.attachment_id,expires_in:300})});
 assert.equal(withProvider.status,201);
 const payload=await withProvider.json();assert.match(payload.upload_url,/^https:\/\//);
});

test('public status is metadata-only and does not require case authentication',async()=>{
 const r=await handleSupportRequest(new Request('https://support.example/api/v1/status'),env(fake()));
 assert.equal(r.status,200);const b=await r.json();assert.equal(b.incidents.length,1);assert.equal('details' in b.incidents[0],false);
});

test('operator global operations endpoints expose analytics, lease, handoff, escalation and incidents',async()=>{
 const store=fake(),e=env(store);
 const analytics=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/analytics'),e);assert.equal(analytics.status,200);
 const lease=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/cases/'+caseId+'/lease',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({minutes:10})}),e);assert.equal(lease.status,200);
 const handoff=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/cases/'+caseId+'/handoff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to_lane:'PRODUCT_ENGINEERING',note:'Synthetic handoff'})}),e);assert.equal(handoff.status,201);
 const esc=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/cases/'+caseId+'/escalations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lane:'PRODUCT_ENGINEERING',reason_code:'BUG_REPRODUCED'})}),e);assert.equal(esc.status,201);
 const incident=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/incidents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Synthetic incident',severity:'P1',public_summary:'Investigating.'})}),e);assert.equal(incident.status,201);
 const link=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/incidents/AXI-0123456789ABCDEF/cases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({case_id:caseId})}),e);assert.equal(link.status,201);
});

test('scheduled delivery processing records provider success/failure instead of fabricating delivery',async()=>{
 const store=fake();
 const unavailable=await processSupportQueues({ENVIRONMENT:'test',SUPPORT_STORE:store});
 assert.equal(unavailable.notifications.provider_unavailable,1);
 assert.equal(unavailable.webhooks.provider_unavailable,1);
 const store2=fake();
 const ok=await processSupportQueues({ENVIRONMENT:'test',SUPPORT_STORE:store2,SUPPORT_NOTIFICATION_SEND:async()=>({id:'mail-1'}),SUPPORT_WEBHOOK_SEND:async()=>({id:'hook-1',status:200})});
 assert.equal(ok.notifications.delivered,1);assert.equal(ok.webhooks.delivered,1);
 assert.equal(store2.calls.some(x=>x[0]==='notify-attempt'),true);
 assert.equal(store2.calls.some(x=>x[0]==='webhook-attempt'),true);
});
