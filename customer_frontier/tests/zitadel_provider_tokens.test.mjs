// Synthetic cryptographic tests only. No provider credentials or network calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {verifyZitadelCodeTokens,ZITADEL_STAGING} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
const now=1793898732000,nonce='N'.repeat(43),access='synthetic-access-token-never-live';
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const publicKey={...await webcrypto.subtle.exportKey('jwk',keys.publicKey),kid:'synthetic-signing-key',use:'sig',alg:'RS256'};
const encode=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');
const claims=(patch={})=>({iss:ZITADEL_STAGING.issuer,sub:'100000000000000001',aud:[ZITADEL_STAGING.client_id,ZITADEL_STAGING.project_id],azp:ZITADEL_STAGING.client_id,
 nonce,iat:now/1000,exp:now/1000+3600,auth_time:now/1000-10,amr:['pwd','mfa'],...patch});
async function sign(body=claims(),header={alg:'RS256',kid:publicKey.kid,typ:'JWT'},key=keys.privateKey){
 const input=encode(header)+'.'+encode(body);
 const signature=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',key,Buffer.from(input));
 return input+'.'+Buffer.from(signature).toString('base64url');
}
function transport({jwks={keys:[publicKey]},userinfo={sub:'100000000000000001',email:'synthetic@example.test',email_verified:true},keyStatus=200,userStatus=200}={}){
 const requests=[];
 return {requests,fetcher:async request=>{requests.push(request);
  if(request.url===ZITADEL_STAGING.jwks_uri)return Response.json(jwks,{status:keyStatus});
  if(request.url===ZITADEL_STAGING.userinfo_endpoint)return Response.json(userinfo,{status:userStatus});
  throw Error('unexpected_destination');
 }};
}
const run=(idToken,t=transport(),extra={})=>verifyZitadelCodeTokens({id_token:idToken,access_token:access,expected_nonce:nonce,...extra},{fetcher:t.fetcher,clock:()=>Object.hasOwn(extra,'now')?extra.now:now});

test('real RSA verification accepts matching signed MFA identity and subject-bound verified UserInfo',async()=>{
 const t=transport();const result=await run(await sign(),t);
 assert.equal(result.subject,'100000000000000001');assert.equal(result.mfa_verified,true);assert.equal(result.email_verified,true);
 assert.equal(result.issuer,ZITADEL_STAGING.issuer);assert.equal(result.auth_time_ms,now-10000);
 for(const field of ['tenant_id','customer_id','roles','email','id_token','access_token','production_qualified','state_verified','pkce_method'])assert.equal(field in result,false,field);
 assert.equal(t.requests.length,2);
 assert.equal(t.requests[0].headers.has('authorization'),false);
 assert.equal(t.requests[1].headers.get('authorization'),'Bearer '+access);
 for(const r of t.requests){assert.equal(r.redirect,'manual');assert.equal(r.headers.has('cookie'),false);assert.equal(r.method,'GET');}
});
test('signature forgery and payload mutation fail before UserInfo',async()=>{
 const token=await sign(),parts=token.split('.');parts[1]=encode(claims({sub:'attacker'}));const t=transport();
 await assert.rejects(run(parts.join('.'),t),/idp_signature_invalid/);assert.equal(t.requests.length,1);
});
test('unsigned and algorithm-confused tokens are denied',async()=>{
 for(const alg of ['none','HS256','PS256'])await assert.rejects(run(await sign(claims(),{alg,kid:publicKey.kid})),/idp_header_invalid/);
});
test('embedded keys and token-selected key URLs cannot change the trust root',async()=>{
 for(const extra of [{jku:'https://attacker.test/keys'},{jwk:publicKey},{x5u:'https://attacker.test/cert'},{crit:['unknown']},{b64:false}])
  await assert.rejects(run(await sign(claims(),{alg:'RS256',kid:publicKey.kid,...extra})),/idp_header_invalid/);
});
test('unknown kid and duplicate kid are denied',async()=>{
 await assert.rejects(run(await sign(claims(),{alg:'RS256',kid:'unknown'})),/idp_key_invalid/);
 await assert.rejects(run(await sign(),transport({jwks:{keys:[publicKey,publicKey]}})),/idp_key_invalid/);
});
test('key algorithm, use, operations and private fields are checked',async()=>{
 for(const extra of [{alg:'HS256'},{use:'enc'},{key_ops:['sign']},{d:'private-field'},{e:'Aw'}])
  await assert.rejects(run(await sign(),transport({jwks:{keys:[{...publicKey,...extra}]}})),/idp_key_invalid/);
});
test('issuer, audience and authorized-party substitution fail closed',async()=>{
 for(const patch of [{iss:'https://attacker.test'},{aud:'wrong'},{azp:'wrong'},{azp:undefined},{aud:[ZITADEL_STAGING.project_id]}])
  await assert.rejects(run(await sign(claims(patch))),/idp_claims_invalid/);
});
test('one exact audience is supported and any provided azp must agree',async()=>{
 const result=await run(await sign(claims({aud:ZITADEL_STAGING.client_id,azp:undefined})));
 assert.equal(result.subject,'100000000000000001');
 await assert.rejects(run(await sign(claims({aud:ZITADEL_STAGING.client_id,azp:'wrong'}))),/idp_claims_invalid/);
});
test('missing, weak and substituted expected nonce cannot authenticate',async()=>{
 await assert.rejects(run(await sign(claims({nonce:'X'.repeat(43)}))),/idp_claims_invalid/);
 for(const value of ['',undefined,'short'])await assert.rejects(run(await sign(),transport(),{expected_nonce:value}),/idp_context_invalid/);
});
test('expired, future, stale-auth and malformed numeric claims are denied',async()=>{
 for(const patch of [{exp:now/1000},{iat:now/1000+31},{iat:now/1000-121},{auth_time:now/1000-301},{auth_time:now/1000+31},{auth_time:'now'},{exp:1e100},{nbf:now/1000+31}])
  await assert.rejects(run(await sign(claims(patch))),/idp_claims_invalid/);
 await assert.rejects(run(await sign(),transport(),{now:NaN}),/idp_context_invalid/);
});
test('unverified email or missing MFA stays denied',async()=>{
 for(const amr of [undefined,[],['pwd'],['mfa','mfa']])await assert.rejects(run(await sign(claims({amr}))),/idp_claims_invalid/);
 for(const verified of [false,'true',undefined])await assert.rejects(run(await sign(),transport({userinfo:{sub:'100000000000000001',email:'x@example.test',email_verified:verified}})),/idp_userinfo_invalid/);
});
test('UserInfo must refer to the identical signed subject even when email matches',async()=>{
 await assert.rejects(run(await sign(),transport({userinfo:{sub:'different-person',email:'synthetic@example.test',email_verified:true}})),/idp_userinfo_invalid/);
});
test('duplicate JSON claims and nested duplicate fields are denied',async()=>{
 for(const body of ['{"iss":"wrong","iss":"'+ZITADEL_STAGING.issuer+'"}',JSON.stringify(claims()).slice(0,-1)+',"extra":{"x":1,"x":2}}'])
  await assert.rejects(run(await sign(body)),/idp_json_invalid/);
});
test('malformed and noncanonical base64, oversized tokens and malformed payloads are denied',async()=>{
 for(const token of ['x.y.z','..','a.b.c.extra','a='.repeat(20000),encode('[]')+'.x.z'])await assert.rejects(run(token),/idp_(token|header|json)_invalid/);
 const token=await sign();await assert.rejects(run(token+'='),/idp_token_invalid/);
});
test('optional at_hash is bound to the exact access token',async()=>{
 const at_hash=createHash('sha256').update(access).digest().subarray(0,16).toString('base64url');
 assert.equal((await run(await sign(claims({at_hash})))).email_verified,true);
 await assert.rejects(run(await sign(claims({at_hash:'X'.repeat(22)}))),/idp_claims_invalid/);
});
test('provider HTTP failures and malformed responses never qualify identity',async()=>{
 await assert.rejects(run(await sign(),transport({keyStatus:503})),/idp_provider_unavailable/);
 await assert.rejects(run(await sign(),transport({userStatus:401})),/idp_provider_unavailable/);
 const t={fetcher:async()=>new Response('{invalid')};await assert.rejects(run(await sign(),t),/idp_json_invalid/);
});
test('provider redirects are denied without a second destination or browser cookies',async()=>{
 const calls=[];
 const fetcher=async request=>{calls.push(request);assert.equal(request.redirect,'manual');assert.equal(request.headers.has('cookie'),false);
  return new Response(null,{status:302,headers:{location:'https://untrusted.invalid/provider'}});};
 await assert.rejects(verifyZitadelCodeTokens({id_token:await sign(),access_token:access,expected_nonce:nonce},{fetcher,clock:()=>now}),/idp_provider_unavailable/);
 assert.equal(calls.length,1);assert.equal(calls[0].url,ZITADEL_STAGING.jwks_uri);
});
test('provider response size is bounded and streams are cancelled',async()=>{
 let cancelled=false;
 const t={fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(70000));},cancel(){cancelled=true;}}))};
 await assert.rejects(run(await sign(),t),/idp_provider_response_invalid/);assert.equal(cancelled,true);
});
test('expiry and authentication age are rechecked after UserInfo completes',async()=>{
 for(const patch of [{exp:now/1000+1},{auth_time:now/1000-300}]){
  let current=now;const t=transport();
  const fetcher=async r=>{const result=await t.fetcher(r);if(r.url===ZITADEL_STAGING.userinfo_endpoint)current=now+1300;return result;};
  await assert.rejects(verifyZitadelCodeTokens({id_token:await sign(claims(patch)),access_token:access,expected_nonce:nonce},{fetcher,clock:()=>current}),/idp_claims_invalid/);
 }
});
test('2047-bit RSA key is rejected despite having a 256-byte modulus',async()=>{
 const weak=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2047,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const weakPublic={...await webcrypto.subtle.exportKey('jwk',weak.publicKey),kid:publicKey.kid,use:'sig',alg:'RS256'};
 assert.equal(Buffer.from(weakPublic.n,'base64url').length,256);
 await assert.rejects(run(await sign(claims(),{alg:'RS256',kid:publicKey.kid},weak.privateKey),transport({jwks:{keys:[weakPublic]}})),/idp_key_invalid/);
});
test('a clock moving backward between provider checks fails closed',async()=>{
 const times=[now,now+100,now+50],t=transport();
 await assert.rejects(verifyZitadelCodeTokens({id_token:await sign(),access_token:access,expected_nonce:nonce},{fetcher:t.fetcher,clock:()=>times.shift()}),/idp_context_invalid/);
});
