import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {moduleNames,assertProtection,verifiedPublicPins,planRefresh,refreshDashboard} from '../src/staging/mmf-dashboard-access-pin-refresh-20261025.mjs';

const directory=mkdtempSync(join(tmpdir(),'mmf-pin-fixture-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=mmf-local-fixture',
 '-days','2','-keyout',join(directory,'fixture.key'),'-out',join(directory,'fixture.crt')],{stdio:'ignore'});
const cert=readFileSync(join(directory,'fixture.crt'),'utf8');
const jwk={...new X509Certificate(cert).publicKey.export({format:'jwk'}),kid:'mmf-fixture-key-20261025',alg:'RS256',use:'sig'};
const certs={keys:[jwk],public_certs:[{kid:jwk.kid,cert}]};
const now=Date.now(),day=86400000;
const account='93f395f5121954671f92fffa453d6b61',worker='mmf-private-identity-edge-20261017';
const host='mail-stage.mftintelligence.com',team='musitu-axiom.cloudflareaccess.com';
const appId='f8ab12fe-251f-44fa-80de-1c2f2bdc4055',oidcId='4ae515a1-189d-41c2-8020-c99ea157b021';
const idp='ec04a8ab-9382-4df0-9589-d2c98618e6af';
const clientId='cf09992056460080b94aa85a4906ad386356e21cdb0d0d317218a21cc228785a';
const issuer='https://'+team+'/cdn-cgi/access/sso/oidc/'+clientId;
const cfg={clientId,issuer,tokenEndpoint:issuer+'/token',redirectUri:'https://'+host+'/private/oidc/callback',
 validUntil:Date.parse('2026-10-18T10:33:04.432Z')};
const local=new Map(moduleNames.map(p=>[p,readFileSync(new URL('../'+p,import.meta.url),'utf8')]));
const source=()=>new Map([...local].map(([p,s])=>[p,s
 .replace('const PINNED_ACCESS_CERTS={keys:[],validUntil:0};','const PINNED_ACCESS_CERTS=Object.freeze('+JSON.stringify({keys:[jwk],validUntil:Date.parse('2026-10-24T09:37:25.758Z')})+');')
 .replace('const PINNED_QUALIFICATION_CONFIG=null;','const PINNED_QUALIFICATION_CONFIG=Object.freeze('+JSON.stringify(cfg)+');')]));
const policy={name:'MMF sole administrator private staging only',decision:'allow',session_duration:'15m',
 include:[{email:{email:'evansmusitu5@gmail.com'}}],require:[{login_method:{id:idp}}],exclude:[]};
const mfa={mfa_config:{mfa_disabled:false,allowed_authenticators:['totp']},allowed_idps:[idp]};
const settings={compatibility_date:'2026-10-17',compatibility_flags:['nodejs_compat'],logpush:false,tail_consumers:[],
 bindings:[...Object.entries({MMF_ACCESS_AUD:'existing-fixture-audience',
 MMF_APPROVED_ADMIN_SHA256:createHash('sha256').update('evansmusitu5@gmail.com').digest('hex'),
 MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'}).map(([name,text])=>({name,type:'plain_text',text})),
 {name:'MMF_OIDC_QUALIFICATION',type:'durable_object_namespace',class_name:'MmfOidcQualificationDO',namespace_id:'a'.repeat(32)}]};
const snapshot=()=>structuredClone({zones:[{account:{id:account},status:'active'}],org:{auth_domain:team},
 app:{id:appId,type:'self_hosted',domain:host,aud:'existing-fixture-audience',...mfa},
 oidc:{id:oidcId,type:'saas',...mfa,saas_app:{auth_type:'oidc',client_id:clientId,
 redirect_uris:[cfg.redirectUri],grant_types:['authorization_code_with_pkce'],allow_pkce_without_client_secret:true}},
 policies:[policy],oidcPolicies:[policy],settings,subdomain:{enabled:false,previews_enabled:false},domains:[{hostname:host,service:worker}]});

test('refresh verifies matching RSA certificate and JWK with exactly seven days of pin validity',()=>{
 const pins=verifiedPublicPins(certs,now);
 assert.equal(pins.validUntil,now+7*day);assert.deepEqual(pins.keys,[jwk]);
});
test('fresh certificate validation denies private keys, duplicate keys, wrong certificate and expiry',()=>{
 assert.throws(()=>verifiedPublicPins({...certs,keys:[{...jwk,d:'private'}]},now),/MMF_CURRENT_JWK_INVALID/);
 assert.throws(()=>verifiedPublicPins({keys:[jwk,jwk],public_certs:[certs.public_certs[0],certs.public_certs[0]]},now));
 assert.throws(()=>verifiedPublicPins({...certs,keys:[{...jwk,n:'a'.repeat(jwk.n.length)}]},now));
 assert.throws(()=>verifiedPublicPins(certs,now+3*day),/MMF_CURRENT_CERT_PROOF_INVALID/);
});
test('expired dashboard pins refresh alone while exact OIDC configuration and all six other modules remain unchanged',()=>{
 const remote=source(),plan=planRefresh({remote,local,certs,now});
 assert.deepEqual(plan.summary.changedModules,[moduleNames[1]]);
 assert.equal(plan.summary.oidcQualificationExpired,true);
 assert.equal(plan.summary.oidcExpiresAt,'2026-10-18T10:33:04.432Z');
 for(const p of moduleNames.filter(p=>p!==moduleNames[1]))assert.equal(plan.desired.get(p),remote.get(p));
 assert.equal(remote.get(moduleNames[1]),source().get(moduleNames[1]),'planner must not mutate the baseline');
});
test('module changes, missing modules and altered pin baselines cannot be overwritten',()=>{
 const changed=source();changed.set(moduleNames[2],changed.get(moduleNames[2])+'\n// unexpected\n');
 assert.throws(()=>planRefresh({remote:changed,local,certs,now}),/MMF_EXACT_SEVEN_MODULE_BASELINE_DRIFT/);
 const missing=source();missing.delete(moduleNames[4]);
 assert.throws(()=>planRefresh({remote:missing,local,certs,now}),/MMF_MODULE_SET_DRIFT/);
 const altered=source();altered.set(moduleNames[0],altered.get(moduleNames[0]).replace(String(cfg.validUntil),String(now+day)));
 assert.throws(()=>planRefresh({remote:altered,local,certs,now}),/MMF_EXPECTED_EXPIRED_BASELINE_DRIFT/);
});
test('sole administrator, MFA, six bindings and isolated route assertions fail closed on drift',()=>{
 assert.equal(assertProtection(snapshot()),true);
 for(const change of [
  s=>{s.policies[0].include.push({everyone:{}})},
  s=>{s.app.mfa_config.mfa_disabled=true},
  s=>{s.settings.bindings.find(b=>b.name==='MMF_REAL_SEND_ENABLED').text='true'},
  s=>{s.settings.bindings.push({name:'UNEXPECTED',type:'plain_text',text:'x'})},
  s=>{s.subdomain.previews_enabled=true},
  s=>{s.domains[0].service='another-worker'},
  s=>{s.oidc.saas_app.redirect_uris.push('https://other.invalid/callback')}
 ]){const s=snapshot();change(s);assert.throws(()=>assertProtection(s));}
});

function fakeCloud({driftBefore=false,denyWrite=false,driftAfter=false,badCertificate=false}={}){
 let remote=source(),phase=0;
 const calls=[];
 const prefix='accounts/'+account+'/',access=prefix+'access/',target=prefix+'workers/scripts/'+worker;
 const paths={zones:'zones?name=mftintelligence.com&per_page=100',org:access+'organizations',app:access+'apps/'+appId,
 policies:access+'apps/'+appId+'/policies?per_page=100',oidc:access+'apps/'+oidcId,
 oidcPolicies:access+'apps/'+oidcId+'/policies?per_page=100',settings:target+'/settings',subdomain:target+'/subdomain',
 domains:prefix+'workers/domains?per_page=100'};
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method,redirect:options.redirect});
  assert.equal(options.redirect,'error');
  if(url==='https://'+team+'/cdn-cgi/access/certs'){
   assert.equal(options.headers?.authorization,undefined);
   return Response.json(badCertificate?{keys:[],public_certs:[]}:certs);
  }
  assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/'));
  const path=url.slice('https://api.cloudflare.com/client/v4/'.length);
  assert.match(options.headers.authorization,/^Bearer fixture-/);
  if(path===paths.zones)phase++;
  if(options.method==='PUT'){
   assert.equal(path,target+'/content');assert.ok(options.body instanceof FormData);
   assert.deepEqual(JSON.parse(await options.body.get('metadata').text()),{main_module:moduleNames[0]});
   if(denyWrite)return new Response('',{status:403});
   remote=new Map();for(const [p,b] of options.body)if(p!=='metadata')remote.set(p,await b.text());
   return Response.json({success:true,result:{id:worker}});
  }
  assert.equal(options.method,'GET');
  if(path===target+'/content/v2'){
   const form=new FormData();for(const [p,s] of remote)form.set(p,new Blob([s]),p);
   return new Response(form);
  }
  const name=Object.keys(paths).find(k=>paths[k]===path);assert.ok(name,'only approved management endpoints');
  const s=snapshot();
  if(driftBefore&&phase===2)s.settings.logpush=true;
  if(driftAfter&&phase===3)s.settings.logpush=true;
  return Response.json({success:true,result:s[name]});
 };
 return {fetchImpl,calls,getRemote:()=>remote};
}
const invoke=cloud=>refreshDashboard({token:'fixture-existing-token-not-a-secret',accountId:account,
 sourceSha:'d183230b7b44f442a404bbd1d4ffa1fb8d6139bd',loadSource:p=>local.get(p),now,fetchImpl:cloud.fetchImpl});
test('guarded refresh issues one content-only PUT and verifies exact post-deploy source without calling application routes',async()=>{
 const cloud=fakeCloud(),proof=await invoke(cloud);
 assert.equal(proof.gate,'MMF_DASHBOARD_PINS_REFRESHED_BROWSER_ACCEPTANCE_PENDING');
 assert.equal(proof.cloudflareMutations,1);assert.equal(proof.settingsAndPoliciesUnchanged,true);
 assert.equal(proof.exactDeployedModulesVerified,true);assert.equal(proof.browserAcceptance,false);
 assert.equal(proof.applicationLoginEnabled,false);assert.equal(proof.oidcConfigurationUnchanged,true);
 assert.equal(cloud.calls.filter(c=>c.method==='PUT').length,1);
 assert.ok(cloud.calls.every(c=>new URL(c.url).hostname!==host));
 assert.doesNotMatch(JSON.stringify(proof),/Bearer|fixture-existing-token|gmail|publicJwk|BEGIN CERTIFICATE/);
});
test('concurrent settings drift and invalid public certificate prevent all Cloudflare writes',async()=>{
 for(const options of [{driftBefore:true},{badCertificate:true}]){
  const cloud=fakeCloud(options),proof=await invoke(cloud);
  assert.equal(proof.cloudflareMutations,0);assert.equal(proof.gate,'MMF_ACCESS_PIN_REFRESH_STOPPED_BEFORE_WRITE');
  assert.equal(cloud.calls.filter(c=>c.method==='PUT').length,0);
 }
});
test('write rejection and post-write drift are explicit failures without retries or alternate writes',async()=>{
 for(const options of [{denyWrite:true},{driftAfter:true}]){
  const cloud=fakeCloud(options),proof=await invoke(cloud);
  assert.equal(proof.gate,'MMF_ACCESS_PIN_REFRESH_REVIEW_REQUIRED');assert.ok(proof.failure);
  assert.equal(cloud.calls.filter(c=>c.method==='PUT').length,1);
  if(options.denyWrite)assert.equal(proof.httpBlocker,403);
 }
});
