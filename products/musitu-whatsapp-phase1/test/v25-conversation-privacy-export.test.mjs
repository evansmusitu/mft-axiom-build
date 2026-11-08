import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createConversationPrivacyExporter,openConversationPrivacyExport} from '../src/postgres/conversation-privacy-export.mjs';

const scope={tenantId:'986eb904-7296-46a9-9e9b-94074db9b547',conversationId:'00000000-0000-4000-8000-000000000001',actorId:'owner',requestId:'privacy-test-1'};
test('privacy export refuses absent verified-session recheck and malformed scope before leasing a database',async()=>{
 let leases=0;
 const run=createConversationPrivacyExporter({pool:{connect(){leases++;throw Error('SHOULD_NOT_CONNECT');}},contentKey:randomBytes(32)});
 await assert.rejects(run({...scope,exportKey:randomBytes(32)}),{message:'PRIVACY_SESSION_RECHECK_REQUIRED'});
 for(const patch of [{tenantId:'bad'},{conversationId:'bad'},{actorId:''},{requestId:'../arbitrary'},{exportKey:Buffer.alloc(1)},
  {tenantId:[scope.tenantId]},{conversationId:[scope.conversationId]},{actorId:['owner']},{requestId:['privacy-test-1']}]){
  await assert.rejects(run({...scope,exportKey:randomBytes(32),recheckSession:async()=>{},...patch}),/PRIVACY_INPUT_REJECTED/);
 }
 assert.equal(leases,0);
});
test('privacy export envelope rejects invalid, oversized and unauthenticated input uniformly',()=>{
 for(const encrypted of [Buffer.alloc(0),Buffer.from('plain personal information'),Buffer.alloc(2*1024*1024+1)]){
  assert.throws(()=>openConversationPrivacyExport({encrypted,exportKey:randomBytes(32),...scope}),{message:'PRIVACY_EXPORT_OPEN_REJECTED'});
 }
});
