import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresTenantRepository} from '../src/postgres/tenant-repository.mjs';

const A='00000000-0000-4000-8000-00000000000a';
const B='00000000-0000-4000-8000-00000000000b';
const RESOURCE='00000000-0000-4000-8000-00000000000d';
const BOOKING='00000000-0000-4000-8000-00000000000e';
const t0='2026-12-01T09:00:00.000Z', t1='2026-12-01T10:00:00.000Z';
function fixture(behavior=()=>({rows:[],rowCount:0})){
 const calls=[];
 const client={query:async(sql,values)=>{calls.push({sql,values});return await behavior(sql,values,calls);},release:()=>{calls.push({sql:'RELEASE'});}};
 const pool={connect:async()=>{calls.push({sql:'CONNECT'});return client;}};
 return {pool,calls};
}
function memberAndCounts(sql){
 if(sql.includes('FROM musitu.memberships'))return {rows:[{role:'OWNER'}],rowCount:1};
 if(sql.includes('AS inquiries'))return {rows:[{inquiries:'7',bookings:'2',human_conversations:'1'}],rowCount:1};
 return {rows:[],rowCount:0};
}
const find=(calls,part)=>calls.find(c=>c.sql.includes(part));

test('snapshot starts a transaction, pins transaction-local tenant, authorizes active membership and commits before releasing',async()=>{
 const {pool,calls}=fixture(memberAndCounts),repo=new PostgresTenantRepository({pool});
 const result=await repo.snapshot(A,'owner-a');
 assert.deepEqual(result,{tenantId:A,inquiries:7,bookings:2,humanConversations:1,verifiedRevenue:null,revenueStatus:'NO_VERIFIED_PAYMENTS'});
 assert.deepEqual(calls.map(x=>x.sql).filter(x=>/^(CONNECT|BEGIN|COMMIT|ROLLBACK|RELEASE)$/.test(x)),['CONNECT','BEGIN','COMMIT','RELEASE']);
 assert.deepEqual(find(calls,"set_config('app.tenant_id'").values,[A]);
 assert.match(find(calls,"set_config('app.tenant_id'").sql,/true\)/);
 assert.deepEqual(find(calls,'FROM musitu.memberships').values,[A,'owner-a']);
 assert.equal(calls.some(c=>c.sql.includes('SET SESSION')),false);
});

test('missing or revoked membership fails closed, always rolls back and releases',async()=>{
 const {pool,calls}=fixture(()=>({rows:[],rowCount:0})),repo=new PostgresTenantRepository({pool});
 await assert.rejects(repo.snapshot(A,'revoked-a'),/ACCESS_DENIED/);
 assert.equal(calls.some(c=>c.sql==='COMMIT'),false);
 assert.equal(calls.at(-2).sql,'ROLLBACK');assert.equal(calls.at(-1).sql,'RELEASE');
});

test('rejects malformed tenant ID and actor ID before acquiring a connection',async()=>{
 const {pool,calls}=fixture(),repo=new PostgresTenantRepository({pool});
 await assert.rejects(repo.snapshot("';set role postgres;--",'actor'),/INVALID_TENANT/);
 await assert.rejects(repo.snapshot(A,''),/INVALID_ACTOR/);
 assert.deepEqual(calls,[]);
});

test('query failure rolls back; the next pooled request must set its own distinct context',async()=>{
 let fail=true;const {pool,calls}=fixture((sql)=>{
  if(sql.includes('AS inquiries')&&fail){fail=false;throw new Error('DB_OFFLINE');}
  return memberAndCounts(sql);
 }); const repo=new PostgresTenantRepository({pool});
 await assert.rejects(repo.snapshot(A,'owner-a'),/DB_OFFLINE/);
 await repo.snapshot(B,'owner-b');
 assert.deepEqual(calls.filter(x=>x.sql.includes("set_config('app.tenant_id'")).map(x=>x.values[0]),[A,B]);
 assert.equal(calls.filter(x=>x.sql==='ROLLBACK').length,1);
 assert.equal(calls.filter(x=>x.sql==='COMMIT').length,1);
 assert.equal(calls.filter(x=>x.sql==='RELEASE').length,2);
});

test('viewer may inspect metrics but cannot list drafts or reserve a booking',async()=>{
 const {pool,calls}=fixture(sql=>sql.includes('FROM musitu.memberships')?{rows:[{role:'VIEWER'}]}:memberAndCounts(sql));
 const repo=new PostgresTenantRepository({pool});
 assert.equal((await repo.snapshot(A,'viewer-a')).inquiries,7);
 await assert.rejects(repo.listReplyDrafts(A,'viewer-a'),/ACCESS_DENIED/);
 await assert.rejects(repo.reserveBooking({tenantId:A,actorId:'viewer-a',resourceId:RESOURCE,startAt:t0,endAt:t1,effectKey:'booking-1'}),/ACCESS_DENIED/);
 assert.equal(calls.filter(x=>x.sql==='ROLLBACK').length,2);
});

test('draft rows are isolated to requested tenant and do not claim delivery',async()=>{
 const {pool,calls}=fixture(sql=>sql.includes('FROM musitu.memberships')?{rows:[{role:'AGENT'}]}:sql.includes('FROM musitu.reply_drafts')?
  {rows:[{draft_id:BOOKING,conversation_id:RESOURCE,source_faq_id:RESOURCE,body:'Approved answer',status:'DRAFT'}]}:
  {rows:[]});
 const repo=new PostgresTenantRepository({pool});const rows=await repo.listReplyDrafts(B,'agent-b');
 assert.deepEqual(rows,[{tenantId:B,draftId:BOOKING,conversationId:RESOURCE,sourceId:RESOURCE,body:'Approved answer',status:'DRAFT',providerDelivery:'NEVER_SUBMITTED'}]);
 assert.deepEqual(find(calls,'FROM musitu.reply_drafts').values,[B]);
});

test('booking creation uses a parameterized tenant + resource key, preserving half-open time ranges',async()=>{
 const {pool,calls}=fixture((sql)=>{
  if(sql.includes('FROM musitu.memberships'))return {rows:[{role:'AGENT'}]};
  if(sql.includes('FROM musitu.resources'))return {rows:[{resource_id:RESOURCE}]};
  if(sql.includes('INSERT INTO musitu.bookings'))return {rows:[{booking_id:BOOKING}]};
  return {rows:[]};
 }); const repo=new PostgresTenantRepository({pool});
 const v=await repo.reserveBooking({tenantId:A,actorId:'agent-a',resourceId:RESOURCE,startAt:t0,endAt:t1,effectKey:'ref123'});
 assert.deepEqual(v,{tenantId:A,bookingId:BOOKING,resourceId:RESOURCE,startAt:t0,endAt:t1,effectKey:'ref123',status:'CONFIRMED'});
 const insert=find(calls,'INSERT INTO musitu.bookings');assert.equal(insert.values.includes('ref123'),true);
 assert.equal(insert.values.includes(A),true);assert.match(insert.sql,/ON CONFLICT/);
});

test('identical effect-key replay returns the existing booking, but mutated request is rejected',async()=>{
 const {pool,calls}=fixture(sql=>{
  if(sql.includes('FROM musitu.memberships'))return {rows:[{role:'OWNER'}]};
  if(sql.includes('FROM musitu.bookings')&&sql.includes('source_idempotency_key'))return {rows:[{booking_id:BOOKING,resource_id:RESOURCE,start_at:new Date(t0),end_at:new Date(t1),status:'CONFIRMED'}]};
  return {rows:[]};
 });const repo=new PostgresTenantRepository({pool});
 const params={tenantId:A,actorId:'owner-a',resourceId:RESOURCE,startAt:t0,endAt:t1,effectKey:'same'};
 const v=await repo.reserveBooking(params);assert.equal(v.bookingId,BOOKING);
 await assert.rejects(repo.reserveBooking({...params,endAt:'2026-12-01T11:00:00.000Z'}),/IDEMPOTENCY_CONFLICT/);
 assert.equal(calls.some(c=>c.sql.includes('INSERT INTO musitu.bookings')),false);
});

test('Postgres exclusion errors are surfaced as SLOT_UNAVAILABLE with rollback; other SQL faults are not hidden',async()=>{
 let code='23P01';const {pool,calls}=fixture(sql=>{
  if(sql.includes('FROM musitu.memberships'))return {rows:[{role:'ADMIN'}]};
  if(sql.includes('FROM musitu.resources'))return {rows:[{resource_id:RESOURCE}]};
  if(sql.includes('INSERT INTO musitu.bookings'))throw Object.assign(new Error('db_exclusion'),{code});
  return {rows:[]};
 });const repo=new PostgresTenantRepository({pool});const payload={tenantId:A,actorId:'admin-a',resourceId:RESOURCE,startAt:t0,endAt:t1,effectKey:'new-1'};
 await assert.rejects(repo.reserveBooking(payload),/SLOT_UNAVAILABLE/);
 code='08006';await assert.rejects(repo.reserveBooking({...payload,effectKey:'new-2'}),/db_exclusion/);
 assert.equal(calls.filter(x=>x.sql==='ROLLBACK').length,2);
});

test('invalid booking interval is rejected before any DB connection',async()=>{
 const {pool,calls}=fixture(),repo=new PostgresTenantRepository({pool});
 const p={tenantId:A,actorId:'agent-a',resourceId:RESOURCE,startAt:t0,endAt:t0,effectKey:'x'};
 await assert.rejects(repo.reserveBooking(p),/INVALID_BOOKING_INTERVAL/);
 await assert.rejects(repo.reserveBooking({...p,endAt:'2026-12-02T10:00:00.000Z'}),/INVALID_BOOKING_INTERVAL/);
 assert.equal(calls.length,0);
});

test('failed rollback discards leased connection once rather than releasing it twice',async()=>{
 const releases=[];
 const client={query:async(sql)=>{
  if(sql==='ROLLBACK')throw new Error('ROLLBACK_FAILED');
  if(sql.includes('FROM musitu.memberships'))throw new Error('DB_DROPPED');
  return {rows:[]};
 },release:(reason)=>releases.push(reason)};
 const repo=new PostgresTenantRepository({pool:{connect:async()=>client}});
 await assert.rejects(repo.snapshot(A,'owner-a'),/DB_DROPPED/);
 assert.equal(releases.length,1);
 assert.match(releases[0].message,/ROLLBACK_FAILED/);
});

test('private HTTP control surface awaits asynchronous Postgres store results',async t=>{
 const {generateKeyPairSync,sign}=await import('node:crypto');
 const {createPrivateAdminServer}=await import('../src/private-stage/admin-server.mjs');
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const key={...publicKey.export({format:'jwk'}),alg:'RS256',use:'sig',kid:'phase1-pg-key'};
 const issued=Math.floor(Date.now()/1000);
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const payload={iss:'https://idp.example.invalid/realm',aud:'phase1-private-test',sub:'owner-a',iat:issued-1,nbf:issued-1,exp:issued+60};
 const prefix=b64({typ:'JWT',alg:'RS256',kid:'phase1-pg-key'})+'.'+b64(payload);
 const token=prefix+'.'+sign('RSA-SHA256',Buffer.from(prefix),privateKey).toString('base64url');
 const config={issuer:payload.iss,audience:payload.aud,jwks:{keys:[key]},maxTokenAgeSeconds:120};
 const store={snapshot:async(tid,actor)=>{
  if(tid!==A||actor!=='owner-a')throw new Error('ACCESS_DENIED');
  return {tenantId:tid,inquiries:4,bookings:1,humanConversations:0,verifiedRevenue:null,revenueStatus:'NO_VERIFIED_PAYMENTS'};
 },listReplyDrafts:async(tid,actor)=>{if(tid!==A||actor!=='owner-a')throw new Error('ACCESS_DENIED');return []}};
 const server=createPrivateAdminServer({store,identityConfig:config});
 const url=await server.start();t.after(()=>server.stop());
 const headers={authorization:'Bearer '+token};
 const metrics=await fetch(url+'/v1/tenants/'+A+'/metrics',{headers});
 assert.equal(metrics.status,200);assert.equal((await metrics.json()).bookings,1);
 const drafts=await fetch(url+'/v1/tenants/'+A+'/drafts',{headers});
 assert.equal(drafts.status,200);assert.deepEqual((await drafts.json()).drafts,[]);
 assert.equal((await fetch(url+'/v1/tenants/'+B+'/metrics',{headers})).status,403);
});

test('malformed pooled client is discarded rather than leaked',async()=>{
 let releases=0;const repo=new PostgresTenantRepository({pool:{connect:async()=>({query:undefined,release:()=>{releases++;}})}});
 await assert.rejects(repo.snapshot(A,'owner-a'),/PG_CLIENT_REQUIRED/);
 assert.equal(releases,1);
});
