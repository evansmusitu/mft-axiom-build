import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {createCloudflareMmfPkceQualification} from '../src/staging/mmf-cloudflare-pkce-qualification.mjs';

// RFC 7636 Appendix B values; all keys, codes and identities below are fixtures.
const verifier='dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge='E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const clientId='fixture-mmf-client-2026';
const issuer='https://musitu-axiom.cloudflareaccess.com/cdn-cgi/access/sso/oidc/'+clientId;
const callback='https://mail-stage.mftintelligence.com/private/oidc/callback';
const now=Date.UTC(2026,9,17,10);
const nonce='N'.repeat(43),code='fixture-authorization-code-2026';
const material=generateKeyPairSync('rsa',{modulusLength:2048});
const other=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=material.publicKey.export({format:'jwk'});
const fingerprint=createHash('sha256').update(material.publicKey.export({type:'spki',format:'der'})).digest('hex');
const env={MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
const config={clientId,issuer,tokenEndpoint:issuer+'/token',redirectUri:callback,
 keyId:'fixture-signing-key',publicJwk:jwk,spkiFingerprint:fingerprint,env,now:()=>now};
const request=()=>({code,codeVerifier:verifier,nonce,signal:AbortSignal.timeout(2000)});
const jwt=(overrides={},key=material.privateKey)=>{
 const part=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const input=part({alg:'RS256',typ:'JWT',kid:config.keyId})+'.'+part({iss:issuer,aud:clientId,
 sub:'fixture-approved-administrator',nonce,amr:['pwd','otp'],auth_time:now/1000-1,iat:now/1000-1,exp:now/1000+120,...overrides});
 return input+'.'+sign('RSA-SHA256',Buffer.from(input),key).toString('base64url');
};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
function provider({token=jwt(),override}={}){
 const calls=[];
 return {calls,fetchImpl:async(url,options)=>{
  const body=new URLSearchParams(options.body);calls.push({url,options,body});
  if(override)return override({url,options,body,index:calls.length});
  assert.equal(url,issuer+'/token');assert.equal(body.get('client_id'),clientId);
  assert.equal(body.get('redirect_uri'),callback);assert.equal(body.get('code'),code);
  assert.equal(body.get('grant_type'),'authorization_code');
  return body.get('code_verifier')===verifier?json({id_token:token,token_type:'Bearer',expires_in:120}):json({error:'invalid_grant'},400);
 }};
}
test('RFC S256 negative checks and correctly signed recent-MFA token yield only a sanitized qualification result',async()=>{
 const p=provider();const run=createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl});
 const result=await run(request());
 assert.equal(p.calls.length,3);assert.notEqual(p.calls[0].body.get('code_verifier'),verifier);
 assert.equal(p.calls[1].body.get('code_verifier'),challenge);assert.equal(p.calls[2].body.get('code_verifier'),verifier);
 assert.ok(p.calls.every(x=>x.options.method==='POST'&&x.options.redirect==='error'&&x.options.credentials==='omit'&&x.options.cache==='no-store'));
 assert.deepEqual(result,{pkceChecksPassed:true,signedMfaAndNonceChecksPassed:true,sessionCreated:false,
  strictDiscoveryQualified:false,customerApiEnabled:false,realSendingEnabled:false,paymentsEnabled:false,productionReady:false});
 const text=JSON.stringify(result);for(const secret of [code,verifier,nonce,'fixture-approved-administrator',jwt()])assert.ok(!text.includes(secret));
 await assert.rejects(()=>run(request()),/MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED/);
 assert.equal(p.calls.length,3,'the same code cannot be retried through this instance');
});
test('provider accepting a wrong verifier or treating the S256 challenge as a plain verifier fails before positive exchange',async()=>{
 for(const acceptedProbe of [1,2]){
  const p=provider({override:({index})=>index===acceptedProbe?json({id_token:jwt()}):json({error:'invalid_grant'},400)});
  await assert.rejects(()=>createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl})(request()),/MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED/);
  assert.equal(p.calls.length,acceptedProbe);
 }
});
test('a signed token still fails for absent or stale MFA, wrong nonce, wrong audience or issuer, and forged signature',async()=>{
 const bad=[jwt({amr:['pwd']}),jwt({amr:['mfa','sms']}),jwt({auth_time:now/1000-301}),
  jwt({nonce:'M'.repeat(43)}),jwt({aud:'other-client'}),jwt({iss:'https://other.example.net'}),jwt({},other.privateKey)];
 for(const token of bad){
  const p=provider({token});
  await assert.rejects(()=>createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl})(request()),/MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED/);
 }
});
test('configuration drift and commercial enablement reject before any network request',()=>{
 const p=provider();
 for(const bad of [
  {issuer:'https://other.cloudflareaccess.com/cdn-cgi/access/sso/oidc/'+clientId},
  {tokenEndpoint:'https://attacker.example.net/token'},
  {redirectUri:'https://attacker.example.net/private/oidc/callback'},
  {clientId:'other-client'}, {spkiFingerprint:'0'.repeat(64)},
  {publicJwk:{...jwk,d:'private-field'}}, {keyId:''},
  {env:{...env,MMF_REAL_SEND_ENABLED:'true'}}, {env:{...env,MMF_COMMERCE_ENABLED:'true'}},
  {env:{...env,MMF_CUSTOMER_API_ENABLED:'true'}}, {timeoutMs:9000}
 ])assert.throws(()=>createCloudflareMmfPkceQualification({...config,...bad,fetchImpl:p.fetchImpl}),/MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED/);
 assert.equal(p.calls.length,0);
});
test('network failures, redirects, wrong grant errors and invalid JSON are not accepted as negative PKCE evidence',async()=>{
 const outcomes=[()=>{throw Error('fixture-sensitive-provider-error')},
  ()=>json({error:'invalid_client'},400),()=>json({error:'invalid_grant'},401),
  ()=>new Response('redirect',{status:302,headers:{location:'https://attacker.example.net'}}),
  ()=>new Response('no',{status:400,headers:{'content-type':'text/html'}}),
  ()=>new Response('{',{status:400,headers:{'content-type':'application/json'}})];
 for(const outcome of outcomes){
  const p=provider({override:outcome});
  await assert.rejects(()=>createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl})(request()),e=>e.message==='MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED');
  assert.equal(p.calls.length,1);
 }
});
test('oversized negative response is cancelled and cannot reach the positive exchange',async()=>{
 let cancelled=false;
 const p=provider({override:()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(4097))},cancel(){cancelled=true}}),
  {status:400,headers:{'content-type':'application/json'}})});
 await assert.rejects(()=>createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl})(request()));
 assert.equal(p.calls.length,1);assert.equal(cancelled,true);
});
test('malformed inputs and pre-aborted request do not send codes to the provider',async()=>{
 const p=provider(),run=createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl});
 const abort=new AbortController();abort.abort();
 for(const input of [{...request(),code:'x'},{...request(),codeVerifier:'x'},{...request(),nonce:'x'},
  {...request(),signal:abort.signal},{...request(),clientId:'untrusted-replacement'}])
  await assert.rejects(()=>run(input),/MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED/);
 assert.equal(p.calls.length,0);
});
test('concurrent replay of one code cannot trigger a second qualification exchange',async()=>{
 const p=provider(),run=createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl});
 const results=await Promise.allSettled([run(request()),run(request())]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 assert.equal(p.calls.length,3);
});

test('failure diagnostics report fixed stages/reasons and allowlisted OAuth errors without provider details',async()=>{
 const cases=[
  [()=>{throw Error('fixture-secret-network-detail')},{stage:'NEGATIVE_WRONG_VERIFIER',reason:'TOKEN_REQUEST_FAILED'}],
  [()=>json({error:'invalid_grant'},401),{stage:'NEGATIVE_WRONG_VERIFIER',reason:'NEGATIVE_HTTP_STATUS'}],
  [()=>json({error:'invalid_client',error_description:'fixture-secret-provider-detail'},400),{stage:'NEGATIVE_WRONG_VERIFIER',reason:'NEGATIVE_OAUTH_ERROR',oauthError:'invalid_client'}],
  [()=>json({error:'fixture-secret-error'},400),{stage:'NEGATIVE_WRONG_VERIFIER',reason:'NEGATIVE_OAUTH_ERROR',oauthError:'OTHER_OR_MISSING'}],
  [()=>new Response('{fixture-secret',{status:400,headers:{'content-type':'application/json'}}),{stage:'NEGATIVE_WRONG_VERIFIER',reason:'NEGATIVE_JSON'}],
  [()=>json({error:'invalid_grant',id_token:'fixture-secret-token'},400),{stage:'NEGATIVE_WRONG_VERIFIER',reason:'NEGATIVE_TOKEN_RETURNED',oauthError:'invalid_grant'}]
 ];
 for(const [override,expected]of cases){
  const p=provider({override});
  await assert.rejects(()=>createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl})(request()),e=>{
   assert.equal(e.message,'MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED');assert.deepEqual(e.qualificationDiagnostic,expected);
   assert.ok(!JSON.stringify(e.qualificationDiagnostic).includes('fixture-secret'));return true;
  });assert.equal(p.calls.length,1);
 }
 for(const [at,stage] of [[2,'NEGATIVE_CHALLENGE_VERIFIER'],[3,'CORRECT_VERIFIER_EXCHANGE']]){
  const p=provider({override:({index})=>index<at?json({error:'invalid_grant'},400):json({error:'invalid_client'},400)});
  await assert.rejects(()=>createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl})(request()),e=>{
   assert.equal(e.qualificationDiagnostic.stage,stage);return true;
  });assert.equal(p.calls.length,at);
 }
 const p=provider({token:jwt({amr:['pwd']})});
 await assert.rejects(()=>createCloudflareMmfPkceQualification({...config,fetchImpl:p.fetchImpl})(request()),e=>{
  assert.deepEqual(e.qualificationDiagnostic,{stage:'SIGNED_ID_TOKEN_VALIDATION',reason:'SIGNED_ID_TOKEN_REJECTED'});return true;
 });assert.equal(p.calls.length,3);
});
