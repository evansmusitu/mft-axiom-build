import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluatePurgeEligibility} from '../retention_policy.js';
import {applyLegalHold, reviewLegalHold, releaseLegalHold} from '../retention_lifecycle.js';

class Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(/SELECT case_id,state,retention_class/.test(this.sql)) return this.db.caseRow;
    return null;
  }
}
class FakeD1 {
  constructor(){
    this.caseRow={
      case_id:'AX-0123456789AB',state:'CLOSED',retention_class:'PRIVACY_RESTRICTED',
      closed_at:'2026-01-01T00:00:00Z',retention_expires_at:'2026-04-01T00:00:00.000Z',
      legal_hold_until:null,legal_hold_review_at:null,last_event_hash:'b'.repeat(64),updated_at:'2026-01-01T00:00:00Z',
    };
    this.events=[];
  }
  prepare(sql){return new Statement(this,sql);}
  async batch(statements){
    const update=statements.find(x=>/UPDATE support_cases SET/.test(x.sql));
    const event=statements.find(x=>/INSERT INTO support_case_events/.test(x.sql));
    assert.ok(update&&event);
    if(/legal_hold_until=\?,legal_hold_review_at=\?/.test(update.sql)){
      this.caseRow.legal_hold_until=update.args[0];
      this.caseRow.legal_hold_review_at=update.args[1];
      this.caseRow.last_event_hash=update.args[2];
      this.caseRow.updated_at=update.args[3];
    } else if(/legal_hold_review_at=\?/.test(update.sql)){
      this.caseRow.legal_hold_review_at=update.args[0];
      this.caseRow.last_event_hash=update.args[1];
      this.caseRow.updated_at=update.args[2];
    } else if(/legal_hold_until=NULL,legal_hold_review_at=NULL/.test(update.sql)){
      this.caseRow.legal_hold_until=null;
      this.caseRow.legal_hold_review_at=null;
      this.caseRow.last_event_hash=update.args[0];
      this.caseRow.updated_at=update.args[1];
    } else throw new Error('unexpected legal hold update');
    this.events.push({type:event.args[3],payload:JSON.parse(event.args[6])});
    return statements.map(()=>({success:true}));
  }
}

const auth={
  actorRole:'privacy_officer',
  ownerRef:'github:evansmusitu',
  independentApproverRef:'person:elvis-musitu',
  approvalEvidenceHashes:['c'.repeat(64)],
};

test('legal hold remains active past review deadline until dual-authorized release', async()=>{
  const db=new FakeD1();
  const applied=await applyLegalHold({
    database:db,caseId:'AX-0123456789AB',reasonHash:'a'.repeat(64),
    at:'2026-04-02T00:00:00Z',...auth,
  });
  assert.equal(applied.status,'ACTIVE');
  assert.equal(db.caseRow.legal_hold_until,'9999-12-31T23:59:59.000Z');
  assert.equal(db.caseRow.legal_hold_review_at,'2026-07-01T00:00:00.000Z');

  const afterMissedReview=evaluatePurgeEligibility({...db.caseRow,now:'2026-08-01T00:00:00Z'});
  assert.equal(afterMissedReview.eligible,false);
  assert.equal(afterMissedReview.reason,'LEGAL_HOLD_ACTIVE');

  const reviewed=await reviewLegalHold({
    database:db,caseId:'AX-0123456789AB',reasonHash:'a'.repeat(64),
    at:'2026-08-01T00:00:00Z',...auth,
  });
  assert.equal(reviewed.status,'ACTIVE');
  assert.equal(db.caseRow.legal_hold_review_at,'2026-10-30T00:00:00.000Z');

  const released=await releaseLegalHold({
    database:db,caseId:'AX-0123456789AB',at:'2026-08-02T00:00:00Z',...auth,
  });
  assert.equal(released.status,'RELEASED');
  assert.equal(db.caseRow.legal_hold_until,null);
  assert.equal(db.caseRow.legal_hold_review_at,null);
  assert.equal(evaluatePurgeEligibility({...db.caseRow,now:'2026-08-02T00:00:01Z'}).eligible,true);
  assert.deepEqual(db.events.map(x=>x.type),['LEGAL_HOLD_APPLIED','LEGAL_HOLD_REVIEWED','LEGAL_HOLD_RELEASED']);
});

test('legal hold lifecycle refuses same-person approval before any write', async()=>{
  const db=new FakeD1();
  await assert.rejects(()=>applyLegalHold({
    database:db,caseId:'AX-0123456789AB',reasonHash:'a'.repeat(64),at:'2026-04-02T00:00:00Z',
    actorRole:'privacy_officer',ownerRef:'person:same',independentApproverRef:'person:same',
    approvalEvidenceHashes:['c'.repeat(64)],
  }),/different independent approver/);
  assert.equal(db.events.length,0);
});
