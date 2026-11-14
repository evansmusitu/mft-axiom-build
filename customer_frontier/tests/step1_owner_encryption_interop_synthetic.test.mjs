import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { sealSqlExport, openSqlExport, BackupNoGo } from '../recovery/step1_encrypted_sql_export_transport.mjs';

// The prior PR216 encryption engine is unchanged. The independent-custodian
// *human approval* policy is not a cryptographic requirement: in this synthetic
// test the owner is recipient, with a distinct pinned X25519 keypair.
// Never substitute the synthetic key below for real customer backup custody.
const sha=x=>createHash('sha256').update(x).digest('hex');
test('synthetic owner-held X25519 key interoperates with unchanged authenticated encryption',()=>{
 const owner=generateKeyPairSync('x25519');
 const der=owner.publicKey.export({format:'der',type:'spki'});
 const ownerRecipientPin=sha(der);
 const privateSyntheticSql=Buffer.from("CREATE TABLE owner_offline_synthetic_only (id INTEGER);INSERT INTO owner_offline_synthetic_only VALUES (9);");
 const bookmark='a'.repeat(64),catalog='b'.repeat(64);
 const envelope=sealSqlExport({sql:privateSyntheticSql,
  custodianPublicSpkiDer:der,trustedCustodianSpkiSha256:ownerRecipientPin,
  bookmarkSha256:bookmark,catalogSha256:catalog,capturedAt:'2026-11-12T17:00:00.000Z'});
 assert.equal(envelope.recipient_spki_sha256,ownerRecipientPin);
 assert.ok(!JSON.stringify(envelope).includes('CREATE TABLE'));
 const opened=openSqlExport({envelope,custodianPrivateKey:owner.privateKey,
  expectedCustodianSpkiSha256:ownerRecipientPin,
  expectedBookmarkSha256:bookmark,expectedCatalogSha256:catalog});
 assert.deepEqual(opened,privateSyntheticSql);opened.fill(0);
 assert.throws(()=>openSqlExport({envelope,custodianPrivateKey:generateKeyPairSync('x25519').privateKey,
  expectedCustodianSpkiSha256:ownerRecipientPin,expectedBookmarkSha256:bookmark,expectedCatalogSha256:catalog}),
  e=>e instanceof BackupNoGo);
});
