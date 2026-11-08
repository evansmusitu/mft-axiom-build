import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresTenantRepository} from '../src/postgres/tenant-repository.mjs';
const TA='00000000-0000-4000-8000-00000000000a';
const TB='00000000-0000-4000-8000-00000000000b';
const CONV='00000000-0000-4000-8000-00000000000c';
const REMOTE='hmac256:'+'f'.repeat(64);
function harness({role='AGENT',exists=true,fault=false}={}){
 const calls=[],saved=new Set();const client={async query(sql,params=[]){calls.push({sql,params});
  if(sql.includes('FROM musitu.memberships'))return {rows:role?[{role}]:[]};
  if(sql.includes('musitu.suppression_context'))return {rows:exists?[{phone_number_id:'PHONE_A',remote_wa_id:REMOTE}]:[]};
  if(sql.includes('INSERT INTO musitu.customer_suppressions')){
   if(fault)throw Error('DATABASE_TIMEOUT');
   const k=JSON.stringify([params[0],params[1]]);if(saved.has(k))return {rows:[]};saved.add(k);
   return {rows:[{conversation_id:params[1]}]};
  }
  return {rows:[]};
 },release(error){calls.push({sql:'RELEASE',error});}};
 return {pool:{connect:async()=>client},calls,saved};
}
const request={tenantId:TA,actorId:'agent-A',conversationId:CONV,reason:'CUSTOMER_REQUEST'};

test('authorized staff records a scoped customer stop in PostgreSQL, idempotently',async()=>{
 const h=harness(),repo=new PostgresTenantRepository({pool:h.pool});
 const a=await repo.suppressConversation(request),b=await repo.suppressConversation(request);
 assert.equal(a.suppressed,true);assert.equal(a.idempotent,false);assert.equal(b.idempotent,true);
 assert.equal(a.transport,'DISABLED');
 const insert=h.calls.find(c=>c.sql.includes('INSERT INTO musitu.customer_suppressions'));
 assert.equal(insert.params[0],TA);assert.equal(insert.params[1],CONV);
 assert.equal(insert.params[5],'STAFF_ATTESTATION');assert.equal(insert.params[6],'agent-A');
 assert.match(insert.sql,/ON CONFLICT/);
 assert.deepEqual(h.calls.filter(x=>x.sql.includes("set_config('app.tenant_id'")).map(x=>x.params),[[TA],[TA]]);
 assert.equal(h.calls.filter(x=>x.sql==='COMMIT').length,2);
});

test('staff opt-out cannot target another tenant, invalid reason, missing conversation or unauthorized viewer',async()=>{
 const h=harness({role:'VIEWER'}),repo=new PostgresTenantRepository({pool:h.pool});
 await assert.rejects(repo.suppressConversation(request),/ACCESS_DENIED/);
 assert.equal(h.calls.some(c=>c.sql.includes('INSERT INTO musitu.customer_suppressions')),false);
 const absent=harness({exists:false}),r2=new PostgresTenantRepository({pool:absent.pool});
 await assert.rejects(r2.suppressConversation({...request,tenantId:TB}),/CONVERSATION_NOT_FOUND/);
 await assert.rejects(r2.suppressConversation({...request,reason:'MARKETING'}),/INVALID_REASON/);
});

test('PostgreSQL storage fault rolls back staff suppression',async()=>{
 const h=harness({fault:true}),repo=new PostgresTenantRepository({pool:h.pool});
 await assert.rejects(repo.suppressConversation(request),/DATABASE_TIMEOUT/);
 assert.equal(h.calls.some(x=>x.sql==='ROLLBACK'),true);
 assert.equal(h.calls.some(x=>x.sql==='COMMIT'),false);
});
