/** Explicit local workerd integration probe. Fresh fixture Access/OIDC keys,
 * isolated SQLite DO and an outbound stub: no live identity/provider traffic. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
const modulePath=process.env.MMF_MINIFLARE_MODULE;
if(!modulePath)throw Error('MMF_LOCAL_MINIFLARE_REQUIRED');
const runtime=await import(pathToFileURL(modulePath).href),{Miniflare}=runtime;
const TestResponse=runtime.Response??Response;
const root=resolve('.'),origin='https://mail-stage.mftintelligence.com';
const material=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=material.publicKey.export({format:'jwk'});
const keyId='fixture-workerd-key',clientId='fixture-workerd-client',email='fixture-workerd-admin@example.com';
const audience='fixture-workerd-access-audience';
const issuer='https://musitu-axiom.cloudflareaccess.com/cdn-cgi/access/sso/oidc/'+clientId;
const config={clientId,issuer,tokenEndpoint:issuer+'/token',redirectUri:origin+'/private/oidc/callback',keyId,
 publicJwk:jwk,spkiFingerprint:createHash('sha256').update(material.publicKey.export({format:'der',type:'spki'})).digest('hex'),validUntil:Date.now()+3600000};
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const token=claims=>{const input=encode({alg:'RS256',typ:'JWT',kid:keyId})+'.'+encode(claims);
 return input+'.'+sign('RSA-SHA256',Buffer.from(input),material.privateKey).toString('base64url')};
const at=Math.floor(Date.now()/1000);
const assertion=token({iss:'https://musitu-axiom.cloudflareaccess.com',aud:[audience],email,iat:at,exp:at+600});
const bindings={MMF_ACCESS_AUD:audience,MMF_APPROVED_ADMIN_SHA256:createHash('sha256').update(email).digest('hex'),
 MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
const names=['src/edge/mmf-oidc-qualification-cloudflare.mjs','src/edge/mmf-access-stage-gateway.mjs',
 'src/staging/mmf-oidc-qualification-flow.mjs','src/staging/mmf-cloudflare-pkce-qualification.mjs',
 'src/commercial/mmf-oidc-private-token-exchange.mjs','src/commercial/mmf-oidc-admission.mjs','src/commercial/mmf-db-transaction.mjs'];
const modules=names.map(path=>{
 let contents=readFileSync(path,'utf8');
 if(path===names[0])contents=contents.replace('const PINNED_QUALIFICATION_CONFIG=null;','const PINNED_QUALIFICATION_CONFIG='+JSON.stringify(config)+';');
 if(path===names[1])contents=contents.replace('const PINNED_ACCESS_CERTS={keys:[],validUntil:0};',
  'const PINNED_ACCESS_CERTS='+JSON.stringify({keys:[{...jwk,kid:keyId}],validUntil:Date.now()+3600000})+';');
 return {type:'ESModule',path:resolve(root,path),contents};
});
// Miniflare's Node HTTP transport replaces Host with its local socket and
// sec-fetch-mode with cors. This local-only bridge supplies the browser context
// under test before invoking the unchanged real entrypoint. Never deployed.
modules.unshift({type:'ESModule',path:resolve(root,'fixture-transport-entry.mjs'),contents:`
 import app from './src/edge/mmf-oidc-qualification-cloudflare.mjs';
 export {MmfOidcQualificationDO} from './src/edge/mmf-oidc-qualification-cloudflare.mjs';
 export default {fetch(req,env){const headers=new Headers(req.headers);
  headers.set('host','mail-stage.mftintelligence.com');
  const mode=headers.get('x-mmf-fixture-mode');headers.delete('x-mmf-fixture-mode');
  if(mode)headers.set('sec-fetch-mode',mode);
  return app.fetch(new Request(req,{headers}),env);
 }};`});
let auth,requests=0;
const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-10-17',compatibilityFlags:['nodejs_compat'],bindings,
 durableObjects:{MMF_OIDC_QUALIFICATION:{className:'MmfOidcQualificationDO',useSQLite:true}},
 outboundService:async req=>{
  requests++;assert.equal(req.url,config.tokenEndpoint);assert.ok(auth);
  const body=new URLSearchParams(await req.text());
  const challenge=createHash('sha256').update(body.get('code_verifier')).digest('base64url');
  const valid=challenge===auth.searchParams.get('code_challenge');
  const result=valid?{id_token:token({iss:issuer,aud:clientId,sub:'fixture-workerd-admin',nonce:auth.searchParams.get('nonce'),
   amr:['pwd','otp'],auth_time:at,iat:at,exp:at+300})}:{error:'invalid_grant'};
  return new TestResponse(JSON.stringify(result),{status:valid?200:400,headers:{'content-type':'application/json'}});
 }});
const headers={'cf-access-jwt-assertion':assertion,'sec-fetch-site':'same-origin','sec-fetch-mode':'navigate','sec-fetch-dest':'document','x-mmf-fixture-mode':'navigate'};
const dispatch=(url,options={})=>mf.dispatchFetch(url,{...options,redirect:'manual'});
try{
 for(const path of ['/private/dashboard','/private/oidc','/private/oidc/qualify','/private/oidc/qualification'])
  assert.equal((await dispatch(origin+path)).status,403);
 const landing=await dispatch(origin+'/private/oidc',{headers:{...headers,'sec-fetch-site':'cross-site'}});
 if(landing.status!==200){
  const gate=await dispatch(origin+'/private/gateway',{headers});
  throw Error('MMF_WORKERD_LANDING_FAILED_'+landing.status+'_'+await landing.text()+'_GATE_'+await gate.text());
 }
 assert.match(await landing.text(),/Continue to secure sign-in/);assert.equal(requests,0);
 const crossSite=await dispatch(origin+'/private/oidc/qualify',{headers:{...headers,'sec-fetch-site':'cross-site'}});
 assert.equal(crossSite.status,403);assert.equal((await crossSite.json()).supportCode,'REQUEST_CONTEXT');
 const status=await dispatch(origin+'/private/oidc/qualification',{headers});
 assert.equal(status.status,200);assert.equal((await status.json()).attempted,false);
 const begin=await dispatch(origin+'/private/oidc/qualify',{headers});
 const beginStatus=begin.status;
 if(beginStatus!==303)throw Error('MMF_WORKERD_BEGIN_FAILED_'+beginStatus+'_'+JSON.stringify(await begin.json()));
 auth=new URL(begin.headers.get('location'));assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 const cookie=begin.headers.get('set-cookie').split(';')[0];
 const url=origin+'/private/oidc/callback?state='+auth.searchParams.get('state')+'&code=fixture-workerd-code';
 const callback=await dispatch(url,{headers:{...headers,cookie,'sec-fetch-site':'cross-site'}});
 assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),origin+'/private/oidc/qualification');
 const result=await (await dispatch(origin+'/private/oidc/qualification',{headers})).json();
 if(result.status!=='QUALIFICATION_PASSED')throw Error('MMF_WORKERD_FIXTURE_TOKEN_CHECK_FAILED_'+JSON.stringify({result,stubRequests:requests}));
 assert.equal(result.pkceAndSignedMfaVerified,true);assert.equal(result.sessionCreated,false);
 assert.equal(requests,3);
 assert.equal((await dispatch(url,{headers:{...headers,cookie,'sec-fetch-site':'cross-site'}})).status,403);assert.equal(requests,3);
 const proof={schema:'mmf-local-workerd-qualification-probe-v1',result:'PASS',fixtureKeysOnly:true,realIdentityProviderContacted:false,
  anonymousDenied:true,authenticatedCrossSiteLanding:true,crossSiteInitiationDenied:true,sqliteStateAndRpc:true,
  fixtureS256AndSignedMfa:true,replayDenied:true,applicationSessionCreated:false,tokenRequestsToLocalStub:requests};
 console.log(JSON.stringify(proof));
 if(process.env.RUNNER_TEMP)writeFileSync(join(process.env.RUNNER_TEMP,'mmf-local-workerd-qualification-proof.json'),JSON.stringify(proof,null,2)+'\n');
}finally{await mf.dispose()}
