import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDevelopmentReplyStatus} from '../src/staging/development-reply-status.mjs';

const selection={tenant:'test-business',conversationId:'selected-conversation',messageId:'selected-message'};
const response=data=>({tenantId:selection.tenant,data});

test('status preflight unlocks only a complete readback with no recorded attempt',()=>{
 assert.equal(reviewDevelopmentReplyStatus(response([]),selection).allowed,true);
 assert.equal(reviewDevelopmentReplyStatus({tenantId:'other-business',data:[]},selection).allowed,false);
 assert.equal(reviewDevelopmentReplyStatus(response(Array.from({length:100},(_,i)=>({status:'FAILED',messageId:`old-${i}`}))),selection).allowed,false);
});

test('an uncertain attempt blocks every incoming message, including a new request key',()=>{
 for(const status of ['UNKNOWN','RESERVED']){
  const result=reviewDevelopmentReplyStatus(response([{status,conversationId:'different-conversation',messageId:'original-message'}]),selection);
  assert.equal(result.allowed,false);
  assert.match(result.notice,/Do not send again/);
 }
});

test('a prior attempt for the selected message cannot unlock a second send',()=>{
 for(const status of ['ACCEPTED','DELIVERED','FAILED']){
  assert.equal(reviewDevelopmentReplyStatus(response([{status,conversationId:selection.conversationId,messageId:selection.messageId}]),selection).allowed,false);
 }
 assert.equal(reviewDevelopmentReplyStatus(response([{status:'UNRECOGNIZED'}]),selection).allowed,false);
});
