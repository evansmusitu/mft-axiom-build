import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import * as signed from '../src/postgres/signed-inbound.mjs';

const tenant='00000000-0000-4000-8000-00000000000a';
const conversation='00000000-0000-4000-8000-000000000010';
const appSecret='fake-application-secret';
function signedImage(id){
 const rawBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{
  id:'WABA_FAKE',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_FAKE'},messages:[{
   id,from:'263770000000',type:'image',image:{id:'synthetic-photo'}}]}}]}]}));
 return {rawBody,signature:'sha256='+createHmac('sha256',appSecret).update(rawBody).digest('hex')};
}
function testPool(roles){
 let lease=0;const events=[];
 const pool={async connect(){
  const id=lease++,role=roles[id]??roles.at(-1);
  const client={async query(sql,args=[]){
   events.push({id,sql,args});
   if(sql.includes('FROM pg_roles'))return {rows:[{role_name:role.name,rolbypassrls:role.bypass,rolsuper:false}]};
   if(role.bypass)throw Error('PRIVILEGED_SQL_EXECUTED');
   if(sql.includes('FROM musitu.tenants'))return {rows:[{id:tenant}]};
   if(sql.includes('FROM musitu.whatsapp_channels'))return {rows:[{phone_number_id:'PHONE_FAKE'}]};
   if(sql.includes('SELECT conversation_id, handling_mode'))return {rows:[{conversation_id:conversation,handling_mode:'BOT'}]};
   if(sql.includes('INSERT INTO musitu.inbound_events'))return {rows:[{provider_message_id:'fake'}]};
   if(sql.includes('FROM musitu.customer_suppressions'))return {rows:[]};
   return {rows:[]};
  },release(error){events.push({id,release:error?.message??null});}};
  return client;
 }};
 return {pool,events};
}
const config=pool=>({pool,expectedRole:'musitu_ingress',appSecret,privacyKey:Buffer.alloc(32,42),bindings:[{tenantId:tenant,wabaId:'WABA_FAKE',phoneNumberId:'PHONE_FAKE'}]});

test('factory must expose an explicitly role-bound signed webhook ingestion path',()=>{
 assert.equal(typeof signed.createRoleBoundSignedWebhookIngestor,'function');
});

test('signed ingress rejects privileged lease before starting transaction or reading tenant records',async()=>{
 const h=testPool([{name:'provider_owner',bypass:true}]);
 const ingress=signed.createRoleBoundSignedWebhookIngestor(config(h.pool));
 await assert.rejects(ingress.ingest(signedImage('wamid.test.001')),/ROLE_/);
 assert.equal(h.events.filter(x=>x.sql==='BEGIN').length,0);
 assert.equal(h.events.filter(x=>x.release!==undefined).length,1);
 assert.equal(h.events.filter(x=>x.sql?.includes('FROM pg_roles')).length,1);
});

test('incoming messages recheck runtime identity every webhook, denying a second privileged lease',async()=>{
 const h=testPool([{name:'musitu_ingress',bypass:false},{name:'musitu_ingress',bypass:true}]);
 const ingress=signed.createRoleBoundSignedWebhookIngestor(config(h.pool));
 const first=await ingress.ingest(signedImage('wamid.test.101'));
 assert.equal(first[0].status,'ACCEPTED');
 assert.equal(h.events.some(x=>x.id===0&&x.sql==='COMMIT'),true);
 await assert.rejects(ingress.ingest(signedImage('wamid.test.102')),/ROLE_BYPASSES_RLS/);
 assert.equal(h.events.some(x=>x.id===1&&x.sql==='BEGIN'),false);
 assert.equal(h.events.filter(x=>x.sql?.includes('FROM pg_roles')).length,2);
});
