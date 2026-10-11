import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {sweepTerminalEnvelopeResidue} from '../src/ops/retention.mjs';
const now=Date.parse('2026-10-11T00:00:00.000Z');
const day=86400000;
function fixture(t){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>db.close());
 const insert=db.prepare('INSERT INTO mail_messages(message_id,tenant_id,idempotency_key,request_hash,recipient_hmac,state,sealed_envelope,events_json,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?)');
 const add=(id,tenant,state,age)=>insert.run(id,tenant,'idem-'+id,'hash-'+id,'recipient-'+id,state,'v1.synthetic.ciphertext','[]',now-age*day,now-age*day);
 const ciphertext=id=>db.prepare('SELECT sealed_envelope FROM mail_messages WHERE message_id=?').get(id).sealed_envelope;
 return {db:createD1Compat(db),add,ciphertext,sqlite:db};
}
const scope={tenantId:'tenant-one',now:()=>now,minAgeDays:30};
test('dry-run retention reports only aged terminal ciphertext without any mutation',async t=>{
 const f=fixture(t);f.add('final-old','tenant-one','ACCEPTED_BY_PROVIDER',40);f.add('live-old','tenant-one','SENDING',40);
 f.add('final-new','tenant-one','OUTCOME_UNKNOWN',2);f.add('other-old','tenant-two','BLOCKED_BY_POLICY',40);
 const report=await sweepTerminalEnvelopeResidue(f.db,scope);
 assert.equal(report.mode,'DRY_RUN');assert.equal(report.eligibleEnvelopes,1);
 for(const id of ['final-old','live-old','final-new','other-old'])assert.ok(f.ciphertext(id));
});
test('approved offline cleanup erases only eligible terminal ciphertext while preserving signed evidence and idempotency',async t=>{
 const f=fixture(t);f.add('final-old','tenant-one','REJECTED_BY_PROVIDER',40);f.add('live-old','tenant-one','QUEUED',40);
 const result=await sweepTerminalEnvelopeResidue(f.db,{...scope,dryRun:false,legalHold:false,backupVerified:true,retentionApproved:true,
  acknowledgement:'ERASE_ONLY_TERMINAL_ENVELOPE_RESIDUE'});
 assert.equal(result.mode,'ERASED');assert.equal(result.erasedEnvelopes,1);
 assert.equal(f.ciphertext('final-old'),null);assert.ok(f.ciphertext('live-old'));
 assert.equal(f.sqlite.prepare('SELECT idempotency_key FROM mail_messages WHERE message_id=?').get('final-old').idempotency_key,'idem-final-old');
 assert.equal(f.sqlite.prepare('SELECT events_json FROM mail_messages WHERE message_id=?').get('final-old').events_json,'[]');
});
test('legal hold, absent backup verification and missing approval fail closed before mutating',async t=>{
 const f=fixture(t);f.add('final-old','tenant-one','REJECTED_BY_PROVIDER',40);
 for(const missing of [{legalHold:true},{backupVerified:false},{retentionApproved:false},{acknowledgement:'wrong'}]){
  const options={...scope,dryRun:false,legalHold:false,backupVerified:true,retentionApproved:true,acknowledgement:'ERASE_ONLY_TERMINAL_ENVELOPE_RESIDUE',...missing};
  await assert.rejects(()=>sweepTerminalEnvelopeResidue(f.db,options),/RETENTION_DENIED/);
 }
 assert.ok(f.ciphertext('final-old'));
});
test('invalid retention scope and SQL unavailability fail closed',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>sweepTerminalEnvelopeResidue(f.db,{...scope,minAgeDays:0}),/RETENTION_DENIED/);
 await assert.rejects(()=>sweepTerminalEnvelopeResidue(f.db,{...scope,tenantId:'../escape'}),/RETENTION_DENIED/);
 await assert.rejects(()=>sweepTerminalEnvelopeResidue({prepare(){throw Error('offline')}},scope),/RETENTION_STORE_UNAVAILABLE/);
});

test('unknown provider outcome is an unresolved delivery claim and its ciphertext must not be erased',async t=>{
 const f=fixture(t);
 f.add('unknown-old','tenant-one','OUTCOME_UNKNOWN',400);
 f.add('terminal-old','tenant-one','ACCEPTED_BY_PROVIDER',400);
 const preview=await sweepTerminalEnvelopeResidue(f.db,scope);
 assert.equal(preview.eligibleEnvelopes,1,'unknown outcomes must be excluded from terminal retention');
 const erased=await sweepTerminalEnvelopeResidue(f.db,{...scope,dryRun:false,legalHold:false,
  backupVerified:true,retentionApproved:true,acknowledgement:'ERASE_ONLY_TERMINAL_ENVELOPE_RESIDUE'});
 assert.equal(erased.erasedEnvelopes,1);
 assert.ok(f.ciphertext('unknown-old'),'reconciliation must retain uncertain-outcome ciphertext');
 assert.equal(f.ciphertext('terminal-old'),null);
});
