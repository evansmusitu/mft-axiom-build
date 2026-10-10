import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createWorker} from '../src/edge/worker.mjs';
import {canonicalReleaseBytes,verifyLiveRelease} from '../src/security/release-authorization.mjs';

const shaKey=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
function releaseFixture(t){
 const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>d.close());
 const owner=generateKeyPairSync('ed25519'),approver=generateKeyPairSync('ed25519'),signing=generateKeyPairSync('ed25519');
 const env={MMF_DB:createD1Compat(d),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_REAL_SEND_ENABLED:'true',MMF_API_ENABLED:'true',MMF_PROVIDER:'resend',MMF_RESEND_API_KEY:'re_test-0000000000000000000000000000',MMF_AUTH_TOKEN:'synthetic-bearer-auth-token-0123456789abcdefghijklmnopqrstuvwxyz',
   MMF_ENCRYPTION_KEY_B64:randomBytes(32).toString('base64'),MMF_PRIVACY_KEY_B64:randomBytes(32).toString('base64'),
   MMF_SIGNING_PRIVATE_KEY_PEM:signing.privateKey.export({type:'pkcs8',format:'pem'}).toString(),MMF_SIGNING_PUBLIC_KEY_PEM:signing.publicKey.export({type:'spki',format:'pem'}).toString(),
   MMF_RELEASE_OWNER_PUBLIC_KEY_PEM:owner.publicKey.export({type:'spki',format:'pem'}).toString(),MMF_RELEASE_APPROVER_PUBLIC_KEY_PEM:approver.publicKey.export({type:'spki',format:'pem'}).toString(),
   MMF_RELEASE_OWNER_FINGERPRINT:shaKey(owner.publicKey),MMF_RELEASE_APPROVER_FINGERPRINT:shaKey(approver.publicKey)};
 const grant=({tenantId='client1',domain='example.org',provider='resend',issuedMs=Date.now()-60_000,expiresMs=Date.now()+3600_000,nonce='release-gate-0000000001'}={})=>{
  const policy={schema:'mmf-live-release-v1',tenantId,domain,provider,issuedMs,expiresMs,nonce};
  const bytes=canonicalReleaseBytes(policy);
  return JSON.stringify({grant:policy,ownerSignature:sign(null,bytes,owner.privateKey).toString('base64url'),approverSignature:sign(null,bytes,approver.privateKey).toString('base64url')});
 };
 return {d,env,grant,owner,approver};
}

test('two distinct pinned independent approvals permit a matching limited grant',t=>{
 const f=releaseFixture(t);f.env.MMF_RELEASE_GRANT_JSON=f.grant();
 assert.equal(verifyLiveRelease(f.env),true);
});

test('live release fails closed on missing, forged, expired, wrong tenant or provider authorizations',t=>{
 const f=releaseFixture(t);
 assert.throws(()=>verifyLiveRelease(f.env),/LIVE_RELEASE_(MISSING|DENIED)/);
 for(const body of [f.grant({expiresMs:Date.now()-1}),f.grant({tenantId:'other'}),f.grant({provider:'postal'}),f.grant({issuedMs:Date.now()+60_000}),f.grant({expiresMs:Date.now()+48*3600000})]){
  f.env.MMF_RELEASE_GRANT_JSON=body;
  assert.throws(()=>verifyLiveRelease(f.env),/LIVE_RELEASE_DENIED/);
 }
 const forged=JSON.parse(f.grant());forged.approverSignature=forged.ownerSignature;
 f.env.MMF_RELEASE_GRANT_JSON=JSON.stringify(forged);
 assert.throws(()=>verifyLiveRelease(f.env),/LIVE_RELEASE_DENIED/);
});

test('independent approval cannot be simulated using the same public key or mismatched pin',t=>{
 const f=releaseFixture(t);f.env.MMF_RELEASE_GRANT_JSON=f.grant();
 f.env.MMF_RELEASE_APPROVER_PUBLIC_KEY_PEM=f.env.MMF_RELEASE_OWNER_PUBLIC_KEY_PEM;
 assert.throws(()=>verifyLiveRelease(f.env),/LIVE_RELEASE_DENIED/);
 f.env.MMF_RELEASE_APPROVER_PUBLIC_KEY_PEM=f.approver.publicKey.export({type:'spki',format:'pem'}).toString();
 f.env.MMF_RELEASE_APPROVER_FINGERPRINT='0'.repeat(64);
 assert.throws(()=>verifyLiveRelease(f.env),/LIVE_RELEASE_DENIED/);
});

test('real-send API remains blocked despite valid sender DNS when no dual-signed grant exists',async t=>{
 const f=releaseFixture(t),now=Date.now();
 f.d.prepare(`INSERT INTO mail_sender_domains(tenant_id,domain,challenge_sha256,challenge_expires_ms,verified_until_ms,status,updated_ms) VALUES(?,?,?,?,?,'VERIFIED',?)`).run('client1','example.org','f'.repeat(64),now+100000,now+100000,now);
 const worker=createWorker();
 const message={from:'notice@example.org',to:'recipient@example.net',subject:'Synthetic account notice',text:'No real mail should ever be sent in this test.',kind:'ACCOUNT',idempotencyKey:'grant-required-00001'};
 const request=()=>new Request('https://test.invalid/v1/messages',{method:'POST',headers:{authorization:'Bearer '+f.env.MMF_AUTH_TOKEN},body:JSON.stringify(message)});
 const denied=await worker.fetch(request(),f.env);
 assert.equal(denied.status,503);
 assert.equal(f.d.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,0);
});

test('signed incoming provider feedback remains ingestible when the outbound release has expired',async t=>{
 const f=releaseFixture(t);f.env.MMF_RELEASE_GRANT_JSON=f.grant({expiresMs:Date.now()-5});
 f.env.MMF_WEBHOOK_ENABLED='true';f.env.MMF_WEBHOOK_SECRET='whsec_'+randomBytes(32).toString('base64');
 const {makeWebhook,webhookHeaders}=await import('./helpers/svix.mjs');
 const raw=makeWebhook({type:'email.delivered',data:{email_id:'synthetic-provider-not-in-store',to:['recipient@example.net']}});
 const h=webhookHeaders(f.env.MMF_WEBHOOK_SECRET,raw,'svix-outbound-expired-001');
 const response=await createWorker().fetch(new Request('https://test.invalid/v1/webhooks/resend',{method:'POST',headers:{'content-type':'application/json',...h},body:raw}),f.env);
 assert.equal(response.status,503,'expired outbound grant must not block authenticated webhook handling, but unattributed feedback must remain retryable');
 assert.deepEqual(await response.json(),{error:'PROVIDER_CORRELATION_PENDING'});
});
