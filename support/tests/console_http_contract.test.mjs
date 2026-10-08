import assert from 'node:assert/strict';
import test from 'node:test';
import * as supportWorker from '../worker.js';

const code='01234567-89ABCDEF-GHJKMNPQ';

function fakeStore() {
  const calls=[];
  return {
    calls,
    async appendCustomerMessage(caseId,recoveryCode,input) {
      calls.push(['customer',caseId,recoveryCode,input]);
      return {message:{message_id:'AXM-0123456789ABCDEF',type:'CUSTOMER_MESSAGE',visibility:'customer',body:input.body},case:{case_id:caseId,state:'IN_PROGRESS'}};
    },
    async listOperatorCases() {
      calls.push(['list']);
      return [{case_id:'AX-0123456789AB',state:'NEW',priority:'P0',surface:'security',category:'security_report',created_at:'2026-10-08T10:00:00Z',updated_at:'2026-10-08T10:00:00Z'}];
    },
    async getOperatorCase(caseId) {
      calls.push(['get',caseId]);
      return {case:{case_id:caseId,state:'NEW',priority:'P0'},details:{summary:'Synthetic case'},messages:[]};
    },
    async appendOperatorMessage(caseId,input,principal) {
      calls.push(['operator-message',caseId,input,principal]);
      return {message:{message_id:'AXM-FEDCBA9876543210',type:input.type,visibility:input.type==='INTERNAL_NOTE'?'internal':'customer',body:input.body}};
    },
    async transitionOperatorCase(caseId,label,principal) {
      calls.push(['transition',caseId,label,principal]);
      return {case_id:caseId,state:'IN_PROGRESS',public_label:label};
    },
  };
}

test('customer can append a recovery-authenticated message but not without the recovery credential', async () => {
  const store=fakeStore();
  const missing=await supportWorker.handleSupportRequest(new Request('https://support.example/api/v1/cases/AX-0123456789AB/messages',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:'Additional reproduction detail.'}),
  }),{ENVIRONMENT:'test',SUPPORT_STORE:store});
  assert.equal(missing.status,401);

  const ok=await supportWorker.handleSupportRequest(new Request('https://support.example/api/v1/cases/AX-0123456789AB/messages',{
    method:'POST',headers:{'content-type':'application/json','authorization':`Support ${code}`},body:JSON.stringify({body:'Additional reproduction detail.'}),
  }),{ENVIRONMENT:'test',SUPPORT_STORE:store});
  assert.equal(ok.status,201);
  const body=await ok.json();
  assert.equal(body.message.type,'CUSTOMER_MESSAGE');
  assert.equal(store.calls[0][1],'AX-0123456789AB');
  assert.equal(store.calls[0][2],code);
});

test('private operator handler fails closed without verified operator identity', async () => {
  assert.equal(typeof supportWorker.handleOperatorRequest,'function');
  const store=fakeStore();
  const response=await supportWorker.handleOperatorRequest(new Request('https://support-ops.example/api/v1/operator/cases'),{
    ENVIRONMENT:'test',SUPPORT_STORE:store,
    SUPPORT_OPERATOR_VERIFY:async()=>null,
  });
  assert.equal(response.status,401);
  assert.equal(store.calls.length,0);
});

test('verified operator can list, read, reply/internal-note and transition a case', async () => {
  const store=fakeStore();
  const principal={actor_ref:'support_agent:owner',role:'support_agent'};
  const env={ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_OPERATOR_VERIFY:async()=>principal};

  const list=await supportWorker.handleOperatorRequest(new Request('https://support-ops.example/api/v1/operator/cases'),env);
  assert.equal(list.status,200);
  assert.equal((await list.json()).cases.length,1);

  const one=await supportWorker.handleOperatorRequest(new Request('https://support-ops.example/api/v1/operator/cases/AX-0123456789AB'),env);
  assert.equal(one.status,200);

  const reply=await supportWorker.handleOperatorRequest(new Request('https://support-ops.example/api/v1/operator/cases/AX-0123456789AB/messages',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'AGENT_REPLY',body:'We reproduced the issue.'}),
  }),env);
  assert.equal(reply.status,201);

  const note=await supportWorker.handleOperatorRequest(new Request('https://support-ops.example/api/v1/operator/cases/AX-0123456789AB/messages',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'INTERNAL_NOTE',body:'Escalate if next trace confirms it.'}),
  }),env);
  assert.equal(note.status,201);

  const state=await supportWorker.handleOperatorRequest(new Request('https://support-ops.example/api/v1/operator/cases/AX-0123456789AB/state',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:'IN_PROGRESS_MUSITU_SUPPORT'}),
  }),env);
  assert.equal(state.status,200);

  assert.equal(store.calls.some(x=>x[0]==='operator-message'&&x[2].type==='INTERNAL_NOTE'),true);
  assert.equal(store.calls.some(x=>x[0]==='transition'&&x[2]==='IN_PROGRESS_MUSITU_SUPPORT'),true);
});
