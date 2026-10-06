import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {purgeExpiredCase} from '../retention_lifecycle.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

class Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(/SELECT case_id,state,retention_class/.test(this.sql)) return this.db.caseRow;
    if(/SELECT receipt_sha256/.test(this.sql)) return this.db.receipt;
    if(/SELECT COUNT\(\*\) AS count FROM support_case_events/.test(this.sql)) return {count:this.db.eventCount};
    return null;
  }
}
class FakeD1 {
  constructor(){
    this.caseRow={
      case_id:'AX-0123456789AB',state:'CLOSED',retention_class:'PRIVACY_RESTRICTED',
      closed_at:'2026-01-01T00:00:00Z',retention_expires_at:'2026-04-01T00:00:00.000Z',
      legal_hold_until:null,last_event_hash:'b'.repeat(64),
    };
    this.eventCount=2; this.receipt=null; this.batchCalls=[];
  }
  prepare(sql){return new Statement(this,sql);}
  async batch(statements){
    this.batchCalls.push(statements);
    const auth=statements.find(x=>/INSERT INTO support_case_purge_authorizations/.test(x.sql));
    const receipt=statements.find(x=>/INSERT INTO support_deletion_receipts/.test(x.sql));
    const delEvents=statements.find(x=>/DELETE FROM support_case_events/.test(x.sql));
    const delCase=statements.find(x=>/DELETE FROM support_cases/.test(x.sql));
    const clearAuth=statements.find(x=>/DELETE FROM support_case_purge_authorizations/.test(x.sql));
    assert.ok(auth&&receipt&&delEvents&&delCase&&clearAuth);
    this.receipt={receipt_sha256:receipt.args[0],case_reference_sha256:receipt.args[1],purged_at:receipt.args[5]};
    this.eventCount=0; this.caseRow=null;
    return statements.map(()=>({success:true}));
  }
}

test('schema permits deletion only through an authorization row and preserves immutable deletion receipts', async()=>{
  const sql=await readFile(resolve(root,'schema.sql'),'utf8');
  assert.match(sql,/support_deletion_receipts/);
  assert.match(sql,/support_case_purge_authorizations/);
  assert.match(sql,/support_case_no_delete/);
  assert.match(sql,/WHEN NOT EXISTS[\s\S]*support_case_purge_authorizations/i);
  assert.match(sql,/support_deletion_receipt_no_update/);
  assert.match(sql,/support_deletion_receipt_no_delete/);
  for(const column of ['closed_at','retention_expires_at','legal_hold_until','legal_hold_review_at']) assert.match(sql,new RegExp(column));
});

test('expired closed case purge removes live case and events but retains only a hashed deletion receipt', async()=>{
  const db=new FakeD1();
  const result=await purgeExpiredCase({
    database:db,
    caseId:'AX-0123456789AB',
    now:'2026-04-02T00:00:00Z',
    actorRole:'privacy_officer',
    ownerRef:'github:evansmusitu',
    independentApproverRef:'person:elvis-musitu',
    approvalEvidenceHashes:['c'.repeat(64),'d'.repeat(64)],
  });
  assert.equal(result.status,'PURGED');
  assert.match(result.receipt.receipt_sha256,/^[a-f0-9]{64}$/);
  assert.equal('case_id' in result.receipt,false);
  assert.equal(db.caseRow,null);
  assert.equal(db.eventCount,0);
  assert.ok(db.receipt);
});

test('purge refuses active retention or legal hold before any batch write', async()=>{
  const db=new FakeD1();
  db.caseRow.retention_expires_at='2026-12-31T00:00:00Z';
  await assert.rejects(()=>purgeExpiredCase({
    database:db,caseId:'AX-0123456789AB',now:'2026-04-02T00:00:00Z',
    actorRole:'privacy_officer',ownerRef:'github:evansmusitu',independentApproverRef:'person:elvis-musitu',
    approvalEvidenceHashes:['c'.repeat(64)]
  }),/not eligible for purge/);
  assert.equal(db.batchCalls.length,0);

  db.caseRow.retention_expires_at='2026-04-01T00:00:00.000Z';
  db.caseRow.legal_hold_until='2026-05-01T00:00:00Z';
  await assert.rejects(()=>purgeExpiredCase({
    database:db,caseId:'AX-0123456789AB',now:'2026-04-02T00:00:00Z',
    actorRole:'privacy_officer',ownerRef:'github:evansmusitu',independentApproverRef:'person:elvis-musitu',
    approvalEvidenceHashes:['c'.repeat(64)]
  }),/not eligible for purge/);
  assert.equal(db.batchCalls.length,0);
});
