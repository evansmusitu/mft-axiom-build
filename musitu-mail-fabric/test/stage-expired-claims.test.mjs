import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createSyntheticStageFabric,reconcileSyntheticStage} from '../src/edge/synthetic-transaction.mjs';
import {verifyProof} from '../src/evidence.mjs';

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>sqlite.close());
 const {privateKey}=generateKeyPairSync('ed25519');
 const env={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',
   MMF_WEBHOOK_ENABLED:'false',MMF_STAGE_CRYPTO_READY:'true',
   MMF_STAGE_DATA_KEY_B64:randomBytes(32).toString('base64'),
   MMF_STAGE_SIGNING_PRIVATE_KEY_PEM:privateKey.export({type:'pkcs8',format:'pem'}).toString()};
 const db=createD1Compat(sqlite);
 const message=key=>({tenantId:'stage-tenant',from:'synthetic@example.org',to:'synthetic-recipient@example.net',
  subject:'Private simulated traffic',text:'Never send to the network',kind:'SERVICE_ALERT',idempotencyKey:key});
 return {sqlite,db,env,message};
}
test('expired staged synthetic in-flight message becomes OUTCOME_UNKNOWN without provider retry',async t=>{
 const f=fixture(t);
 const factory=createSyntheticStageFabric(f.db,f.env,'probe-maintenance-unit-0001');
 const q=await factory.fabric.enqueue(f.message('probe-maintenance-unit-0001'));
 const claim=await factory.fabric.claim(q.messageId);
 assert.ok(claim?.token);
 f.sqlite.prepare('UPDATE mail_messages SET lease_deadline=? WHERE message_id=?').run(Date.now()-1000,q.messageId);
 const result=await reconcileSyntheticStage(f.db,f.env);
 assert.equal(result.reconciled,1);assert.equal(result.staleBefore,1);assert.equal(result.staleAfter,0);
 assert.equal(result.customerMailSent,false);assert.equal(result.providerRetryAttempted,false);
 const recovered=await factory.fabric.get(q.messageId,'stage-tenant');
 assert.equal(recovered.state,'OUTCOME_UNKNOWN');
 assert.equal(verifyProof(recovered.proof,{trustedPublicKey:recovered.proof.publicKey}),true);
 assert.equal(f.sqlite.prepare('SELECT sealed_envelope FROM mail_messages WHERE message_id=?').get(q.messageId).sealed_envelope,null);
 assert.equal((await reconcileSyntheticStage(f.db,f.env)).reconciled,0);
});
test('unknown or customer-like in-flight idempotency scope prevents ANY staged recovery mutation',async t=>{
 const f=fixture(t);
 const good=createSyntheticStageFabric(f.db,f.env,'probe-maintenance-unit-0002');
 const synthetic=await good.fabric.enqueue(f.message('probe-maintenance-unit-0002'));
 await good.fabric.claim(synthetic.messageId);
 const unknown=await good.fabric.enqueue(f.message('customer-other-transaction-12345'));
 await good.fabric.claim(unknown.messageId);
 f.sqlite.prepare("UPDATE mail_messages SET lease_deadline=? WHERE state='SENDING'").run(Date.now()-1000);
 await assert.rejects(()=>reconcileSyntheticStage(f.db,f.env),/STAGE_RECONCILIATION_SCOPE_DENIED/);
 const still=f.sqlite.prepare("SELECT COUNT(*) AS n FROM mail_messages WHERE state='SENDING'").get().n;
 assert.equal(still,2);
});
test('staged recovery fails closed if live send or public API flag is ever enabled',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>reconcileSyntheticStage(f.db,{...f.env,MMF_REAL_SEND_ENABLED:'true'}),/STAGING_ONLY/);
 await assert.rejects(()=>reconcileSyntheticStage(f.db,{...f.env,MMF_API_ENABLED:'true'}),/STAGING_ONLY/);
});
