import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {createWorker} from '../src/edge/worker.mjs';
import {provisionTestRelease} from './helpers/release-grant.mjs';
function fixture(t,{provider='resend'}={}){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>sql.close());
 const keys=generateDemonstrationKeys(),now=Date.now();
 sql.prepare("INSERT INTO mail_sender_domains(tenant_id,domain,challenge_sha256,challenge_expires_ms,verified_until_ms,status,updated_ms) VALUES(?,?,?,?,?,'VERIFIED',?)")
  .run('client1','example.org','0'.repeat(64),now+86400000,now+86400000,now);
 const env={MMF_DB:createD1Compat(sql),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_REAL_SEND_ENABLED:'true',
  MMF_API_ENABLED:'true',MMF_AUTH_TOKEN:'isolated-test-only-auth-token-01234567890123',
  MMF_PROVIDER:provider,MMF_RESEND_API_KEY:'re_test-12345678901234567890123456',MMF_POSTAL_API_KEY:'stage-postal-key-only',
  MMF_POSTAL_BASE_URL:'https://mail.example.org',MMF_WEBHOOK_ENABLED:'false',
  MMF_ENCRYPTION_KEY_B64:randomBytes(32).toString('base64'),
  MMF_PRIVACY_KEY_B64:randomBytes(32).toString('base64'),
  MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
  MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({format:'pem',type:'spki'}).toString()};
 provisionTestRelease(env);
 const calls={sends:0},fake={name:provider,region:'us-east-1',async send(){calls.sends++;return{outcome:'accepted',providerId:'fake-stage-only'}}};
 const worker=createWorker({providerFactory:()=>fake});
 const msg={from:'alerts@example.org',to:'recipient@example.net',subject:'Sample',text:'No network delivery',kind:'SECURITY',idempotencyKey:'feedback-gate-12345'};
 const req=()=>new Request('https://test.invalid/v1/messages',{method:'POST',headers:{authorization:'Bearer '+env.MMF_AUTH_TOKEN},body:JSON.stringify(msg)});
 return{sql,env,worker,calls,req};
}
test('two signed owner approvals still cannot activate a Resend sender without authenticated event intake',async t=>{
 const f=fixture(t);
 const response=await f.worker.fetch(f.req(),f.env);
 assert.equal(response.status,503);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,0);
 assert.equal(f.calls.sends,0);
});
test('a configured valid webhook signing secret and sender ownership can pass preflight without sending mail',async t=>{
 const f=fixture(t);f.env.MMF_WEBHOOK_ENABLED='true';
 f.env.MMF_WEBHOOK_SECRET='whsec_'+randomBytes(32).toString('base64');
 const response=await f.worker.fetch(f.req(),f.env);
 assert.equal(response.status,202);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,1);
 assert.equal(f.calls.sends,0);
});
test('configured webhook flag with missing or malformed secret remains fail-closed',async t=>{
 const f=fixture(t);f.env.MMF_WEBHOOK_ENABLED='true';
 for(const secret of [undefined,'invalid','whsec_short']){
  f.env.MMF_WEBHOOK_SECRET=secret;
  assert.equal((await f.worker.fetch(f.req(),f.env)).status,503);
 }
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,0);
});
test('Postal cannot be commercially released without a separately qualified authenticated provider-event intake',async t=>{
 const f=fixture(t,{provider:'postal'});
 assert.equal((await f.worker.fetch(f.req(),f.env)).status,503);
 assert.equal(f.calls.sends,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,0);
});
