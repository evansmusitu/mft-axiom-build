import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign as signRaw,randomBytes} from 'node:crypto';
import {AccountDayLedger,Denied,validateGrant} from './ledger_core.mjs';
const day='2026-10-12';const now=1791820000;
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pubRaw=publicKey.export({format:'jwk'}).x;
const B64=Buffer.from(pubRaw,'base64url').toString('base64');
const acct='axiom-account-1';
const sigText=x=>{const raw=Buffer.from(JSON.stringify(x));return {payload_b64:raw.toString('base64'),signature_b64:signRaw(null,raw,privateKey).toString('base64')}};
let serial=0;
const grant=(overrides={})=>sigText({schema:'musitu.axiom.trackb15.s0.quota-grant.v1', account_id:acct,utc_day:day,tenant_id:'tenant-A',workload_id:'agent-A',grant_id:'grant_'+(++serial),issued_at:now-30,expires_at:now+60,max_calls:3,max_per_call_neurons:500,daily_capacity_neurons:1000,provider_remaining_certified:true,production_authority:false,...overrides});
const ctx=(p=':memory:')=>{
  const db=new DatabaseSync(p);db.exec('PRAGMA busy_timeout=1000');
  const sql={exec(statement,...args){let q=db.prepare(statement);let rows=statement.toUpperCase().trim().startsWith('SELECT')?q.all(...args):(q.run(...args),[]);return {toArray:()=>rows};}};
  return {db, storage:{sql,transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x}catch(e){db.exec('ROLLBACK');throw e;}}}};
};
function make(storage,clock=()=>now){return new AccountDayLedger(storage,{accountId:acct,utcDay:day,publicKeyB64:B64,now:clock});}
const req=(signed,{request_id='req-1',request_sha='a'.repeat(64),neurons=400,tenant_id='tenant-A',workload_id='agent-A'}={})=>({signed,request_id,request_sha,neurons,tenant_id,workload_id});
const deny=async(fn,code)=>await assert.rejects(fn,e=>e instanceof Denied&&e.code===code);

test('signed grant verified and reservation durable', async()=>{const x=ctx();const g=grant();const l=make(x.storage);const r=await l.reserve(req(g));assert.equal(r.status,'RESERVED');assert.equal(r.used,400);assert.equal(l.snapshotForTestOnly().used,400);x.db.close()});
test('same request id retry is idempotent, no duplicate neuron reservation',async()=>{const x=ctx(),l=make(x.storage),g=grant();await l.reserve(req(g));assert.equal((await l.reserve(req(g))).dispatch_allowed,false);assert.equal(l.snapshotForTestOnly().used,400);x.db.close()});
test('idempotency key payload mismatch denied',async()=>{const x=ctx(),l=make(x.storage),g=grant();await l.reserve(req(g));await deny(()=>l.reserve(req(g,{request_sha:'b'.repeat(64)})),'IDEMPOTENCY_CONFLICT');x.db.close()});
test('grant call cap is enforced',async()=>{const x=ctx(),l=make(x.storage),g=grant({max_calls:2});await l.reserve(req(g,{neurons:100}));await l.reserve(req(g,{request_id:'req-2',neurons:100}));await deny(()=>l.reserve(req(g,{request_id:'req-3',neurons:100})),'GRANT_CALLS_EXHAUSTED');x.db.close()});
test('cross-tenant same signed grant denied',async()=>{const x=ctx(),l=make(x.storage),g=grant();await deny(()=>l.reserve(req(g,{tenant_id:'tenant-B'})),'WORKLOAD_REQUEST_DENIED');x.db.close()});
test('account daily cap aggregates different signed tenant grants',async()=>{const x=ctx(),l=make(x.storage),g=grant({daily_capacity_neurons:700}),h=grant({tenant_id:'tenant-B',workload_id:'agent-B',daily_capacity_neurons:900});await l.reserve(req(g));await deny(()=>l.reserve(req(h,{tenant_id:'tenant-B',workload_id:'agent-B',request_id:'other',neurons:400})),'ACCOUNT_DAILY_CAPACITY_EXHAUSTED');assert.equal(l.snapshotForTestOnly().used,400);x.db.close()});
test('tampered signature denied',async()=>{const x=ctx(),l=make(x.storage),g=grant();const raw=JSON.parse(Buffer.from(g.payload_b64,'base64').toString());raw.daily_capacity_neurons=9999;g.payload_b64=Buffer.from(JSON.stringify(raw)).toString('base64');await deny(()=>l.reserve(req(g)),'SIGNATURE_INVALID');x.db.close()});
test('unknown key denied',async()=>{const x=ctx(),l=make(x.storage),g=grant();l.publicKeyB64=randomBytes(32).toString('base64');await deny(()=>l.reserve(req(g)),'SIGNATURE_INVALID');x.db.close()});
test('expired grant denied',async()=>{const x=ctx(),l=make(x.storage),g=grant({expires_at:now});await deny(()=>l.reserve(req(g)),'GRANT_EXPIRED_DAY_DENIED');x.db.close()});
test('missing provider verified remaining denied even with signature',async()=>{const x=ctx(),l=make(x.storage),g=grant({provider_remaining_certified:false});await deny(()=>l.reserve(req(g)),'GRANT_SCOPE_DENIED');x.db.close()});
test('production authority cannot be granted',async()=>{const x=ctx(),l=make(x.storage),g=grant({production_authority:true});await deny(()=>l.reserve(req(g)),'GRANT_SCOPE_DENIED');x.db.close()});
test('wrong UTC day denied',async()=>{const x=ctx(),l=make(x.storage),g=grant({utc_day:'2026-10-13'});await deny(()=>l.reserve(req(g)),'GRANT_SCOPE_DENIED');x.db.close()});
test('signed boolean neurons invalid',async()=>{const x=ctx(),l=make(x.storage),g=grant();await deny(()=>l.reserve(req(g,{neurons:true})),'WORKLOAD_REQUEST_DENIED');x.db.close()});
test('limit shrink remains persistent even if shrinking request cannot be admitted',async()=>{const x=ctx(),l=make(x.storage);await l.reserve(req(grant({daily_capacity_neurons:1000}),{neurons:400}));await deny(()=>l.reserve(req(grant({daily_capacity_neurons:450}),{request_id:'shrink',neurons:100})),'ACCOUNT_DAILY_CAPACITY_EXHAUSTED');assert.equal(l.snapshotForTestOnly().safe_limit,450);await deny(()=>l.reserve(req(grant({daily_capacity_neurons:1000}),{request_id:'oldcap',neurons:100})),'ACCOUNT_DAILY_CAPACITY_EXHAUSTED');x.db.close()});
test('revocation before first request blocks all future requests',async()=>{const x=ctx(),l=make(x.storage);l.revokeForTestOnly();await deny(()=>l.reserve(req(grant())),'ACCOUNT_STATE_DENIED');x.db.close()});
test('revocation after first request blocks all later requests',async()=>{const x=ctx(),l=make(x.storage);await l.reserve(req(grant()));l.revokeForTestOnly();await deny(()=>l.reserve(req(grant(),{request_id:'after'})),'ACCOUNT_STATE_DENIED');x.db.close()});
test('SQLite durable process reopening preserves exact ledger',async()=>{const d=mkdtempSync(join(tmpdir(),'axiom-b15-'));try{const f=join(d,'ledger.sqlite');let x=ctx(f),g=grant();await make(x.storage).reserve(req(g));x.db.close();x=ctx(f);const l=make(x.storage);assert.equal((await l.reserve(req(g))).dispatch_allowed,false);assert.equal(l.snapshotForTestOnly().used,400);x.db.close();}finally{rmSync(d,{recursive:true,force:true})}});
test('race from 40 simultaneous reservations stays <= daily limit',async()=>{const x=ctx(),l=make(x.storage),g=grant({max_calls:20,max_per_call_neurons:100,daily_capacity_neurons:600});const results=await Promise.allSettled(Array.from({length:40},(_,i)=>l.reserve(req(g,{request_id:'race-'+i,neurons:100}))));const approved=results.filter(y=>y.status==='fulfilled');assert.equal(approved.length,6);assert.equal(l.snapshotForTestOnly().used,600);x.db.close()});
test('grant identity reused across separate tenants fails closed',async()=>{const x=ctx(),l=make(x.storage),g=grant({grant_id:'same-identity'});await l.reserve(req(g));const other=grant({grant_id:'same-identity',tenant_id:'tenant-B',workload_id:'agent-B'});await deny(()=>l.reserve(req(other,{request_id:'fresh',tenant_id:'tenant-B',workload_id:'agent-B'})),'GRANT_ID_CROSS_TENANT_REPLAY');x.db.close()});
test('grant expiry moving across UTC midnight fails closed',async()=>{const x=ctx(),l=make(x.storage,()=>now+86400),g=grant();await deny(()=>l.reserve(req(g)),'GRANT_EXPIRED_DAY_DENIED');x.db.close()});
test('independently signed revocation before first admission denies future requests',async()=>{
 const x=ctx(),l=make(x.storage),notice=sigText({schema:'musitu.axiom.trackb15.s0.revocation.v1',account_id:acct,utc_day:day,issued_at:now-10,expires_at:now+30,sequence:1,reason:'independent-policy-stop'});
 assert.equal((await l.revoke({signed:notice})).status,'REVOKED');
 await deny(()=>l.reserve(req(grant())),'ACCOUNT_STATE_DENIED');x.db.close();
});
test('tampered revocation cannot stop valid work',async()=>{
 const x=ctx(),l=make(x.storage),notice=sigText({schema:'musitu.axiom.trackb15.s0.revocation.v1',account_id:acct,utc_day:day,issued_at:now-10,expires_at:now+30,sequence:1,reason:'independent-policy-stop'});
 const p=JSON.parse(Buffer.from(notice.payload_b64,'base64'));p.reason='tampered';notice.payload_b64=Buffer.from(JSON.stringify(p)).toString('base64');
 await deny(()=>l.revoke({signed:notice}),'SIGNATURE_INVALID');await l.reserve(req(grant()));x.db.close();
});
test('revocation persisted across process restarts',async()=>{
 const d=mkdtempSync(join(tmpdir(),'axiom-revoke-'));try{const f=join(d,'ledger.sqlite');let x=ctx(f),l=make(x.storage);
 const notice=sigText({schema:'musitu.axiom.trackb15.s0.revocation.v1',account_id:acct,utc_day:day,issued_at:now-10,expires_at:now+30,sequence:1,reason:'independent-policy-stop'});
 await l.revoke({signed:notice});x.db.close();x=ctx(f);l=make(x.storage);await deny(()=>l.reserve(req(grant())),'ACCOUNT_STATE_DENIED');x.db.close();
 }finally{rmSync(d,{recursive:true,force:true})}
});