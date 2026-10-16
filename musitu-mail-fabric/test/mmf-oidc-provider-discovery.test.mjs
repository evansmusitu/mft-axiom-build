import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {IdentityAdmission} from '../src/commercial/mmf-oidc-admission.mjs';
import {createPrivateOidcCodeExchanger} from '../src/commercial/mmf-oidc-private-token-exchange.mjs';
import {qualifyPrivateMmfOidcProvider} from '../src/commercial/mmf-oidc-provider-discovery.mjs';

const issuer='https://idp.example.net/realms/mmf';
const auth=issuer+'/protocol/openid-connect/auth';
const token=issuer+'/protocol/openid-connect/token';
const jwks=issuer+'/protocol/openid-connect/certs';
const discovery=issuer+'/.well-known/openid-configuration';
const material=generateKeyPairSync('rsa',{modulusLength:2048});
const key=material.publicKey;
const publicJwk=key.export({format:'jwk'});
const digest=createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
const approved=Object.freeze([{kid:'approved-mmf-2026',spkiFingerprint:digest}]);
const otherPublic=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'jwk'});
const metadata={issuer,authorization_endpoint:auth,token_endpoint:token,jwks_uri:jwks,response_types_supported:['code'],grant_types_supported:['authorization_code'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256']};
const fixtureJwks={keys:[{...publicJwk,kid:'approved-mmf-2026',use:'sig',alg:'RS256',key_ops:['verify']}]};
function httpJson(obj){return new Response(JSON.stringify(obj),{status:200,headers:{'content-type':'application/json'}})}
function fakeFetch({meta=metadata,keys=fixtureJwks,override}={}){
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(override)return override(url,opts);
  if(url===discovery)return httpJson(meta);
  if(url===jwks)return httpJson(keys);
  throw Error('unexpected URI');
 };
 return {fetchImpl,calls};
}
const config={issuer,authorizationEndpoint:auth,tokenEndpoint:token,jwksUri:jwks,approvedKeys:approved};
test('operator-pinned OIDC discovery and JWKS validate signing key without auto-adopting unapproved keys',async()=>{
 const x=fakeFetch({keys:{keys:[...fixtureJwks.keys,{...otherPublic,kid:'unapproved-rsa',alg:'RS256',use:'sig'}]}});
 const result=await qualifyPrivateMmfOidcProvider({...config,fetchImpl:x.fetchImpl});
 assert.equal(result.issuer,issuer);
 assert.equal(result.authorizationEndpoint,auth);
 assert.equal(result.tokenEndpoint,token);
 assert.equal(result.keyId,'approved-mmf-2026');
 assert.equal(result.spkiFingerprint,digest);
 assert.deepEqual(result.publicJwk,publicJwk);
 assert.equal(result.unapprovedKeyCount,1);
 assert.equal(result.publicCustomerLoginEnabled,false);
 assert.equal(result.mailSendingEnabled,false);
 assert.equal(result.commerceEnabled,false);
 assert.deepEqual(x.calls.map(x=>x.url),[discovery,jwks]);
 assert.ok(x.calls.every(x=>x.opts.method==='GET'&&x.opts.redirect==='error'&&x.opts.credentials==='omit'&&x.opts.cache==='no-store'));
 assert.ok(!JSON.stringify(result).includes('private_key'));
});
test('unapproved signing fingerprints, altered issuer, endpoints, and PKCE downgrade fail closed',async()=>{
 const bad=[
  {...config,approvedKeys:[{kid:'approved-mmf-2026',spkiFingerprint:'f'.repeat(64)}]},
  {...config,issuer:'http://idp.example.net/realms/mmf'},
  {...config,tokenEndpoint:'https://evil.example.net/token'},
  {...config,jwksUri:'https://idp.example.net/realms/mmf-evil/certs'},
  {...config,approvedKeys:[]}
 ];
 for(const v of bad)await assert.rejects(()=>qualifyPrivateMmfOidcProvider({...v,fetchImpl:fakeFetch().fetchImpl}),/MMF_OIDC_PROVIDER_DISCOVERY_DENIED/);
 for(const m of [
  {...metadata,issuer:'https://evil.example.net'},
  {...metadata,authorization_endpoint:'https://evil.example.net/auth'},
  {...metadata,token_endpoint:'https://idp.example.net/realms/mmf-evil/token'},
  {...metadata,code_challenge_methods_supported:['plain']},
  {...metadata,id_token_signing_alg_values_supported:['HS256']},
  {...metadata,response_types_supported:['token']},
 ])await assert.rejects(()=>qualifyPrivateMmfOidcProvider({...config,fetchImpl:fakeFetch({meta:m}).fetchImpl}),/MMF_OIDC_PROVIDER_DISCOVERY_DENIED/);
});
test('duplicate kid, weak key, forged JWKS fields, failed redirects and oversized remote bodies fail closed',async()=>{
 const failing=[
  fakeFetch({keys:{keys:[...fixtureJwks.keys,...fixtureJwks.keys]}}),
  fakeFetch({keys:{keys:[{...fixtureJwks.keys[0],alg:'HS256'}]}}),
  fakeFetch({keys:{keys:[{...fixtureJwks.keys[0],d:'DO_NOT_LOAD_A_PRIVATE_KEY'}]}}),
  fakeFetch({keys:{keys:[...fixtureJwks.keys,{kty:'oct',kid:'unapproved-oct',k:'SENSITIVE_MATERIAL'}]}}),
  fakeFetch({override:()=>new Response('<html>bad</html>',{status:200,headers:{'content-type':'text/html'}})}),
  fakeFetch({override:()=>new Response('redirect',{status:302,headers:{location:'https://evil.example.org'}})}),
  fakeFetch({override:()=>new Response('x'.repeat(33000),{status:200,headers:{'content-type':'application/json'}})}),
  fakeFetch({override:()=>{throw Error('SECRET_PROVIDER_FAILURE')}})
 ];
 for(const x of failing)await assert.rejects(()=>qualifyPrivateMmfOidcProvider({...config,fetchImpl:x.fetchImpl}),e=>e.message==='MMF_OIDC_PROVIDER_DISCOVERY_DENIED');
});

test('verified provider snapshot binds existing token exchanger and exact pinned RS256 admission',async()=>{
 const x=fakeFetch();
 const snapshot=await qualifyPrivateMmfOidcProvider({...config,fetchImpl:x.fetchImpl});
 const now=Date.UTC(2026,9,16,9);
 const env={MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
 const db=new DatabaseSync(':memory:');
 try{
  const admission=new IdentityAdmission(db,{issuer:snapshot.issuer,audience:'mmf-private-stage',
   keyId:snapshot.keyId,publicJwk:snapshot.publicJwk,spkiFingerprint:snapshot.spkiFingerprint,
   sessionPepper:Buffer.alloc(32,22),env,now:()=>now});
  const {nonce}=admission.issueChallenge();
  const jwtPart=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
  const h=jwtPart({alg:'RS256',typ:'JWT',kid:snapshot.keyId});
  const p=jwtPart({iss:issuer,sub:'synthetic-owner',aud:'mmf-private-stage',nonce,iat:Math.floor(now/1000)-1,auth_time:Math.floor(now/1000)-1,amr:['pwd','otp'],exp:Math.floor(now/1000)+90});
  const signingInput=h+'.'+p;
  const id_token=signingInput+'.'+sign('RSA-SHA256',Buffer.from(signingInput),material.privateKey).toString('base64url');
  const redirectUri='https://mmf-private.example.net/private/oidc/callback';
  const exchanger=createPrivateOidcCodeExchanger({issuer:snapshot.issuer,tokenEndpoint:snapshot.tokenEndpoint,
   clientId:'mmf-private-stage',redirectUri,fetchImpl:async()=>httpJson({id_token})});
  const result=await exchanger({code:'SYNTHETIC-CODE-123',codeVerifier:'A'.repeat(43),
   clientId:'mmf-private-stage',redirectUri,signal:AbortSignal.timeout(1000)});
  assert.equal(result.id_token,id_token);
  const session=admission.acceptLogin({idToken:result.id_token,nonce});
  assert.match(session.sessionToken,/^mmf_session_/);
  assert.equal(session.realSendingAuthorized,false);
  assert.equal(session.commercialPaymentsAuthorized,false);
  assert.equal(admission.revokeSession(session.sessionToken),true);
  assert.throws(()=>admission.authenticateSession(session.sessionToken),/MMF_OIDC_DENIED/);
 }finally{db.close()}
});