import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import * as worker from '../worker.js';

const caseId='AX-0123456789AB';
const code='01234567-89ABCDEF-GHJKMNPQ';
const identity={issuer:'https://team.cloudflareaccess.com',subject:'opaque-subject-123'};

function env(store,verified=true){
  return {
    ENVIRONMENT:'test',
    SUPPORT_STORE:store,
    SUPPORT_RECOVERY_IDENTITY_VERIFY:async()=>verified?identity:null,
  };
}

test('recovery endpoints require verified identity and bind only with current recovery code',async()=>{
  assert.equal(typeof worker.verifyCustomerRecoveryAccess,'function');
  const calls=[];
  const store={
    async bindRecoveryIdentity(id,recoveryCode,who){calls.push([id,recoveryCode,who]);return {case_id:id,bound:true,already_bound:false};}
  };
  const denied=await worker.handleSupportRequest(new Request('https://support.example/recovery/api/v1/cases/'+caseId+'/bind',{
    method:'POST',headers:{authorization:'Support '+code}
  }),env(store,false));
  assert.equal(denied.status,401);
  assert.equal(calls.length,0);

  const ok=await worker.handleSupportRequest(new Request('https://support.example/recovery/api/v1/cases/'+caseId+'/bind',{
    method:'POST',headers:{authorization:'Support '+code}
  }),env(store,true));
  assert.equal(ok.status,200);
  assert.deepEqual(calls[0],[caseId,code,identity]);
});

test('recovery rotation uses verified identity without the old code and surfaces independent approval requirement',async()=>{
  const approvalStore={
    async rotateRecoveryCredential(id,who){assert.equal(id,caseId);assert.deepEqual(who,identity);return {case_id:id,status:'APPROVAL_REQUIRED'};}
  };
  const pending=await worker.handleSupportRequest(new Request('https://support.example/recovery/api/v1/cases/'+caseId+'/rotate',{method:'POST'}),env(approvalStore,true));
  assert.equal(pending.status,409);
  assert.equal((await pending.json()).error,'RECOVERY_APPROVAL_REQUIRED');

  const rotateStore={
    async rotateRecoveryCredential(){return {case_id:caseId,status:'ROTATED',recovery_code:code,recovery_code_notice:'shown once'};}
  };
  const rotated=await worker.handleSupportRequest(new Request('https://support.example/recovery/api/v1/cases/'+caseId+'/rotate',{method:'POST'}),env(rotateStore,true));
  assert.equal(rotated.status,200);
  const body=await rotated.json();
  assert.equal(body.recovery_code,code);
  assert.equal(body.status,'ROTATED');
});

test('unbound or wrong identity recovery fails generically without revealing case existence',async()=>{
  const store={async rotateRecoveryCredential(){return null;}};
  const response=await worker.handleSupportRequest(new Request('https://support.example/recovery/api/v1/cases/'+caseId+'/rotate',{method:'POST'}),env(store,true));
  assert.equal(response.status,404);
  const body=await response.json();
  assert.equal(body.error,'RECOVERY_NOT_AVAILABLE');
  assert.doesNotMatch(JSON.stringify(body),/identity|binding|exists/i);
});

test('recovery UI contains protect and lost-code flows without browser persistence or contact collection',async()=>{
  const [html,js,publicHtml]=await Promise.all([
    readFile(new URL('../recovery/index.html',import.meta.url),'utf8'),
    readFile(new URL('../recovery/app.js',import.meta.url),'utf8'),
    readFile(new URL('../index.html',import.meta.url),'utf8'),
  ]);
  assert.match(html,/Protect case access/i);
  assert.match(html,/Lost your recovery code/i);
  assert.match(html,/name="case_id"/);
  assert.match(html,/name="recovery_code"/);
  assert.doesNotMatch(html,/name="email"|name="phone"/i);
  assert.match(js,/\/recovery\/api\/v1\/cases\//);
  assert.match(js,/\/bind/);
  assert.match(js,/\/rotate/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(js,/URLSearchParams.*recovery|recovery.*URLSearchParams/i);
  assert.match(publicHtml,/href="\/recovery\/"/);
});
