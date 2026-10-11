import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';

function fixture(t){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>sql.close());
 const db=createD1Compat(sql);
 const insert=(id,tenant,state,sealed='ciphertext')=>sql.prepare(`
  INSERT INTO mail_messages(message_id,tenant_id,idempotency_key,request_hash,recipient_hmac,state,sealed_envelope,events_json,created_ms,updated_ms)
  VALUES(?,?,?,?,?,?,?,?,?,?)
 `).run(id,tenant,'idem-'+id,'hash-'+id,'recipient-'+id,state,sealed,'[]',123,123);
 return{sql,db,insert};
}

// Genuine dependency counts cannot certify external backups or safely activate a key rotation.
test('read-only per-tenant key retirement audit counts encryption and privacy dependencies without leakage',async t=>{
 const {auditKeyRotationDependencies}=await import('../src/ops/key-rotation-readiness.mjs');
 const f=fixture(t);
 f.insert('queued1','tenant-one','QUEUED');
 f.insert('uncertain1','tenant-one','OUTCOME_UNKNOWN');
 f.insert('complete1','tenant-one','ACCEPTED_BY_PROVIDER',null);
 f.insert('other1','tenant-two','QUEUED');
 f.sql.prepare('INSERT INTO mail_suppressions VALUES(?,?,?)').run('tenant-one','r1',123);
 f.sql.prepare('INSERT INTO mail_suppressions VALUES(?,?,?)').run('tenant-two','r2',123);
 const report=await auditKeyRotationDependencies(f.db,{tenantId:'tenant-one'});
 assert.deepEqual(report.counts,{encryptedEnvelopes:2,unreconciledMessages:2,
  recipientHmacReferences:3,suppressionReferences:1,providerEvents:0});
 assert.equal(report.rotationAuthorized,false);
 assert.equal(report.externalBackupInventoryVerified,false);
 assert.deepEqual(report.blockers.encryptionKey,['ENCRYPTED_ENVELOPES_REMAIN','UNRECONCILED_DELIVERY_REMAINS','EXTERNAL_BACKUP_KEYS_UNKNOWN']);
 assert.deepEqual(report.blockers.privacyKey,['RECIPIENT_HMAC_REFERENCES_REMAIN','EXTERNAL_BACKUP_KEYS_UNKNOWN']);
 assert.deepEqual(report.blockers.backupKey,['EXTERNAL_BACKUP_KEYS_UNKNOWN']);
 assert.deepEqual(report.blockers.signingPrivateKey,['INDEPENDENTLY_PINNED_TRUST_TRANSITION_REQUIRED']);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,4,'audit never mutates ledger');
});

test('even empty ledger never automatically authorizes retiring or replacing live operational keys',async t=>{
 const {auditKeyRotationDependencies}=await import('../src/ops/key-rotation-readiness.mjs');
 const f=fixture(t),report=await auditKeyRotationDependencies(f.db,{tenantId:'tenant-one'});
 assert.deepEqual(Object.values(report.counts),[0,0,0,0,0]);
 assert.equal(report.rotationAuthorized,false);
 assert.deepEqual(report.blockers.encryptionKey,['EXTERNAL_BACKUP_KEYS_UNKNOWN']);
});

test('audit fails closed on invalid tenant and database outages or corrupt aggregate counts',async()=>{
 const {auditKeyRotationDependencies}=await import('../src/ops/key-rotation-readiness.mjs');
 for(const scope of [{tenantId:'../wrong'},{tenantId:''},{tenantId:null}])
  await assert.rejects(()=>auditKeyRotationDependencies({prepare(){throw Error('should not touch db')}},scope),/ROTATION_AUDIT_DENIED/);
 await assert.rejects(()=>auditKeyRotationDependencies({prepare(){throw Error('offline')}},{tenantId:'tenant-one'}),/ROTATION_AUDIT_UNAVAILABLE/);
 await assert.rejects(()=>auditKeyRotationDependencies({prepare(){return{bind(){return{first:async()=>({encrypted_envelopes:-1})}}}}},{tenantId:'tenant-one'}),/ROTATION_AUDIT_UNAVAILABLE/);
});
