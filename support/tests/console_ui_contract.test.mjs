import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import * as publicWorker from '../worker.js';
import operatorWorker, {handleOperatorSurface} from '../operator_worker.js';

test('existing-case GET returns the recovery-authenticated customer thread, not intake-only details',async()=>{
  const store={
    async getAuthorizedThread(caseId,code){
      assert.equal(caseId,'AX-0123456789AB');
      assert.equal(code,'01234567-89ABCDEF-GHJKMNPQ');
      return {case:{case_id:caseId,state:'IN_PROGRESS'},details:{summary:'Synthetic'},messages:[{type:'AGENT_REPLY',visibility:'customer',body:'We are investigating.'}]};
    },
    async getAuthorized(){throw new Error('legacy intake-only getter must not be used');},
  };
  const response=await publicWorker.handleSupportRequest(new Request('https://support.example/api/v1/cases/AX-0123456789AB',{
    headers:{authorization:'Support 01234567-89ABCDEF-GHJKMNPQ'},
  }),{ENVIRONMENT:'test',SUPPORT_STORE:store});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.messages[0].type,'AGENT_REPLY');
});

test('public browser UI provides in-memory recovery-authenticated case thread and reply without persistence',async()=>{
  const [html,js]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('../app.js',import.meta.url),'utf8'),
  ]);
  assert.match(html,/Check an existing case/i);
  assert.match(html,/name="case_id"/);
  assert.match(html,/name="recovery_code"/);
  assert.match(html,/id="case-thread"/);
  assert.match(html,/id="case-reply"/);
  assert.match(js,/Authorization.*Support/si);
  assert.match(js,/\/api\/v1\/cases\/.*\/messages/s);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(js,/recovery_code.*URLSearchParams|URLSearchParams.*recovery_code/i);
});

test('private operator surface authenticates before serving UI and exposes Figma-derived console assets',async()=>{
  assert.equal(typeof handleOperatorSurface,'function');
  const denied=await handleOperatorSurface(new Request('https://support-ops.example/'),{
    ENVIRONMENT:'test',SUPPORT_OPERATOR_VERIFY:async()=>null,
  });
  assert.equal(denied.status,401);

  const principal={actor_ref:'support_agent:owner',role:'support_agent'};
  const env={ENVIRONMENT:'test',SUPPORT_OPERATOR_VERIFY:async()=>principal,SUPPORT_STORE:{listOperatorCases:async()=>[]}};
  const page=await handleOperatorSurface(new Request('https://support-ops.example/'),env);
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/MUSITU Axiom/);
  assert.match(html,/Support Operations/);
  assert.match(html,/Inbox/);
  assert.match(html,/Reply to customer/);
  assert.match(html,/Internal note/);
  assert.match(html,/Evidence/);
  assert.match(html,/Audit trail/);

  const css=await handleOperatorSurface(new Request('https://support-ops.example/styles.css'),env);
  assert.equal(css.status,200);
  assert.match(css.headers.get('content-type'),/text\/css/);

  const js=await handleOperatorSurface(new Request('https://support-ops.example/app.js'),env);
  assert.equal(js.status,200);
  assert.match(js.headers.get('content-type'),/javascript/);
});

test('operator browser bundle uses only private operator APIs and implements reply, note and state actions',async()=>{
  const js=await readFile(new URL('../console/app.js',import.meta.url),'utf8');
  assert.match(js,/\/api\/v1\/operator\/cases/);
  assert.match(js,/AGENT_REPLY/);
  assert.match(js,/INTERNAL_NOTE/);
  assert.match(js,/IN_PROGRESS_MUSITU_SUPPORT/);
  assert.match(js,/ACTION_REQUIRED/);
  assert.match(js,/SOLUTION_PROVIDED/);
  assert.doesNotMatch(js,/recovery[_-]?code/i);
});
