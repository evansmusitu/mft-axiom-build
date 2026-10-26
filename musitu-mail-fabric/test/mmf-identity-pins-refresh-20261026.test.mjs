import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {moduleNames} from '../src/staging/mmf-dashboard-access-pin-refresh-20261025.mjs';
import {verifiedOidcPin,planIdentityPinsRefresh,refreshIdentityPins} from '../src/staging/mmf-identity-pins-refresh-20261026.mjs';

const directory=mkdtempSync(join(tmpdir(),'mmf-identity-pin-fixture-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=mmf-identity-fixture',
 '-days','2','-keyout',join(directory,'fixture.key'),'-out',join(directory,'fixture.crt')],{stdio:'ignore'});
const cert=readFileSync(join(directory,'fixture.crt'),'utf8');
const publicKey=new X509Certificate(cert).publicKey;
const jwk={...publicKey.export({format:'jwk'}),kid:'mmf-identity-fixture-20261026',alg:'RS256',use:'sig'};
const certs={keys:[jwk],public_certs:[{kid:jwk.kid,cert}]};
const jwks={keys:[jwk]};
const now=Date.now(),day=86400000;
const account='93f395f5121954671f92fffa453d6b61',worker='mmf-private-identity-edge-20261017';
const host='mail-stage.mftintelligence.com',team='musitu-axiom.cloudflareaccess.com';
const appId='f8ab12fe-251f-44fa-80de-1c2f2bdc4055',oidcId='4ae515a1-189d-41c2-8020-c99ea157b021';
const idp='ec04a8ab-9382-4df0-9589-d2c98618e6af';
const clientId='cf09992056460080b94aa85a4906ad386356e21cdb0d0d317218a21cc228785a';
const issuer='https://'+team+'/cdn-cgi/access/sso/oidc/'+clientId;
const redirectUri='https://'+host+'/private/oidc/callback';
const metadata={issuer,authorization_endpoint:issuer+'/authorization',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',
 response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256']};
const oidc={id:oidcId,type:'saas',mfa_config:{mfa_disabled:false,allowed_authenticators:['totp']},allowed_idps:[idp],
 saas_app:{auth_type:'oidc',client_id:clientId,redirect_uris:[redirectUri],grant_types:['authorization_code_with_pkce'],
  allow_pkce_without_client_secret:true,public_key:cert}};
const pinFingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const currentOidcPin={clientId,issuer,tokenEndpoint:issuer+'/token',redirectUri,keyId:jwk.kid,
 publicJwk:{kty:'RSA',n:jwk.n,e:jwk.e},spkiFingerprint:pinFingerprint,validUntil:now-day};
const currentAccessPin={keys:[jwk],validUntil:now+2*day};
const local=new Map(moduleNames.map(name=>[name,readFileSync(new URL('../'+name,import.meta.url),'utf8')]));
const source=()=>new Map([...local].map(([name,text])=>[name,text
 .replace('const PINNED_ACCESS_CERTS={keys:[],validUntil:0};',
  'const PINNED_ACCESS_CERTS=Object.freeze('+JSON.stringify(currentAccessPin)+');')
 .replace('const PINNED_QUALIFICATION_CONFIG=null;',
  'const PINNED_QUALIFICATION_CONFIG=Object.freeze('+JSON.stringify(currentOidcPin)+');')]));
const policy={name:'MMF sole administrator private staging only',decision:'allow',session_duration:'15m',
 include:[{email:{email:'evansmusitu5@gmail.com'}}],require:[{login_method:{id:idp}}],exclude:[]};
const mfa={mfa_config:{mfa_disabled:false,allowed_authenticators:['totp']},allowed_idps:[idp]};
const settings={compatibility_date:'2026-10-17',compatibility_flags:['nodejs_compat'],logpush:false,tail_consumers:[],
 bindings:[...Object.entries({MMF_ACCESS_AUD:'existing-fixture-audience',
 MMF_APPROVED_ADMIN_SHA256:createHash('sha256').update('evansmusitu5@gmail.com').digest('hex'),
 MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'}).map(([name,text])=>({name,type:'plain_text',text})),
 {name:'MMF_OIDC_QUALIFICATION',type:'durable_object_namespace',class_name:'MmfOidcQualificationDO',namespace_id:'a'.repeat(32)}]};
const snapshot=()=>structuredClone({zones:[{account:{id:account},status:'active'}],org:{auth_domain:team},
 app:{id:appId,type:'self_hosted',domain:host,aud:'existing-fixture-audience',...mfa},oidc,
 policies:[policy],oidcPolicies:[policy],settings,subdomain:{enabled:false,previews_enabled:false},
 domains:[{hostname:host,service:worker}]});

test('provider registration, discovery and exact public signing key produce one 24-hour OIDC pin',()=>{
 const pin=verifiedOidcPin({oidc,jwks,metadata,now});
 assert.equal(pin.validUntil,now+day);assert.equal(pin.clientId,clientId);assert.equal(pin.keyId,jwk.kid);
 assert.deepEqual(pin.publicJwk,{kty:'RSA',n:jwk.n,e:jwk.e});assert.equal(pin.spkiFingerprint,pinFingerprint);
});

test('OIDC pinning rejects key substitution, private material, endpoint drift and non-PKCE registration',()=>{
 assert.throws(()=>verifiedOidcPin({oidc,jwks:{keys:[{...jwk,n:'a'.repeat(jwk.n.length)}]},metadata,now}),/MMF_OIDC_PROVIDER_PIN_DRIFT/);
 assert.throws(()=>verifiedOidcPin({oidc,jwks:{keys:[{...jwk,d:'private'}]},metadata,now}),/MMF_OIDC_PROVIDER_PIN_DRIFT/);
 assert.throws(()=>verifiedOidcPin({oidc,jwks,metadata:{...metadata,token_endpoint:'https://invalid.example/token'},now}),/MMF_OIDC_PROVIDER_PIN_DRIFT/);
 assert.throws(()=>verifiedOidcPin({oidc:{...oidc,saas_app:{...oidc.saas_app,allow_pkce_without_client_secret:false}},jwks,metadata,now}),/MMF_OIDC_PROVIDER_PIN_DRIFT/);
});

test('planner changes only Access and OIDC public pin modules and preserves every other module',()=>{
 const remote=source(),plan=planIdentityPinsRefresh({remote,local,certs,oidc,jwks,metadata,now});
 assert.deepEqual(plan.summary.changedModules,[moduleNames[0],moduleNames[1]]);
 assert.equal(plan.summary.previousOidcExpiresAt,new Date(now-day).toISOString());
 assert.equal(plan.summary.oidcExpiresAt,new Date(now+day).toISOString());
 assert.equal(plan.summary.accessExpiresAt,new Date(now+7*day).toISOString());
 for(const name of moduleNames.slice(2))assert.equal(plan.desired.get(name),remote.get(name));
 assert.equal(remote.get(moduleNames[0]),source().get(moduleNames[0]),'planner must not mutate baseline');
});

test('planner refuses source drift, module drift and an unrecognized current OIDC pin',()=>{
 const changed=source();changed.set(moduleNames[3],changed.get(moduleNames[3])+'\n// drift\n');
 assert.throws(()=>planIdentityPinsRefresh({remote:changed,local,certs,oidc,jwks,metadata,now}),/MMF_EXACT_SEVEN_MODULE_BASELINE_DRIFT/);
 const missing=source();missing.delete(moduleNames[6]);
 assert.throws(()=>planIdentityPinsRefresh({remote:missing,local,certs,oidc,jwks,metadata,now}),/MMF_MODULE_SET_DRIFT/);
 const forged=source();forged.set(moduleNames[0],forged.get(moduleNames[0]).replace(pinFingerprint,'f'.repeat(64)));
 assert.throws(()=>planIdentityPinsRefresh({remote:forged,local,certs,oidc,jwks,metadata,now}),/MMF_CURRENT_OIDC_PIN_DRIFT/);
});

function fakeCloud({driftBefore=false,denyWrite=false,driftAfter=false}={}){
 let remote=source(),phase=0;const calls=[];
 const prefix='accounts/'+account+'/',access=prefix+'access/',target=prefix+'workers/scripts/'+worker;
 const paths={zones:'zones?name=mftintelligence.com&per_page=100',org:access+'organizations',app:access+'apps/'+appId,
  policies:access+'apps/'+appId+'/policies?per_page=100',oidc:access+'apps/'+oidcId,
  oidcPolicies:access+'apps/'+oidcId+'/policies?per_page=100',settings:target+'/settings',subdomain:target+'/subdomain',
  domains:prefix+'workers/domains?per_page=100'};
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method,authorization:options.headers?.authorization});
  assert.equal(options.redirect,'error');
  if(url==='https://'+team+'/cdn-cgi/access/certs')return Response.json(certs);
  if(url===issuer+'/jwks')return Response.json(jwks);
  if(url===issuer+'/.well-known/openid-configuration')return Response.json(metadata);
  assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/'));
  const path=url.slice('https://api.cloudflare.com/client/v4/'.length);
  assert.match(options.headers.authorization,/^Bearer fixture-/);
  if(path===paths.zones)phase++;
  if(options.method==='PUT'){
   assert.equal(path,target+'/content');assert.ok(options.body instanceof FormData);
   assert.deepEqual(JSON.parse(await options.body.get('metadata').text()),{main_module:moduleNames[0]});
   if(denyWrite)return new Response('',{status:403});
   remote=new Map();for(const [name,blob] of options.body)if(name!=='metadata')remote.set(name,await blob.text());
   return Response.json({success:true,result:{id:worker}});
  }
  assert.equal(options.method,'GET');
  if(path===target+'/content/v2'){
   const form=new FormData();for(const [name,text] of remote)form.set(name,new Blob([text]),name);
   return new Response(form);
  }
  const key=Object.keys(paths).find(name=>paths[name]===path);assert.ok(key,'approved management endpoint only');
  const value=snapshot();if(driftBefore&&phase===2)value.settings.logpush=true;if(driftAfter&&phase===3)value.settings.logpush=true;
  return Response.json({success:true,result:value[key]});
 };
 return {fetchImpl,calls};
}
const invoke=cloud=>refreshIdentityPins({token:'fixture-existing-token-not-a-secret',accountId:account,
 sourceSha:'f'.repeat(40),loadSource:name=>local.get(name),now,fetchImpl:cloud.fetchImpl});

test('guarded repair performs one content-only PUT and verifies exact source without application requests',async()=>{
 const cloud=fakeCloud(),proof=await invoke(cloud);
 assert.equal(proof.gate,'MMF_PRIVATE_IDENTITY_PINS_REFRESHED_HUMAN_ACCEPTANCE_PENDING');
 assert.equal(proof.cloudflareMutations,1);assert.equal(proof.settingsAndPoliciesUnchanged,true);
 assert.equal(proof.exactDeployedModulesVerified,true);assert.equal(proof.applicationLoginEnabled,false);
 assert.equal(proof.browserAcceptance,false);assert.equal(proof.realSending,false);assert.equal(proof.payments,false);
 assert.equal(cloud.calls.filter(call=>call.method==='PUT').length,1);
 assert.ok(cloud.calls.every(call=>new URL(call.url).hostname!==host));
 assert.ok(cloud.calls.filter(call=>!call.url.startsWith('https://api.cloudflare.com/')).every(call=>call.authorization===undefined));
 assert.doesNotMatch(JSON.stringify(proof),/fixture-existing-token|publicJwk|BEGIN CERTIFICATE|gmail/);
});

test('concurrent drift blocks the write while a rejected write is never retried',async()=>{
 const drift=fakeCloud({driftBefore:true}),before=await invoke(drift);
 assert.equal(before.gate,'MMF_IDENTITY_PIN_REFRESH_STOPPED_BEFORE_WRITE');assert.equal(before.cloudflareMutations,0);
 assert.equal(drift.calls.filter(call=>call.method==='PUT').length,0);
 const rejected=fakeCloud({denyWrite:true}),after=await invoke(rejected);
 assert.equal(after.gate,'MMF_IDENTITY_PIN_REFRESH_REVIEW_REQUIRED');assert.equal(after.cloudflareMutations,1);
 assert.equal(after.httpBlocker,403);assert.equal(rejected.calls.filter(call=>call.method==='PUT').length,1);
});

test('post-write configuration drift prevents a success claim',async()=>{
 const cloud=fakeCloud({driftAfter:true}),proof=await invoke(cloud);
 assert.equal(proof.gate,'MMF_IDENTITY_PIN_REFRESH_REVIEW_REQUIRED');assert.equal(proof.cloudflareMutations,1);
 assert.equal(proof.failure,'MMF_PROTECTED_SETTINGS_DRIFT');
});
