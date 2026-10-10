import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {randomBytes} from 'node:crypto';import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {createWorker} from '../src/edge/worker.mjs';
import {provisionTestRelease} from './helpers/release-grant.mjs';
const base={from:'notices@example.org',to:'member@example.net',subject:'Security notice',text:'System notification',kind:'SECURITY',idempotencyKey:'guard-message-123'};
const token='example-strong-bearer-123456789012345678901234';
function create(t){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>db.close());
 const kp=generateDemonstrationKeys();const env={MMF_DB:createD1Compat(db),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_AUTH_TOKEN:token,MMF_API_ENABLED:'true',MMF_REAL_SEND_ENABLED:'true',MMF_PROVIDER:'resend',MMF_RESEND_API_KEY:'re_test-only-placeholder-123456789012345',MMF_WEBHOOK_ENABLED:'false',MMF_ENCRYPTION_KEY_B64:randomBytes(32).toString('base64'),MMF_PRIVACY_KEY_B64:randomBytes(32).toString('base64'),MMF_SIGNING_PRIVATE_KEY_PEM:kp.privateKey.export({format:'pem',type:'pkcs8'}).toString(),MMF_SIGNING_PUBLIC_KEY_PEM:kp.publicKey.export({format:'pem',type:'spki'}).toString()};return{db,env};}
test('actual outbound API refuses sender until separately DNS verified',async t=>{
 const {db,env}=create(t),worker=createWorker(),headers={authorization:'Bearer '+token};
 provisionTestRelease(env);
 const request=()=>new Request('https://example.invalid/v1/messages',{method:'POST',headers,body:JSON.stringify(base)});
 const denied=await worker.fetch(request(),env);assert.equal(denied.status,403);assert.equal((await denied.json()).error,'SENDER_NOT_VERIFIED');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,0);
 // Tenant and domain are verified in a separate trusted DNS workflow.
 db.prepare(`INSERT INTO mail_sender_domains(tenant_id,domain,challenge_sha256,challenge_expires_ms,verified_until_ms,status,updated_ms) VALUES(?,?,?,?,?,'VERIFIED',?)`)
   .run('client1','example.org','a'.repeat(64),Date.now()+86400000,Date.now()+86400000,Date.now());
 const accepted=await worker.fetch(request(),env);assert.equal(accepted.status,202);
});
test('sender not verified prevents queued real sending even if a record already exists',async t=>{
 const {db,env}=create(t),worker=createWorker();
 const claim={messageId:'bdd313bf-6a22-4c1f-a5bf-228874579a2d',tenantId:'client1'};
 let delivered=0;
 await worker.queue({messages:[{body:claim,ack(){delivered++},retry(){throw Error('no poison retry')}}]},env);
 assert.equal(delivered,1);
 assert.deepEqual(await worker.scheduled({},env),{status:'SENDER_NOT_VERIFIED'});
});
