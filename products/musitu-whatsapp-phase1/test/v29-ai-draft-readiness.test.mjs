import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAiDraftReadiness} from '../src/dashboard/ai-draft-readiness.mjs';

const message={phoneNumberId:'test-phone',messageId:'test-message'};
const ready={blocked:false,blockerStates:[],incomplete:false,requests:[]};

test('suggestion preflight fails closed on unavailable, incomplete and uncertain state',()=>{
 assert.equal(assessAiDraftReadiness(null,message),'UNAVAILABLE');
 assert.equal(assessAiDraftReadiness({...ready,incomplete:true},message),'INCOMPLETE');
 assert.equal(assessAiDraftReadiness({...ready,blocked:true,blockerStates:['UNKNOWN']},message),'UNCERTAIN');
 assert.equal(assessAiDraftReadiness({...ready,blocked:true},message),'UNAVAILABLE');
 assert.equal(assessAiDraftReadiness({...ready,requests:[{...message,state:'UNKNOWN'}]},message),'UNCERTAIN');
});

test('suggestion preflight prevents another request for the same phone and message',()=>{
 assert.equal(assessAiDraftReadiness({...ready,requests:[{...message,state:'COMPLETED'}]},message),'ALREADY_REQUESTED');
 assert.equal(assessAiDraftReadiness({...ready,requests:[{phoneNumberId:'other-phone',messageId:message.messageId,state:'COMPLETED'}]},message),'READY');
});
