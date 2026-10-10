import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {runSyntheticOperatorSuppressionProbe} from '../src/edge/synthetic-operator-suppression.mjs';
const probe='probe-operator-suppression-20261010';
function setup(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>sqlite.close());
 const {privateKey}=generateKeyPairSync('ed25519');
 const env={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',
  MMF_WEBHOOK_ENABLED:'false',MMF_STAGE_CRYPTO_READY:'true',
  MMF_STAGE_SIGNING_PRIVATE_KEY_PEM:privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  MMF_STAGE_DATA_KEY_B64:randomBytes(32).toString('base64')};
 return {db:createD1Compat(sqlite),sqlite,env};
}
test('real operator suppression HTTP logic persists only a keyed digest on the durable SQLite adapter',async t=>{
 const f=setup(t);
 const evidence=await runSyntheticOperatorSuppressionProbe(f.db,f.env,probe);
 assert.equal(evidence.status,'PASS');
 assert.equal(evidence.customerTokenRejected,true);
 assert.equal(evidence.operatorTokenRequired,true);
 assert.equal(evidence.durableSuppressionPersisted,true);
 assert.equal(evidence.duplicateIdempotent,true);
 assert.equal(evidence.subsequentMessageBlocked,true);
 assert.equal(evidence.customerMailSent,false);
 assert.equal(evidence.networkCalls,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_suppressions').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,0);
});
test('stage suppression probe cannot become a live mail, webhook or public service',async t=>{
 const f=setup(t);
 for(const flags of [{MMF_REAL_SEND_ENABLED:'true'},{MMF_API_ENABLED:'true'},{MMF_WEBHOOK_ENABLED:'true'}])
   await assert.rejects(()=>runSyntheticOperatorSuppressionProbe(f.db,{...f.env,...flags},probe),/STAGING_ONLY/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_suppressions').get().n,0);
});
