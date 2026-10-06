import assert from 'node:assert/strict';
import test from 'node:test';
import {closeSupportCase} from '../retention_lifecycle.js';

class Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(/SELECT case_id,state,priority,surface,category/.test(this.sql)) return this.db.row;
    return null;
  }
}
class FakeD1 {
  constructor(state='RESOLVED'){
    this.row={
      case_id:'AX-0123456789GH',state,priority:'P2',surface:'web_app',category:'bug',
      retention_class:'SUPPORT_STANDARD',closed_at:null,retention_expires_at:null,
      last_event_hash:'a'.repeat(64),created_at:'2026-01-01T00:00:00Z',updated_at:'2026-02-01T00:00:00Z',
      public_json:JSON.stringify({schema:'musitu.axiom.support-case-public.v1',case_id:'AX-0123456789GH',state,priority:'P2',surface:'web_app',category:'bug',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-02-01T00:00:00Z'}),
    };
    this.events=[];this.batchCalls=0;
  }
  prepare(sql){return new Statement(this,sql);}
  async batch(statements){
    this.batchCalls+=1;
    const update=statements.find(x=>/UPDATE support_cases SET state=/.test(x.sql));
    const event=statements.find(x=>/INSERT INTO support_case_events/.test(x.sql));
    assert.ok(update&&event);
    this.row.state=update.args[0];
    this.row.closed_at=update.args[1];
    this.row.retention_expires_at=update.args[2];
    this.row.last_event_hash=update.args[3];
    this.row.updated_at=update.args[4];
    this.row.public_json=update.args[5];
    this.events.push({type:event.args[3],payload:JSON.parse(event.args[6])});
    return statements.map(()=>({success:true}));
  }
}

test('closing a resolved case stamps the approved retention expiry and append-only close event',async()=>{
  const db=new FakeD1('RESOLVED');
  const result=await closeSupportCase({database:db,caseId:'AX-0123456789GH',at:'2026-10-06T07:30:00Z',actor:'support_agent_1'});
  assert.equal(result.state,'CLOSED');
  assert.equal(result.closed_at,'2026-10-06T07:30:00.000Z');
  assert.equal(result.retention_expires_at,'2027-04-04T07:30:00.000Z');
  assert.equal(db.row.state,'CLOSED');
  assert.equal(JSON.parse(db.row.public_json).state,'CLOSED');
  assert.equal(db.events[0].type,'CASE_CLOSED');
  assert.equal(db.events[0].payload.retention_class,'SUPPORT_STANDARD');
  assert.equal(db.events[0].payload.retention_expires_at,'2027-04-04T07:30:00.000Z');
});

test('closure refuses a state transition not allowed by the canonical case machine',async()=>{
  const db=new FakeD1('NEW');
  await assert.rejects(()=>closeSupportCase({database:db,caseId:'AX-0123456789GH',at:'2026-10-06T07:30:00Z',actor:'support_agent_1'}),/not allowed/);
  assert.equal(db.batchCalls,0);
});
