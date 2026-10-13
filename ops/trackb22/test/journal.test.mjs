import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DurableDispatchJournal,JournalDenied} from '../src/journal.mjs';
const day='2026-10-13', NOW=Date.parse(day+'T15:00:00.000Z');
function open(path=':memory:'){
  const db=new DatabaseSync(path);
  const sql={exec(sql,...params){const s=db.prepare(sql);const rows=sql.trimStart().startsWith('SELECT')?s.all(...params):(s.run(...params),[]);return {toArray:()=>rows}}};
  const storage={sql,transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{let out=fn();db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e;}}};
  return {db,storage};
}
const base=()=>({account_id:'axiom-s0-isolated',utc_day:day,request_id:'operation-A',tenant_id:'tenant-A',workload_id:'agent-a',body_sha:'a'.repeat(64),quota_grant_id:'grant-A'});
const completion=()=>({request_id:'operation-A',body_sha:'a'.repeat(64),result_sha:'b'.repeat(64)});
const denied=(code,fn)=>assert.throws(fn,e=>e instanceof JournalDenied&&e.code===code);
function ledger(db,now=()=>NOW){return new DurableDispatchJournal(db.storage,{accountId:'axiom-s0-isolated',utcDay:day,now});}
test('one operation produces exactly one durable transport permit',()=>{const x=open();let j=ledger(x);assert.deepEqual(j.begin(base()).send_allowed,true);assert.equal(j.begin(base()).send_allowed,false);assert.equal(j.lookup({request_id:'operation-A'}).state,'ISSUED');x.db.close()});
test('modified immutable request with same id is rejected',()=>{const x=open(),j=ledger(x);j.begin(base());denied('OPERATION_SCOPE_CONFLICT',()=>j.begin({...base(),body_sha:'c'.repeat(64)}));x.db.close()});
test('distinct operations in one tenant are independently admitted',()=>{const x=open(),j=ledger(x);j.begin(base());assert.equal(j.begin({...base(),request_id:'operation-B'}).send_allowed,true);x.db.close()});
test('finished work is terminal and cannot be reissued',()=>{const x=open(),j=ledger(x);j.begin(base());assert.equal(j.complete(completion()).state,'COMPLETED');assert.equal(j.begin(base()).send_allowed,false);assert.equal(j.complete(completion()).state,'COMPLETED');denied('RESULT_SCOPE_CONFLICT',()=>j.complete({...completion(),result_sha:'c'.repeat(64)}));x.db.close()});
test('uncertain send permanently prevents retry',()=>{const x=open(),j=ledger(x);j.begin(base());assert.equal(j.uncertain({request_id:'operation-A',body_sha:'a'.repeat(64)}).state,'UNKNOWN');assert.equal(j.begin(base()).send_allowed,false);denied('TERMINAL_UNKNOWN',()=>j.complete(completion()));x.db.close()});
test('crash before terminal receipt leaves ISSUED and does not resend',()=>{const {mkdtempSync,rmSync}=requireFs();const {join}=requirePath();const dir=mkdtempSync('/tmp/axiom-b22-');try{const file=join(dir,'journal.sqlite');let x=open(file);ledger(x).begin(base());x.db.close();x=open(file);let j=ledger(x);assert.equal(j.lookup({request_id:'operation-A'}).state,'ISSUED');assert.equal(j.begin(base()).send_allowed,false);x.db.close()}finally{rmSync(dir,{recursive:true,force:true})}});
function requireFs(){return FS;}
function requirePath(){return PATH;}
import * as FS from 'node:fs';import * as PATH from 'node:path';
test('unknown completion without a durable permit is denied',()=>{const x=open(),j=ledger(x);denied('UNKNOWN_OPERATION',()=>j.complete(completion()));x.db.close()});
test('UTC day rollover refuses entry or completion',()=>{const x=open(),j=ledger(x,()=>NOW+86400000);denied('NOT_CURRENT_ACCOUNT_DAY',()=>j.begin(base()));x.db.close()});
test('bad schemas and boolean fields rejected',()=>{const x=open(),j=ledger(x);denied('INVALID_REQUEST',()=>j.begin({...base(),unexpected:true}));denied('INVALID_REQUEST',()=>j.begin({...base(),body_sha:12}));denied('INVALID_REQUEST',()=>j.begin({...base(),quota_grant_id:' '}));x.db.close()});
test('two journals share same SQL storage with no second send permit',()=>{const x=open(),a=ledger(x),b=ledger(x);assert.equal(a.begin(base()).send_allowed,true);assert.equal(b.begin(base()).send_allowed,false);x.db.close()});
test('mismatched tenant with repeated request id is rejected',()=>{const x=open(),j=ledger(x);j.begin(base());denied('OPERATION_SCOPE_CONFLICT',()=>j.begin({...base(),tenant_id:'tenant-B'}));x.db.close()});
test('uncertain cannot reverse completed state',()=>{const x=open(),j=ledger(x);j.begin(base());j.complete(completion());denied('TERMINAL_COMPLETED',()=>j.uncertain({request_id:'operation-A',body_sha:'a'.repeat(64)}));x.db.close()});
