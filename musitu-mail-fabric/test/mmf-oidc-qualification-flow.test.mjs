import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {MmfOidcQualificationFlow,routeMmfOidcQualification} from '../src/staging/mmf-oidc-qualification-flow.mjs';
import {createMmfStageGate} from '../src/edge/mmf-access-stage-gateway.mjs';
const origin='https://mail-stage.mftintelligence.com';
const key=generateKeyPairSync('rsa',{modulusLength:2048}),publicJwk=key.publicKey.export({format:'jwk'});
const initial=Date.UTC(2026,9,17,10),clientId='fixture-qualification-client';
const issuer='https://musitu-axiom.cloudflareaccess.com/cdn-cgi/access/sso/oidc/'+clientId;
const config={clientId,issuer,tokenEndpoint:issuer+'/token',redirectUri:origin+'/private/oidc/callback',keyId:'fixture-key',publicJwk,
 spkiFingerprint:createHash('sha256').update(key.publicKey.export({format:'der',type:'spki'})).digest('hex'),validUntil:initial+86400000};
const env={MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const jwt=(nonce,at,override={})=>{
 const part=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const input=part({alg:'RS256',typ:'JWT',kid:config.keyId})+'.'+part({iss:issuer,aud:clientId,sub:'fixture-admin',
  nonce,amr:['pwd','otp'],auth_time:at/1000,iat:at/1000,exp:at/1000+120,...override});
 return input+'.'+sign('RSA-SHA256',Buffer.from(input),key.privateKey).toString('base64url');
};
// A transactional clone-at-boundary store models hibernation and concurrent
// callbacks; no test relies on process-local Map references for consumption.
function storage(){
 const entries=new Map();let queue=Promise.resolve(),alarm=null;
 const api={async get(k){return structuredClone(entries.get(k))},async put(k,v){entries.set(k,structuredClone(v))},
  async delete(k){return entries.delete(k)},async getAlarm(){return alarm},async setAlarm(v){alarm=v},
  transaction(fn){const p=queue.then(async()=>{const before=structuredClone(entries);try{return await fn(api)}catch(e){entries.clear();for(const [k,v]of before)entries.set(k,v);throw e}});queue=p.catch(()=>{});return p;}};
 return api;
}
async function setup({override,fetchImpl,positiveExchangeOnly=false}={}){
 const db=storage();let at=initial,calls=0,auth;
 const provider=fetchImpl||(async(url,options)=>{
  calls++;assert.equal(url,config.tokenEndpoint);
  const verifier=new URLSearchParams(options.body).get('code_verifier');
  if(createHash('sha256').update(verifier).digest('base64url')!==auth.searchParams.get('code_challenge'))return json({error:'invalid_grant'},400);
  return json({id_token:jwt(auth.searchParams.get('nonce'),at,override)});
 });
 const options={now:()=>at,fetchImpl:provider,positiveExchangeOnly};
 const flow=new MmfOidcQualificationFlow(db,config,env,options);
 const begin=await flow.begin();auth=new URL(begin.authorizationUrl);
 const input={state:auth.searchParams.get('state'),code:'fixture-code-2026',cookieHeader:begin.setCookie.split(';')[0],signal:AbortSignal.timeout(3000)};
 return {flow,db,auth,begin,input,options,calls:()=>calls,advance:n=>at+=n};
}
test('server state survives reconstruction; real crypto fixtures yield only sanitized proof and no app session',async()=>{
 const s=await setup();
 assert.equal(s.auth.searchParams.get('code_challenge_method'),'S256');assert.equal(s.auth.searchParams.get('scope'),'openid');
 assert.equal(s.auth.searchParams.get('prompt'),'login');assert.equal(s.auth.searchParams.get('max_age'),'0');
 assert.match(s.begin.setCookie,/Secure; HttpOnly; SameSite=Lax/);
 assert.equal(s.auth.searchParams.has('code_verifier'),false);
 const restored=new MmfOidcQualificationFlow(s.db,config,env,s.options);
 const response=await restored.callback(s.input);assert.match(response.setCookie,/Max-Age=0/);
 const proof=await restored.status();assert.equal(proof.status,'QUALIFICATION_PASSED');assert.equal(s.calls(),3);
 assert.equal(proof.pkceAndSignedMfaVerified,true);assert.equal(proof.applicationLoginEnabled,false);assert.equal(proof.sessionCreated,false);
 const persisted=JSON.stringify(await s.db.get('qualification')),visible=JSON.stringify(proof);
 for(const secret of [s.input.state,s.input.code,s.auth.searchParams.get('nonce'),'fixture-admin']){
  assert.ok(!persisted.includes(secret));assert.ok(!visible.includes(secret));
 }
 await assert.rejects(()=>restored.callback(s.input));assert.equal(s.calls(),3);
});
test('wrong, absent and duplicated state cookies, wrong state and expired flow never contact token endpoint',async()=>{
 const s=await setup();
 for(const input of [{...s.input,state:'A'.repeat(43)},{...s.input,cookieHeader:''},
  {...s.input,cookieHeader:s.input.cookieHeader+'; '+s.input.cookieHeader},
  {...s.input,code:'bad'}])await assert.rejects(()=>s.flow.callback(input));
 s.advance(300001);await assert.rejects(()=>s.flow.callback(s.input));assert.equal(s.calls(),0);
 await s.flow.purge();assert.equal(Object.keys((await s.db.get('qualification')).pending).length,0);
});
test('racing callbacks across reconstructed instances can consume a code only once',async()=>{
 const s=await setup(),other=new MmfOidcQualificationFlow(s.db,config,env,s.options);
 const outcomes=await Promise.allSettled([s.flow.callback(s.input),other.callback(s.input)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(s.calls(),3);
});
test('failed token/MFA proof consumes the flow and returns a sanitized fail-closed result',async()=>{
 for(const options of [{override:{amr:['pwd']}},{fetchImpl:async()=>{throw Error('fixture-private-failure')}}]){
  const s=await setup(options);await s.flow.callback(s.input);const proof=await s.flow.status();
  assert.equal(proof.status,'QUALIFICATION_FAILED_CLOSED');assert.equal(proof.pkceAndSignedMfaVerified,false);
  assert.ok(!JSON.stringify(proof).includes('fixture-private-failure'));
  await assert.rejects(()=>s.flow.callback(s.input));
  assert.equal(Object.keys((await s.db.get('qualification')).pending).length,0);
 }
});
test('initiation and durable ledger are bounded; alarm removes the expired harness ledger',async()=>{
 const s=await setup();await assert.rejects(()=>s.flow.begin());
 for(let i=1;i<16;i++){s.advance(300001);await s.flow.begin()}
 s.advance(300001);await assert.rejects(()=>s.flow.begin());
 s.advance(86400000);await s.flow.purge();assert.equal(await s.db.get('qualification'),undefined);
 await assert.rejects(()=>s.flow.begin());assert.throws(()=>new MmfOidcQualificationFlow(s.db,config,env,s.options));
});
test('reusing a code in a different valid state cannot trigger another exchange',async()=>{
 const s=await setup();await s.flow.callback(s.input);s.advance(60001);
 const begin=await s.flow.begin(),auth=new URL(begin.authorizationUrl);
 await assert.rejects(()=>s.flow.callback({...s.input,state:auth.searchParams.get('state'),cookieHeader:begin.setCookie.split(';')[0]}));
 assert.equal(s.calls(),3);
});
const request=(path,headers={},method='GET')=>new Request(origin+path,{method,headers});
test('HTTP boundary rejects cross-site initiation, methods, duplicate/extra query, forwarding and prefetch before authorization or storage',async()=>{
 let authorization=0,storageCalls=0;
 const options={authorize:async()=>{authorization++;return true},getFlow:()=>{storageCalls++;throw Error('unexpected')}};
 const callback='/private/oidc/callback?state='+('A'.repeat(43))+'&code=fixture-code';
 for(const req of [request('/private/oidc/qualify',{'sec-fetch-site':'cross-site'}),request('/private/oidc/qualify',{},'POST'),
  request('/private/oidc/qualify?extra=1'),request(callback+'&state='+('A'.repeat(43))),request(callback+'&extra=1'),
  request(callback,{'x-forwarded-host':'attacker.example'}),request(callback,{'sec-fetch-mode':'cors'}),
  request('/private/oidc/qualify',{'sec-purpose':'prefetch'}),new Request('https://attacker.example/private/oidc/qualify')]){
  assert.equal((await routeMmfOidcQualification(req,options)).status,403);
 }
 assert.equal(authorization,0);assert.equal(storageCalls,0);
 assert.equal(await routeMmfOidcQualification(request('/private/dashboard'),options),null);
});
test('real Access signature and administrator check precede flow state access; unsigned and non-admin never reach the harness',async()=>{
 const at=Math.floor(Date.now()/1000),email='fixture-admin@example.com',audience='fixture-access-audience-2026';
 const signed=emailValue=>{
  const part=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const input=part({alg:'RS256',kid:'fixture-key'})+'.'+part({iss:'https://musitu-axiom.cloudflareaccess.com',aud:[audience],email:emailValue,iat:at,exp:at+120});
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),key.privateKey).toString('base64url');
 };
 const gate=createMmfStageGate({...env,MMF_ACCESS_AUD:audience,MMF_APPROVED_ADMIN_SHA256:createHash('sha256').update(email).digest('hex'),
  MMF_PINNED_ACCESS_CERTS:{keys:[{...publicJwk,kid:'fixture-key'}],validUntil:Date.now()+60000}});
 let states=0;
 const options={authorize:async req=>(await gate.fetch(new Request(origin+'/private/gateway',{headers:req.headers}))).status===200,
  getFlow:()=>{states++;return {status:async()=>({applicationLoginEnabled:false})}}};
 for(const token of ['', 'invalid',signed('wrong@example.com')]){
  assert.equal((await routeMmfOidcQualification(request('/private/oidc/qualification',{'cf-access-jwt-assertion':token,'sec-fetch-site':'cross-site'}),options)).status,403);
 }
 assert.equal(states,0);
 const good=await routeMmfOidcQualification(request('/private/oidc/qualification',{'cf-access-jwt-assertion':signed(email),'sec-fetch-site':'cross-site'}),options);
 assert.equal(good.status,200);assert.equal(states,1);assert.equal(good.headers.get('cache-control'),'no-store');
});
test('cross-site redirect result navigation reads status only behind the administrator gate',async()=>{
 let authorized=false,reads=0;
 const options={authorize:async()=>authorized,getFlow:()=>({
  status:async()=>{reads++;return {attempted:false,applicationLoginEnabled:false}},
  begin:()=>{throw Error('must-not-create-state')},callback:()=>{throw Error('must-not-exchange-code')}
 })};
 const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
 const path='/private/oidc/qualification';
 assert.equal((await routeMmfOidcQualification(request(path,headers),options)).status,403);assert.equal(reads,0);
 authorized=true;
 const response=await routeMmfOidcQualification(request(path,headers),options);
 assert.equal(response.status,200);assert.equal((await response.json()).attempted,false);assert.equal(reads,1);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.has('set-cookie'),false);
 for(const rejected of [request('/private/oidc/qualify',headers),request(path,{...headers,'sec-fetch-mode':'cors'}),
  request(path,{...headers,'sec-fetch-dest':'iframe'}),request(path+'?extra=1',headers)])
  assert.equal((await routeMmfOidcQualification(rejected,options)).status,403);
 assert.equal(reads,1);
});
test('HTTP callback removes sensitive query via redirect and never echoes code, state, cookies or provider tokens',async()=>{
 const s=await setup();
 const options={authorize:async()=>true,getFlow:()=>s.flow};
 const req=request('/private/oidc/callback?state='+s.input.state+'&code='+s.input.code,{cookie:s.input.cookieHeader,'sec-fetch-site':'cross-site'});
 const response=await routeMmfOidcQualification(req,options);
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),origin+'/private/oidc/qualification');
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal(await response.text(),'');
});
test('cross-site phone launch can render only an authenticated passive landing page; sign-in still requires same-origin initiation',async()=>{
 let starts=0,access=false;
 const options={authorize:async()=>access,getFlow:()=>{starts++;throw Error('fixture-state-must-not-be-created')}};
 const phone=request('/private/oidc',{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'});
 const denied=await routeMmfOidcQualification(phone,options);assert.equal(denied.status,403);
 assert.equal((await denied.json()).supportCode,'ACCESS_GATE');assert.equal(starts,0);
 access=true;
 const response=await routeMmfOidcQualification(phone,options);assert.equal(response.status,200);
 const html=await response.text();assert.match(html,/href="\/private\/oidc\/qualify"/);
 assert.doesNotMatch(html,/<(?:script|form|iframe)|code_verifier|fixture-state/);
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.has('set-cookie'),false);assert.equal(starts,0);
 const rejected=await routeMmfOidcQualification(request('/private/oidc/qualify',{'sec-fetch-site':'cross-site'}),options);
 assert.equal(rejected.status,403);assert.equal((await rejected.json()).supportCode,'REQUEST_CONTEXT');assert.equal(starts,0);
});
test('safe denial support codes identify the failed boundary without exposing errors or secrets',async()=>{
 for(const [options,expected] of [
  [{authorize:async()=>false,getFlow:()=>null},'ACCESS_GATE'],
  [{authorize:async()=>true,getFlow:()=>{throw Error('fixture-secret')}},'FLOW_UNAVAILABLE'],
  [{authorize:async()=>true,getFlow:()=>({begin:()=>{throw Error('fixture-secret')}})},'FLOW_OPERATION']]){
  const response=await routeMmfOidcQualification(request('/private/oidc/qualify'),options);
  const body=await response.json();assert.equal(response.status,403);assert.equal(body.supportCode,expected);
  assert.equal(body.applicationLoginEnabled,false);assert.ok(!JSON.stringify(body).includes('fixture-secret'));
 }
});
test('provider fetch is called without a class receiver, as required by Worker-native fetch',async()=>{
 const receivers=[];
 const s=await setup({fetchImpl:async function(){receivers.push(this);return json({error:'invalid_grant'},400)}});
 await s.flow.callback(s.input);
 assert.equal(receivers.length,3);
 assert.ok(receivers.every(receiver=>receiver===undefined));
});
test('Worker-compatible manual transport rejects redirects without following or retrying',async()=>{
 const calls=[];
 const s=await setup({fetchImpl:async(url,options)=>{
  calls.push({url,redirect:options.redirect});
  return new Response(null,{status:302,headers:{location:'https://untrusted.example/token'}});
 }});
 await s.flow.callback(s.input);
 assert.deepEqual(calls,[{url:config.tokenEndpoint,redirect:'manual'}]);
 const proof=await s.flow.status();assert.equal(proof.status,'QUALIFICATION_FAILED_CLOSED');assert.equal(proof.tokenRequests,1);
 await assert.rejects(()=>s.flow.callback(s.input));assert.equal(calls.length,1);
});
test('context diagnostics identify only the rejected rule, preserving denial and never echoing callback values',async()=>{
 let calls=0;
 const options={authorize:async()=>{calls++;return true},getFlow:()=>{calls++;throw Error('must-not-reach-state')}};
 const state='A'.repeat(43),base='/private/oidc/callback?state='+state;
 const cases=[
  [request('/private/oidc',{},'POST'),'REQUEST_METHOD'],
  [new Request('https://untrusted.example/private/oidc'),'REQUEST_URL'],
  [request(base+'&code='+('x'.repeat(3000))),'REQUEST_URL_LENGTH'],
  [request('/private/oidc',{forwarded:'host=untrusted.example'}),'FORWARDING_HEADER'],
  [request('/private/oidc',{range:'bytes=0-10'}),'RANGE_REQUEST'],
  [request('/private/oidc',{'sec-purpose':'prefetch'}),'PREFETCH_REQUEST'],
  [request('/private/oidc',{host:'untrusted.example'}),'REQUEST_HOST'],
  [request('/private/oidc',{'sec-fetch-mode':'cors'}),'FETCH_MODE'],
  [request('/private/oidc',{'sec-fetch-dest':'iframe'}),'FETCH_DESTINATION'],
  [request(base+'&error=access_denied&error_description=fixture-sensitive-detail'),'CALLBACK_PROVIDER_ERROR'],
  [request(base+'&code=fixture-code&code=fixture-other'),'CALLBACK_DUPLICATE_PARAMETER'],
  [request(base+'&code=fixture-code&iss=https%3A%2F%2Ffixture-issuer.example'),'CALLBACK_UNEXPECTED_PARAMETER'],
  [request(base),'CALLBACK_MISSING_PARAMETER'],
  [request('/private/oidc/callback?state=bad-state&code=fixture-code'),'CALLBACK_STATE_FORMAT'],
  [request(base+'&code=short'),'CALLBACK_CODE_LENGTH'],
  [request(base+'&code=fixture%2Bcode'),'CALLBACK_CODE_FORMAT'],
  [request('/private/oidc?extra=fixture-private'),'UNEXPECTED_QUERY'],
  [request('/private/oidc/qualify',{'sec-fetch-site':'cross-site'}),'CROSS_SITE_INITIATION']
 ];
 for(const [req,reason] of cases){
  const response=await routeMmfOidcQualification(req,options),body=await response.json();
  assert.equal(response.status,403);assert.deepEqual(body,{error:'MMF_PRIVATE_QUALIFICATION_DENIED',supportCode:'REQUEST_CONTEXT',requestReason:reason,applicationLoginEnabled:false});
  const encoded=JSON.stringify(body);for(const secret of [state,'fixture-code','fixture-sensitive-detail','fixture-issuer.example','fixture-private'])assert.ok(!encoded.includes(secret));
 }
 assert.equal(calls,0,'every failed request rule precedes Access authorization and durable state access');
});

test('persisted token failure diagnostics contain only bounded enums/status and do not retry consumed state',async()=>{
 const cases=[
  [async()=>{throw Object.assign(Error('fixture-secret'),{qualificationDiagnostic:{stage:'forged-private',reason:'fixture-secret'}})},'TOKEN_REQUEST_FAILED','FETCH_REJECTED',null,undefined],
  [async()=>json({error:'invalid_client',error_description:'fixture-secret'},400),'NEGATIVE_OAUTH_ERROR','RESPONSE_RECEIVED',400,'invalid_client'],
  [async()=>json({error:'invalid_grant'},401),'NEGATIVE_HTTP_STATUS','RESPONSE_RECEIVED',401,undefined],
  [async()=>new Response(null,{status:302,headers:{location:'https://fixture-secret.example'}}),'TOKEN_REQUEST_FAILED','REDIRECT_BLOCKED',302,undefined]
 ];
 for(const [fetchImpl,reason,transport,httpStatus,oauthError] of cases){
  let requests=0;const s=await setup({fetchImpl:async(...args)=>{requests++;return fetchImpl(...args)}});
  await s.flow.callback(s.input);const result=await s.flow.status();
  assert.equal(result.status,'QUALIFICATION_FAILED_CLOSED');assert.equal(result.diagnosticsVersion,3);
  assert.equal(result.failureStage,'NEGATIVE_WRONG_VERIFIER');assert.equal(result.failureReason,reason);
  assert.equal(result.tokenTransport,transport);assert.equal(result.lastTokenHttpStatus,httpStatus);assert.equal(result.oauthError,oauthError);
  assert.equal(result.tokenRequests,1);assert.equal(result.applicationLoginEnabled,false);assert.equal(result.sessionCreated,false);
  assert.ok(!JSON.stringify(await s.db.get('qualification')).includes('fixture-secret'));
  await assert.rejects(()=>s.flow.callback(s.input));assert.equal(requests,1);
 }
});

const providerNegativeRedirect=(location=origin+'/private/oidc/callback?error=invalid_grant&error_description=fixture-private-description',status=302,body=null)=>new Response(body,{status,headers:{location}});
test('pinned Cloudflare negative-error redirects qualify without following them or retaining descriptions',async()=>{
 let auth,calls=0;
 const s=await setup({fetchImpl:async(url,options)=>{
  calls++;assert.equal(options.redirect,'manual');assert.equal(url,config.tokenEndpoint);
  if(calls<=2)return providerNegativeRedirect();
  return json({id_token:jwt(auth.searchParams.get('nonce'),initial)});
 }});auth=s.auth;
 await s.flow.callback(s.input);const result=await s.flow.status();
 assert.equal(result.status,'QUALIFICATION_PASSED');assert.equal(result.pkceAndSignedMfaVerified,true);
 assert.equal(result.negativeRedirectResponses,2);assert.equal(result.diagnosticsVersion,3);assert.equal(calls,3);
 assert.equal(result.applicationLoginEnabled,false);assert.equal(result.sessionCreated,false);
 assert.ok(!JSON.stringify(await s.db.get('qualification')).includes('fixture-private-description'));
 await assert.rejects(()=>s.flow.callback(s.input));assert.equal(calls,3);
});
test('negative redirect adaptation rejects all unpinned, malformed, ambiguous or successful-token shapes',async()=>{
 const base=origin+'/private/oidc/callback?error=invalid_grant&error_description=fixture-private-description';
 const cases=[
  ()=>providerNegativeRedirect(base.replace(origin,'https://untrusted.example')),
  ()=>providerNegativeRedirect(base.replace('/callback?','/qualification?')),
  ()=>providerNegativeRedirect(base.replace('https://','http://')),
  ()=>providerNegativeRedirect(base.replace('https://','https://user@')),
  ()=>providerNegativeRedirect(base+'#fragment'),()=>providerNegativeRedirect(base+'&error=invalid_grant'),
  ()=>providerNegativeRedirect(base+'&state='+('A'.repeat(43))),()=>providerNegativeRedirect(base+'&id_token=fixture-token'),
  ()=>providerNegativeRedirect(base.replace('invalid_grant','invalid_client')),
  ()=>providerNegativeRedirect(base.replace('invalid_grant','unsupported_grant_type')),
  ()=>providerNegativeRedirect(base.replace('fixture-private-description','x'.repeat(513))),
  ()=>providerNegativeRedirect(base.replace('fixture-private-description','%0Aprivate')),
  ()=>providerNegativeRedirect(base,303),()=>providerNegativeRedirect(base,307),
  ()=>providerNegativeRedirect(base,302,'fixture-private-body-token')
 ];
 for(const response of cases){let calls=0;const s=await setup({fetchImpl:async()=>{calls++;return response()}});
  await s.flow.callback(s.input);const result=await s.flow.status();
  assert.equal(result.status,'QUALIFICATION_FAILED_CLOSED');assert.equal(result.tokenTransport,'REDIRECT_BLOCKED');
  assert.equal(result.negativeRedirectResponses,0);assert.equal(calls,1);assert.equal(result.sessionCreated,false);
  assert.ok(!JSON.stringify(await s.db.get('qualification')).includes('fixture-private'));
 }
});
test('the correct-verifier exchange still rejects even an exactly pinned invalid_grant redirect',async()=>{
 let calls=0;const s=await setup({fetchImpl:async()=>{calls++;return providerNegativeRedirect()}});
 await s.flow.callback(s.input);const result=await s.flow.status();
 assert.equal(result.status,'QUALIFICATION_FAILED_CLOSED');assert.equal(result.failureStage,'CORRECT_VERIFIER_EXCHANGE');
 assert.equal(result.tokenTransport,'REDIRECT_BLOCKED');assert.equal(result.lastTokenHttpStatus,302);
 assert.equal(result.negativeRedirectResponses,2);assert.equal(calls,3);assert.equal(result.successfulTokenResponses,0);
 await assert.rejects(()=>s.flow.callback(s.input));assert.equal(calls,3);
});

test('normal positive exchange never spends a login code on deliberately wrong verifier probes',async()=>{
 let auth,requests=0,spent=false;
 const s=await setup({positiveExchangeOnly:true,fetchImpl:async(url,options)=>{
  requests++;const verifier=new URLSearchParams(options.body).get('code_verifier');
  const correct=createHash('sha256').update(verifier).digest('base64url')===auth.searchParams.get('code_challenge');
  if(spent||!correct){spent=true;return providerNegativeRedirect()}
  spent=true;return json({id_token:jwt(auth.searchParams.get('nonce'),initial)});
 }});auth=s.auth;
 await s.flow.callback(s.input);const result=await s.flow.status();
 assert.equal(requests,1);assert.equal(result.status,'POSITIVE_OIDC_VERIFIED');
 assert.equal(result.positivePkceAndSignedMfaVerified,true);assert.equal(result.negativePkceChecksQualified,false);
 assert.equal(result.pkceAndSignedMfaVerified,false);assert.equal(result.applicationLoginEnabled,false);assert.equal(result.sessionCreated,false);
 assert.equal(result.negativeRedirectResponses,0);assert.equal(result.qualificationMode,'positive-exchange');
 await assert.rejects(()=>s.flow.callback(s.input));assert.equal(requests,1);
});
test('normal positive exchange still blocks error redirects and never treats them as negative probe success',async()=>{
 let requests=0;const s=await setup({positiveExchangeOnly:true,fetchImpl:async()=>{requests++;return providerNegativeRedirect()}});
 await s.flow.callback(s.input);const result=await s.flow.status();
 assert.equal(requests,1);assert.equal(result.status,'QUALIFICATION_FAILED_CLOSED');
 assert.equal(result.failureStage,'CORRECT_VERIFIER_EXCHANGE');assert.equal(result.tokenTransport,'REDIRECT_BLOCKED');
 assert.equal(result.negativeRedirectResponses,0);assert.equal(result.positivePkceAndSignedMfaVerified,false);
 assert.equal(result.sessionCreated,false);await assert.rejects(()=>s.flow.callback(s.input));assert.equal(requests,1);
});
test('positive exchange preserves strict signed MFA and exposes only explicitly unverified claim-presence booleans',async()=>{
 const s=await setup({positiveExchangeOnly:true,override:{amr:undefined,auth_time:undefined}});
 await s.flow.callback(s.input);const result=await s.flow.status();
 assert.equal(s.calls(),1);assert.equal(result.successfulTokenResponses,1);assert.equal(result.status,'QUALIFICATION_FAILED_CLOSED');
 assert.equal(result.failureStage,'SIGNED_ID_TOKEN_VALIDATION');assert.equal(result.positivePkceAndSignedMfaVerified,false);
 assert.deepEqual(result.unverifiedClaimPresence,{amr:false,authTime:false,nonce:true});
 const saved=JSON.stringify(await s.db.get('qualification'));
 for(const privateValue of [s.input.code,s.input.state,s.auth.searchParams.get('nonce'),'fixture-admin'])assert.ok(!saved.includes(privateValue));
});
