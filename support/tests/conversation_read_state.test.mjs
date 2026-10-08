import assert from 'node:assert/strict';
import test from 'node:test';
import {D1CaseStore} from '../d1_case_store.js';
import {createCaseRecord} from '../control_plane.js';
import {encryptSupportPayload, importSupportDataKey} from '../crypto_envelope.js';

class Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(/FROM support_cases/.test(this.sql)) return this.db.caseRow;
    return null;
  }
  async all(){
    if(/FROM support_case_messages/.test(this.sql)) return {results:this.db.messageRows};
    if(/FROM support_cases/.test(this.sql)) return {results:this.db.caseRows};
    return {results:[]};
  }
}
class FakeD1 {
  constructor(){this.caseRow=null;this.caseRows=[];this.messageRows=[];this.statements=[];this.batches=[];}
  prepare(sql){const s=new Statement(this,sql);this.statements.push(s);return s;}
  async batch(stmts){this.batches.push(stmts);return stmts.map(()=>({success:true}));}
}

async function fixture(){
  const key=await importSupportDataKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
  const bundle=await createCaseRecord({
    surface:'api_runtime',category:'bug',affected_scope:'self',summary:'Synthetic thread',
    description:'Original encrypted narrative.',reproduction:'Use isolated request.',impact:'One task blocked.',
    evidence_refs:[],consent_to_process:true,
  },{at:'2026-10-08T11:00:00Z',caseId:'AX-0123456789AB',recoveryCode:'01234567-89ABCDEF-GHJKMNPQ'});
  const original=await encryptSupportPayload({
    summary:'Synthetic thread',description:'Original encrypted narrative.',reproduction:'Use isolated request.',impact:'One task blocked.',evidence_refs:[],
  },{key,caseId:bundle.case_record.case_id});
  const customer=await encryptSupportPayload({body:'Customer follow-up.'},{key,caseId:bundle.case_record.case_id,schema:'musitu.axiom.support-message-encrypted.v1'});
  const agent=await encryptSupportPayload({body:'Agent response.'},{key,caseId:bundle.case_record.case_id,schema:'musitu.axiom.support-message-encrypted.v1'});
  const internal=await encryptSupportPayload({body:'Private internal note.'},{key,caseId:bundle.case_record.case_id,schema:'musitu.axiom.support-message-encrypted.v1'});
  const db=new FakeD1();
  db.caseRow={
    ...bundle.case_record,
    public_json:JSON.stringify({case_id:bundle.case_record.case_id,state:'NEW',priority:'P2',surface:'api_runtime',category:'bug',created_at:bundle.case_record.created_at,updated_at:bundle.case_record.updated_at}),
    encrypted_payload:JSON.stringify(original),
  };
  db.messageRows=[
    {message_id:'AXM-0000000000000001',case_id:bundle.case_record.case_id,type:'CUSTOMER_MESSAGE',actor:'requester',visibility:'customer',encrypted_payload:JSON.stringify(customer),event_hash:'a'.repeat(64),created_at:'2026-10-08T11:01:00Z'},
    {message_id:'AXM-0000000000000002',case_id:bundle.case_record.case_id,type:'AGENT_REPLY',actor:'support_agent:owner',visibility:'customer',encrypted_payload:JSON.stringify(agent),event_hash:'b'.repeat(64),created_at:'2026-10-08T11:02:00Z'},
    {message_id:'AXM-0000000000000003',case_id:bundle.case_record.case_id,type:'INTERNAL_NOTE',actor:'support_agent:owner',visibility:'internal',encrypted_payload:JSON.stringify(internal),event_hash:'c'.repeat(64),created_at:'2026-10-08T11:03:00Z'},
  ];
  return {key,bundle,db,store:new D1CaseStore({database:db,encryptionKey:key})};
}

test('recovery-authenticated customer thread decrypts only customer-visible messages',async()=>{
  const {store,bundle}=await fixture();
  assert.equal(typeof store.getAuthorizedThread,'function');
  const wrong=await store.getAuthorizedThread(bundle.case_record.case_id,'ABCDEFGH-JKLMNPQR-STUVWXYZ');
  assert.equal(wrong,null);
  const value=await store.getAuthorizedThread(bundle.case_record.case_id,bundle.recovery_code);
  assert.equal(value.details.description,'Original encrypted narrative.');
  assert.deepEqual(value.messages.map(x=>x.body),['Customer follow-up.','Agent response.']);
  assert.equal(value.messages.some(x=>x.type==='INTERNAL_NOTE'),false);
});

test('operator case view decrypts full thread including internal notes without recovery code',async()=>{
  const {store,bundle}=await fixture();
  assert.equal(typeof store.getOperatorCase,'function');
  const value=await store.getOperatorCase(bundle.case_record.case_id);
  assert.equal(value.details.summary,'Synthetic thread');
  assert.deepEqual(value.messages.map(x=>x.body),['Customer follow-up.','Agent response.','Private internal note.']);
  assert.equal(value.messages.at(-1).visibility,'internal');
});

test('customer reply requires valid recovery hash and persists ciphertext plus a chained event',async()=>{
  const {store,bundle,db}=await fixture();
  assert.equal(typeof store.appendCustomerMessage,'function');
  assert.equal(await store.appendCustomerMessage(bundle.case_record.case_id,'BADCODE',{body:'Nope'}),null);
  const body='Here is another sanitized reproduction detail.';
  const value=await store.appendCustomerMessage(bundle.case_record.case_id,bundle.recovery_code,{body});
  assert.equal(value.message.type,'CUSTOMER_MESSAGE');
  const serialized=JSON.stringify(db.batches.at(-1).map(s=>s.args));
  assert.doesNotMatch(serialized,new RegExp(body));
  assert.equal(db.batches.at(-1).some(s=>/INSERT INTO support_case_messages/.test(s.sql)),true);
  assert.equal(db.batches.at(-1).some(s=>/INSERT INTO support_case_events/.test(s.sql)),true);
});

test('operator state transition maps public labels and obeys existing state machine',async()=>{
  const {store,bundle,db}=await fixture();
  assert.equal(typeof store.transitionOperatorCase,'function');
  const principal={actor_ref:'support_agent:owner',role:'support_agent'};
  const value=await store.transitionOperatorCase(bundle.case_record.case_id,'ESCALATED',principal);
  assert.equal(value.state,'TRIAGED');
  assert.equal(value.public_label,'ESCALATED');
  const binds=JSON.stringify(db.batches.at(-1).map(s=>s.args));
  assert.match(binds,/TRIAGED/);
  await assert.rejects(()=>store.transitionOperatorCase(bundle.case_record.case_id,'SOLUTION_PROVIDED',principal),/not allowed/);
});
