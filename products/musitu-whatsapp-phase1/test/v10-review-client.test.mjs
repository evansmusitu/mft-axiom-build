import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftReviewClient} from '../src/dashboard/review-actions.js';

const A={tenant:'tenant-A',token:'a'.repeat(50)};
const B={tenant:'tenant-B',token:'b'.repeat(50)};
const D='00000000-0000-4000-8000-00000000000d';

function serverReply(status,payload){return {ok:status>=200&&status<300,status,json:async()=>payload};}
test('offline review client builds same-origin authenticated URLs and reuses idempotency key after ambiguous failure',async()=>{
 const calls=[];let fail=true,session=A;let count=0;
 const api=createDraftReviewClient({getSession:()=>session,makeKey:()=>`review-${++count}`,
  fetchImpl:async(url,opts)=>{calls.push({url,opts});if(fail){fail=false;throw new Error('connection lost');}return serverReply(201,{tenantId:session.tenant,draftId:D,status:'APPROVED_OFFLINE',providerDelivery:'NEVER_SUBMITTED'});}});
 await assert.rejects(api.approve(D),/connection lost/);
 assert.equal((await api.approve(D)).status,'APPROVED_OFFLINE');
 assert.equal(calls.length,2);assert.equal(calls[0].url,`/v1/tenants/tenant-A/drafts/${D}/approve`);
 assert.equal(JSON.parse(calls[0].opts.body).approvalKey,JSON.parse(calls[1].opts.body).approvalKey);
 assert.equal(calls[0].opts.headers.authorization,`Bearer ${A.token}`);
 assert.equal(calls[0].opts.credentials,'omit');assert.equal(calls[0].opts.redirect,'error');
 session=B;
 await api.approve(D);
 assert.equal(calls[2].url,`/v1/tenants/tenant-B/drafts/${D}/approve`);
 assert.notEqual(JSON.parse(calls[2].opts.body).approvalKey,JSON.parse(calls[0].opts.body).approvalKey);
});

test('stage-offline never calls provider or send endpoint and validates reply identity and transport',async()=>{
 const calls=[];const api=createDraftReviewClient({getSession:()=>A,makeKey:()=> 'stage-001',
  fetchImpl:async(url,opts)=>{calls.push({url,opts});return serverReply(201,{tenantId:A.tenant,draftId:D,status:'STAGED_OFFLINE',providerDelivery:'NEVER_SUBMITTED',transport:'DISABLED'});}});
 const outcome=await api.stageOffline(D);
 assert.equal(outcome.status,'STAGED_OFFLINE');assert.equal(calls.length,1);
 assert.equal(calls[0].url,`/v1/tenants/tenant-A/drafts/${D}/stage-offline`);
 assert.deepEqual(JSON.parse(calls[0].opts.body),{reservationKey:'stage-001'});
 assert.equal(calls.some(x=>/send|graph\.facebook\.com/.test(x.url)),false);
});

test('approval and stage fail closed on missing session, invalid draft, server errors and unexpected result',async()=>{
 let session=null;let calls=0;
 const api=createDraftReviewClient({getSession:()=>session,makeKey:()=> 'one',fetchImpl:async()=>{calls++;return serverReply(500,{error:'FAILED'});}});
 await assert.rejects(api.approve(D),/SESSION_REQUIRED/);assert.equal(calls,0);
 session=A;
 await assert.rejects(api.approve('../../foreign'),/INVALID_DRAFT_ID/);assert.equal(calls,0);
 await assert.rejects(api.approve(D),/REVIEW_HTTP_500/);
 const forged=createDraftReviewClient({getSession:()=>A,makeKey:()=> 'another',fetchImpl:async()=>serverReply(201,{tenantId:'tenant-B',draftId:D,status:'APPROVED_OFFLINE',providerDelivery:'NEVER_SUBMITTED'})});
 await assert.rejects(forged.approve(D),/REVIEW_RESPONSE_UNTRUSTED/);
 const suspect=createDraftReviewClient({getSession:()=>A,makeKey:()=> 'another',fetchImpl:async()=>serverReply(200,{tenantId:'tenant-A',draftId:D,status:'STAGED_OFFLINE',providerDelivery:'SENT',transport:'DISABLED'})});
 await assert.rejects(suspect.stageOffline(D),/REVIEW_RESPONSE_UNTRUSTED/);
});
