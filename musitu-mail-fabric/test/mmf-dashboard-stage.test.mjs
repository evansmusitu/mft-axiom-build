import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {CommercialPlatform} from '../src/commercial/mmf-commercial-platform.mjs';
import {IdentityAdmission,StageCommercialController} from '../src/commercial/mmf-oidc-admission.mjs';

const time=Date.UTC(2026,9,13,20);
const env={MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
const issuer='https://idp.example.org';
const audience='mmf-closed-stage';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pub=publicKey.export({format:'jwk'});
const pin=createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const commercial=new CommercialPlatform(db,{apiPepper:Buffer.alloc(32,11),trustedPaymentKey:generateKeyPairSync('ed25519').publicKey,now:()=>time,env});
 const identity=new IdentityAdmission(db,{issuer,audience,keyId:'idp-stage-rsa-v1',publicJwk:pub,spkiFingerprint:pin,sessionPepper:Buffer.alloc(32,12),now:()=>time,env});
 const dashboard=new StageCommercialController({platform:commercial,admission:identity});
 function login(sub){
  const {nonce}=identity.issueChallenge();
  const head=enc({alg:'RS256',typ:'JWT',kid:'idp-stage-rsa-v1'});
  const payload=enc({iss:issuer,aud:audience,sub,nonce,iat:Math.floor((time-1000)/1000),exp:Math.floor((time+300000)/1000)});
  const data=head+'.'+payload;
  const jwt=data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
  return identity.acceptLogin({idToken:jwt,nonce}).sessionToken;
 }
 return {db,commercial,identity,dashboard,login};
}

test('owner session reads stage-only dashboard with domain/subscription/key metadata, no secrets or false entitlement',t=>{
 const {commercial,identity,dashboard,login}=fixture(t); const owner=login('owner-alpha');
 dashboard.createTenant({sessionToken:owner,tenantId:'tenant-alpha'});
 const key=commercial.issueApiKey({tenantId:'tenant-alpha',actorSubject:identity.authenticateSession(owner).actorSubject,scope:'events:read'});
 const challenge=dashboard.requestDomain({sessionToken:owner,tenantId:'tenant-alpha',domain:'mail.example.org'});
 dashboard.openSubscription({sessionToken:owner,tenantId:'tenant-alpha',planCode:'LAUNCH',orderReference:'MMF-ORDER-ABCD12345678'});
 commercial.meterStageEvent({tenantId:'tenant-alpha',actorSubject:identity.authenticateSession(owner).actorSubject,kind:'governed',idempotencyKey:'EVENT-ABCD123456'});
 const data=dashboard.getDashboard({sessionToken:owner,tenantId:'tenant-alpha',actorSubject:'oidc:malicious-subject'});
 assert.deepEqual(data.domains,[{domain:'mail.example.org',status:'PENDING_DNS'}]);
 assert.deepEqual(data.apiKeys,[{keyId:key.keyId,scope:'events:read',revoked:false}]);
 assert.deepEqual(data.subscriptions,[{orderReference:'MMF-ORDER-ABCD12345678',planCode:'LAUNCH',status:'PENDING',amountCents:9900}]);
 assert.equal(data.usage.count,1);
 assert.equal(data.tenantId,'tenant-alpha');
 assert.equal(data.canSendMail,false);
 assert.equal(data.canInitiatePayments,false);
 assert.equal(data.customerApiEnabled,false);
 const wire=JSON.stringify(data);
 for(const secret of [key.token,challenge.txtValue,'secret_hash','owner_subject','challenge_hash','provider_ref','sessionToken']) assert.equal(wire.includes(secret),false);
 assert.equal(Object.isFrozen(data),true);
 identity.revokeSession(owner);
 assert.throws(()=>dashboard.getDashboard({sessionToken:owner,tenantId:'tenant-alpha'}),/MMF_OIDC_DENIED/);
});

test('dashboard cannot access another tenant, take browser-supplied actor or leak existence of missing tenant',t=>{
 const {dashboard,login}=fixture(t); const owner=login('owner-one'),attacker=login('owner-two');
 dashboard.createTenant({sessionToken:owner,tenantId:'tenant-alpha'});
 dashboard.createTenant({sessionToken:attacker,tenantId:'tenant-bravo'});
 assert.throws(()=>dashboard.getDashboard({sessionToken:attacker,tenantId:'tenant-alpha',actorSubject:'oidc:owner-one'}),/MMF_PLATFORM_DENIED/);
 assert.throws(()=>dashboard.getDashboard({sessionToken:owner,tenantId:'tenant-bravo'}),/MMF_PLATFORM_DENIED/);
 assert.throws(()=>dashboard.getDashboard({sessionToken:owner,tenantId:'does-not-exist'}),/MMF_PLATFORM_DENIED/);
 assert.throws(()=>dashboard.getDashboard({sessionToken:owner,tenantId:"tenant-alpha' OR 1=1 --"}),/MMF_PLATFORM_DENIED/);
});

test('dashboard keys show revoked metadata without resurrecting access or revealing hashes',t=>{
 const {dashboard,commercial,identity,login}=fixture(t),sessionToken=login('owner-revoke');
 dashboard.createTenant({sessionToken,tenantId:'tenant-alpha'});
 const issued=dashboard.issueApiKey({sessionToken,tenantId:'tenant-alpha',scope:'billing:read'});
 dashboard.revokeApiKey({sessionToken,tenantId:'tenant-alpha',keyId:issued.keyId});
 const view=dashboard.getDashboard({sessionToken,tenantId:'tenant-alpha'});
 assert.deepEqual(view.apiKeys,[{keyId:issued.keyId,scope:'billing:read',revoked:true}]);
 assert.throws(()=>commercial.authenticateApiKey(issued.token,'billing:read'),/MMF_PLATFORM_DENIED/);
});

test('dashboard refuses unbounded keys instead of truncating security-critical inventory',t=>{
 const {commercial,identity,dashboard,login}=fixture(t);
 const sessionToken=login('owner-large');dashboard.createTenant({sessionToken,tenantId:'tenant-alpha'});
 const actorSubject=identity.authenticateSession(sessionToken).actorSubject;
 for(let i=0;i<51;i++)commercial.issueApiKey({tenantId:'tenant-alpha',actorSubject,scope:'events:read'});
 assert.throws(()=>dashboard.getDashboard({sessionToken,tenantId:'tenant-alpha'}),/MMF_PLATFORM_DENIED/);
});
