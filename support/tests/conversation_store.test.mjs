import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1CaseStore} from '../d1_case_store.js';
import {createCaseRecord} from '../control_plane.js';
import {importSupportDataKey} from '../crypto_envelope.js';

class Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(/FROM support_cases/.test(this.sql)) return this.db.caseRow;
    return null;
  }
  async all(){
    if(/FROM support_cases/.test(this.sql)) return {results:this.db.caseRows};
    if(/FROM support_case_messages/.test(this.sql)) return {results:this.db.messageRows};
    return {results:[]};
  }
}
class FakeD1 {
  constructor(caseRow){this.caseRow=caseRow;this.caseRows=[];this.messageRows=[];this.statements=[];this.batches=[];}
  prepare(sql){const s=new Statement(this,sql);this.statements.push(s);return s;}
  async batch(statements){this.batches.push(statements);return statements.map(()=>({success:true}));}
}

test('schema stores encrypted conversation messages separately and makes them append-only', async () => {
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS support_case_messages/);
  assert.match(schema,/encrypted_payload TEXT NOT NULL/);
  assert.match(schema,/visibility TEXT NOT NULL CHECK \(visibility IN \('customer','internal'\)\)/);
  assert.match(schema,/support_case_message_no_update/);
  assert.match(schema,/support_case_message_no_delete/);
});

test('D1 operator reply persists ciphertext and advances the case event chain without plaintext body binds', async () => {
  assert.equal(typeof D1CaseStore.prototype.appendOperatorMessage,'function');
  const bundle=await createCaseRecord({
    surface:'security',category:'security_report',affected_scope:'self',
    summary:'Synthetic security case',description:'Synthetic description.',reproduction:'Reproduce in isolation.',
    impact:'Synthetic impact.',evidence_refs:[],consent_to_process:true,
  },{at:'2026-10-08T10:00:00Z',caseId:'AX-0123456789AB',recoveryCode:'01234567-89ABCDEF-GHJKMNPQ'});
  const key=await importSupportDataKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
  const db=new FakeD1({
    case_id:bundle.case_record.case_id,state:'NEW',priority:'P0',surface:'security',category:'security_report',
    requester_ref:null,retention_class:'SECURITY_RESTRICTED',human_approval_required:1,
    public_json:JSON.stringify({case_id:bundle.case_record.case_id,state:'NEW',priority:'P0',surface:'security',category:'security_report',created_at:'2026-10-08T10:00:00.000Z',updated_at:'2026-10-08T10:00:00.000Z'}),
    encrypted_payload:'{}',recovery_hash:bundle.case_record.recovery_hash,last_event_hash:bundle.case_record.last_event_hash,
    created_at:'2026-10-08T10:00:00.000Z',updated_at:'2026-10-08T10:00:00.000Z',
  });
  const store=new D1CaseStore({database:db,encryptionKey:key});
  const body='We reproduced the issue in the isolated runtime.';
  const value=await store.appendOperatorMessage('AX-0123456789AB',{type:'AGENT_REPLY',body},{actor_ref:'support_agent:owner',role:'support_agent'});
  assert.equal(value.message.type,'AGENT_REPLY');
  assert.equal(value.message.body,body);
  const serialized=JSON.stringify(db.batches.flatMap(batch=>batch.map(s=>s.args)));
  assert.doesNotMatch(serialized,new RegExp(body));
  assert.match(serialized,/AXM-[0-9A-HJKMNP-TV-Z]{16}/);
  assert.equal(db.batches[0].some(s=>/INSERT INTO support_case_messages/.test(s.sql)),true);
  assert.equal(db.batches[0].some(s=>/INSERT INTO support_case_events/.test(s.sql)),true);
  assert.equal(db.batches[0].some(s=>/UPDATE support_cases SET last_event_hash/.test(s.sql)),true);
});

test('operator inbox listing is metadata-only and bounded', async () => {
  assert.equal(typeof D1CaseStore.prototype.listOperatorCases,'function');
  const key=await importSupportDataKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
  const db=new FakeD1(null);
  db.caseRows=[{case_id:'AX-0123456789AB',state:'NEW',priority:'P0',surface:'security',category:'security_report',retention_class:'SECURITY_RESTRICTED',human_approval_required:1,created_at:'2026-10-08T10:00:00Z',updated_at:'2026-10-08T10:00:00Z'}];
  const store=new D1CaseStore({database:db,encryptionKey:key});
  const rows=await store.listOperatorCases({limit:50});
  assert.equal(rows.length,1);
  assert.equal(rows[0].case_id,'AX-0123456789AB');
  assert.equal('encrypted_payload' in rows[0],false);
  const listSql=db.statements.find(s=>/SELECT case_id,state,priority/.test(s.sql))?.sql||'';
  assert.doesNotMatch(listSql,/encrypted_payload/);
});
