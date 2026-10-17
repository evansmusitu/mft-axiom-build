import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {IdentityAdmission,StageCommercialController,verifyPinnedOidcIdToken} from '../src/commercial/mmf-oidc-admission.mjs';

const ISSUER='https://auth.example.org';
const AUD='mmf-staging-client';
import {CommercialPlatform} from '../src/commercial/mmf-commercial-platform.mjs';
const NOW=Date.UTC(2026,9,12,13);
const ENV={MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
const keyPair=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=keyPair.publicKey.export({format:'jwk'});
const PIN=createHash('sha256').update(keyPair.publicKey.export({type:'spki',format:'der'})).digest('hex');
const base64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(nonce,changes={},header={}){
 const h=base64({alg:'RS256',kid:'owner-identity-rsa-2026',typ:'JWT',...header});
 const p=base64({iss:ISSUER,aud:AUD,sub:'identity-subject-stable',exp:Math.floor((NOW+300000)/1000),iat:Math.floor((NOW-5000)/1000),nonce,amr:['pwd','otp'],auth_time:Math.floor((NOW-5000)/1000),...changes});
 const input=h+'.'+p;
 return input+'.'+sign('RSA-SHA256',Buffer.from(input),keyPair.privateKey).toString('base64url');
}
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const admission=new IdentityAdmission(db,{issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,sessionPepper:Buffer.alloc(32,23),env:ENV,now:()=>NOW});
 return {db,admission};
}
function token(nonce,changes={},header={}){return jwt(nonce,changes,header)}

test('registered client IDs containing @ keep exact audience, authorized-party and MFA checks',()=>{
 const audience='170086824411201793@portal';
 const options={issuer:ISSUER,audience,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,nonce:'challenge-abc',nowMs:NOW};
 const claims={aud:[audience,'170086774599581953'],azp:audience};
 assert.equal(verifyPinnedOidcIdToken(token(options.nonce,claims),options).audience,audience);
 assert.equal(verifyPinnedOidcIdToken(token(options.nonce,{aud:audience}),options).audience,audience);
 for(const bad of [
  {...claims,azp:undefined},{...claims,azp:'170086824411201793@other'},
  {aud:'170086824411201793@other'},
  {...claims,amr:['pwd']},{...claims,amr:['pwd','mfa']},
  {...claims,auth_time:Math.floor(NOW/1000)-301},
  {...claims,nonce:'different-challenge'},
 ])assert.throws(()=>verifyPinnedOidcIdToken(token(options.nonce,bad),options),/MMF_OIDC_DENIED/);
 for(const bad of ['client\n@portal','client @portal','client@portal/other','client@portal?x=1'])
  assert.throws(()=>verifyPinnedOidcIdToken(token(options.nonce,{aud:bad}),{...options,audience:bad}),/MMF_OIDC_DENIED/);
});

test('pinned OIDC signature, issuer, audience, nonce and subject are mandatory',()=>{
 const result=verifyPinnedOidcIdToken(token('challenge-abc'),{issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,nonce:'challenge-abc',nowMs:NOW});
 assert.match(result.actorSubject,/^oidc:[a-f0-9]{64}$/);
 assert.equal(result.issuer,ISSUER);
 for(const modification of [
  {iss:'https://evil.example.org'}, {aud:'some-other-client'}, {nonce:'not-the-challenge'},
  {exp:Math.floor((NOW-999999)/1000)}, {iat:Math.floor((NOW+999999)/1000)},
  {sub:''}, {sub:'abc'.repeat(100)}
 ]) assert.throws(()=>verifyPinnedOidcIdToken(token('challenge-abc',modification),{issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,nonce:'challenge-abc',nowMs:NOW}),/MMF_OIDC_DENIED/);
});

test('signed OIDC identity without recent provider MFA assurance is rejected',()=>{
 const options={issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,nonce:'challenge-abc',nowMs:NOW};
 const nowSec=Math.floor(NOW/1000);
 for(const bad of [
  {amr:undefined,auth_time:nowSec-10},
  {amr:['pwd'],auth_time:nowSec-10},
  {amr:['otp'],auth_time:nowSec-10},
  {amr:['pwd','otp'],auth_time:undefined},
  {amr:['pwd','otp'],auth_time:nowSec-700},
  {amr:['pwd','otp'],auth_time:nowSec+300},
  {amr:['pwd','sms'],auth_time:nowSec-5},
 ])assert.throws(()=>verifyPinnedOidcIdToken(token('challenge-abc',bad),options),/MMF_OIDC_DENIED/);
 assert.match(verifyPinnedOidcIdToken(token('challenge-abc',{amr:['pwd','otp'],auth_time:nowSec-5}),options).actorSubject,/^oidc:/);
});

test('untrusted key metadata, algorithm substitution, and forged signatures are refused',()=>{
 const options={issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,nonce:'challenge-abc',nowMs:NOW};
 assert.throws(()=>verifyPinnedOidcIdToken(token('challenge-abc'),{...options,spkiFingerprint:'0'.repeat(64)}),/MMF_OIDC_DENIED/);
 for(const header of [{alg:'none'},{alg:'HS256'},{kid:'other'},{jku:'https://example.com/keys'},{jwk},{crit:['unknown']},{typ:'JWE'}])
  assert.throws(()=>verifyPinnedOidcIdToken(token('challenge-abc',{},header),options),/MMF_OIDC_DENIED/);
 const jwtParts=token('challenge-abc').split('.');jwtParts[2]=jwtParts[2].slice(0,-1)+(jwtParts[2].endsWith('A')?'B':'A');
 assert.throws(()=>verifyPinnedOidcIdToken(jwtParts.join('.'),options),/MMF_OIDC_DENIED/);
});

test('challenge consumption and session issuance are durable one-time operations',t=>{
 const {admission,db}=fixture(t);
 const challenge=admission.issueChallenge();
 assert.equal(challenge.expiresAtMs,NOW+5*60000);
 const issued=admission.acceptLogin({idToken:token(challenge.nonce),nonce:challenge.nonce});
 assert.match(issued.sessionToken,/^mmf_session_[A-Za-z0-9_-]{43}$/);
 assert.equal(issued.realSendingAuthorized,false);
 assert.equal(issued.commercialPaymentsAuthorized,false);
 assert.equal(admission.authenticateSession(issued.sessionToken).actorSubject,issued.actorSubject);
 assert.throws(()=>admission.acceptLogin({idToken:token(challenge.nonce),nonce:challenge.nonce}),/MMF_OIDC_DENIED/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_oidc_login_challenges WHERE consumed=1').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_oidc_sessions WHERE session_hash=?').get(issued.sessionToken).n,0);
 assert.equal(admission.revokeSession(issued.sessionToken),true);
 assert.throws(()=>admission.authenticateSession(issued.sessionToken),/MMF_OIDC_DENIED/);
});

test('forged or mistimed login never consumes the challenge',t=>{
 const {admission,db}=fixture(t);const {nonce}=admission.issueChallenge();
 assert.throws(()=>admission.acceptLogin({idToken:token(nonce,{aud:'attacker-app'}),nonce}),/MMF_OIDC_DENIED/);
 assert.throws(()=>admission.acceptLogin({idToken:token(nonce),nonce:'not-the-actual-nonce'}),/MMF_OIDC_DENIED/);
 assert.equal(db.prepare('SELECT SUM(consumed) AS n FROM mmf_oidc_login_challenges').get().n,0);
 assert.equal(admission.acceptLogin({idToken:token(nonce),nonce}).realSendingAuthorized,false);
});

test('session tokens expire and do not grant sending or billing on any runtime flag',t=>{
 let clock=NOW;const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const admission=new IdentityAdmission(db,{issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,sessionPepper:Buffer.alloc(32,25),env:ENV,now:()=>clock});
 const {nonce}=admission.issueChallenge();const login=admission.acceptLogin({nonce,idToken:token(nonce)});
 clock+=16*60*1000;
 assert.throws(()=>admission.authenticateSession(login.sessionToken),/MMF_OIDC_DENIED/);
 assert.throws(()=>new IdentityAdmission(new DatabaseSync(':memory:'),{issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,sessionPepper:Buffer.alloc(32,23),env:{...ENV,MMF_COMMERCE_ENABLED:'true'},now:()=>NOW}),/MMF_OIDC_DENIED/);
});

test('owner identity cannot be substituted with arbitrary browser body identity',t=>{
 const {admission}=fixture(t);const a=admission.issueChallenge();const session=admission.acceptLogin({nonce:a.nonce,idToken:token(a.nonce)});
 const verified=admission.authenticateSession(session.sessionToken);
 assert.equal(verified.actorSubject,session.actorSubject);
 assert.equal(verified.customerApiEnabled,false);
 assert.notEqual(verified.actorSubject,'oidc:attacker-chosen-subject');
});

test('OIDC issuers may contain trusted provider realm paths without accepting unrelated paths',()=>{
 const issuer='https://login.example.org/realms/business';
 const params={issuer,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,nonce:'challenge-abc',nowMs:NOW};
 const input=token('challenge-abc',{iss:issuer});
 assert.equal(verifyPinnedOidcIdToken(input,params).issuer,issuer);
 assert.throws(()=>verifyPinnedOidcIdToken(input,{...params,issuer:'https://login.example.org/realms/other'}),/MMF_OIDC_DENIED/);
});

test('OIDC multi-audience token requires authorized-party azp equal to MMF client',()=>{
 const params={issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',publicJwk:jwk,spkiFingerprint:PIN,nonce:'challenge-abc',nowMs:NOW};
 assert.equal(verifyPinnedOidcIdToken(token('challenge-abc',{aud:[AUD,'another-audience'],azp:AUD}),params).actorSubject.length,69);
 assert.throws(()=>verifyPinnedOidcIdToken(token('challenge-abc',{aud:[AUD,'another-audience'],azp:'another-audience'}),params),/MMF_OIDC_DENIED/);
 assert.throws(()=>verifyPinnedOidcIdToken(token('challenge-abc',{aud:[AUD,'another-audience']}),params),/MMF_OIDC_DENIED/);
});

test('verified stage session controls tenant resources without trusting caller actorSubject',t=>{
 const {admission,db}=fixture(t);
 const payment=generateKeyPairSync('ed25519');
 const platform=new CommercialPlatform(db,{apiPepper:Buffer.alloc(32,77),trustedPaymentKey:payment.publicKey,now:()=>NOW,env:ENV});
 const control=new StageCommercialController({admission,platform});
 const challenge=admission.issueChallenge();
 const login=admission.acceptLogin({nonce:challenge.nonce,idToken:token(challenge.nonce)});
 const tenant=control.createTenant({sessionToken:login.sessionToken,tenantId:'org-alpha',actorSubject:'oidc:evil-subject'});
 assert.equal(tenant.tenantId,'org-alpha');
 const secret=control.issueApiKey({sessionToken:login.sessionToken,tenantId:'org-alpha',scope:'events:read',actorSubject:'oidc:evil-subject'});
 assert.equal(platform.authenticateApiKey(secret.token,'events:read').tenantId,'org-alpha');
 assert.throws(()=>control.openSubscription({sessionToken:'mmf_session_'+'a'.repeat(43),tenantId:'org-alpha',planCode:'LAUNCH',orderReference:'MMF-ORDER-ABCDEFGHIJK'}),/MMF_OIDC_DENIED/);
 const order=control.openSubscription({sessionToken:login.sessionToken,tenantId:'org-alpha',planCode:'LAUNCH',orderReference:'MMF-ORDER-ABCDEFGHIJK'});
 assert.equal(order.liveEntitlement,false);
 assert.equal(control.tenantEntitlement({sessionToken:login.sessionToken,tenantId:'org-alpha'}).canSend,false);
 admission.revokeSession(login.sessionToken);
 assert.throws(()=>control.getUsage({sessionToken:login.sessionToken,tenantId:'org-alpha'}),/MMF_OIDC_DENIED/);
});

test('pinned key may only be an OIDC signing verification key, never encryption/private key',()=>{
 const base={issuer:ISSUER,audience:AUD,keyId:'owner-identity-rsa-2026',spkiFingerprint:PIN,nonce:'challenge-abc',nowMs:NOW};
 for(const unsafe of [{...jwk,use:'enc'},{...jwk,key_ops:['encrypt']},{...jwk,alg:'RSA-OAEP'}, {...jwk,d:'abc'}]){
  assert.throws(()=>verifyPinnedOidcIdToken(token('challenge-abc'),{...base,publicJwk:unsafe}),/MMF_OIDC_DENIED/);
 }
});
