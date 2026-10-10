import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {runSyntheticTransactionProbe} from '../src/edge/synthetic-transaction.mjs';
import {verifyProof} from '../src/evidence.mjs';
function setup(t){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>db.close());
 const keys=generateKeyPairSync('ed25519');
 const env={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_STAGE_CRYPTO_READY:'true',MMF_STAGE_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),MMF_STAGE_DATA_KEY_B64:randomBytes(32).toString('base64')};
 return {db:createD1Compat(db),sql:db,env,keys};
}
test('synthetic-only durable transaction runs once and independently verifies evidence',async t=>{
 const x=setup(t),id='probe-transaction-20261010-abcdef';
 const first=await runSyntheticTransactionProbe(x.db,x.env,id);
 assert.equal(first.state,'ACCEPTED_BY_PROVIDER');
 assert.equal(first.evidenceVerified,true);
 assert.equal(first.customerMailSent,false);
 assert.equal(verifyProof(first.proof,{trustedPublicKey:first.proof.publicKey}),true);
 const hash=createHash('sha256').update(x.keys.publicKey.export({format:'der',type:'spki'})).digest('hex');
 assert.equal(first.publicKeySha256,hash);
 assert.equal(JSON.stringify(first.proof).includes('synthetic-recipient@example.net'),false);
 const again=await runSyntheticTransactionProbe(x.db,x.env,id);
 assert.equal(first.messageId,again.messageId);
 assert.equal(x.sql.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,1);
 assert.equal(x.sql.prepare('SELECT sealed_envelope FROM mail_messages').get().sealed_envelope,null);
});
test('synthetic end-to-end engine refuses non-staging environment, invalid probe and missing keys',async t=>{
 const x=setup(t),id='probe-transaction-20261010-abcdef';
 await assert.rejects(()=>runSyntheticTransactionProbe(x.db,{...x.env,MMF_REAL_SEND_ENABLED:'true'},id),/STAGING_ONLY/);
 await assert.rejects(()=>runSyntheticTransactionProbe(x.db,x.env,'hello@customer.invalid'),/INVALID_SYNTHETIC_PROBE/);
 await assert.rejects(()=>runSyntheticTransactionProbe(x.db,{...x.env,MMF_STAGE_DATA_KEY_B64:''},id),/STAGING_SECRET_INVALID/);
 assert.equal(x.sql.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,0);
});
