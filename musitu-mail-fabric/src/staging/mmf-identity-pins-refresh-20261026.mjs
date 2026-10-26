/**
 * Refresh the existing private dashboard's public Access key pins and its
 * short-lived OIDC qualification pin. This is a content-only repair of the
 * already isolated Worker. It cannot change Access, DNS, bindings, customer
 * capabilities, mail delivery, payments, or any unrelated Worker.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,createPublicKey,X509Certificate} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {
 assertProtection,concurrencySnapshot,describeSnapshotDrift,moduleNames,
 readModules,verifiedPublicPins
} from './mmf-dashboard-access-pin-refresh-20261025.mjs';
import {createCloudflareMmfPkceQualification} from './mmf-cloudflare-pkce-qualification.mjs';

const account='93f395f5121954671f92fffa453d6b61';
const worker='mmf-private-identity-edge-20261017';
const host='mail-stage.mftintelligence.com';
const team='musitu-axiom.cloudflareaccess.com';
const appId='f8ab12fe-251f-44fa-80de-1c2f2bdc4055';
const oidcId='4ae515a1-189d-41c2-8020-c99ea157b021';
const clientId='cf09992056460080b94aa85a4906ad386356e21cdb0d0d317218a21cc228785a';
const issuer='https://'+team+'/cdn-cgi/access/sso/oidc/'+clientId;
const prefix='accounts/'+account+'/',target=prefix+'workers/scripts/'+worker;
const access=prefix+'access/';
const ACCESS_MARKER='const PINNED_ACCESS_CERTS={keys:[],validUntil:0};';
const OIDC_MARKER='const PINNED_QUALIFICATION_CONFIG=null;';
const day=86400000;
const fail=code=>{throw Error(code)};
const digest=text=>createHash('sha256').update(text).digest('hex');
const fingerprint=key=>createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;

function pinned(source,kind){
 const expression=kind==='access'?/const PINNED_ACCESS_CERTS=Object\.freeze\((\{[^;\n]+\})\);/g:
  /const PINNED_QUALIFICATION_CONFIG=Object\.freeze\((\{[^;\n]+\})\);/g;
 const matches=[...(source||'').matchAll(expression)];
 if(matches.length!==1)fail('MMF_PIN_TEMPLATE_DRIFT');
 let value;try{value=JSON.parse(matches[0][1])}catch{fail('MMF_PIN_TEMPLATE_DRIFT')}
 if(!plain(value))fail('MMF_PIN_TEMPLATE_DRIFT');
 return {statement:matches[0][0],value};
}

function assertCurrentAccessPin(current,providerPins,now){
 if(!plain(current)||!Number.isSafeInteger(current.validUntil)||current.validUntil<=now||
  current.validUntil>now+15*day||!Array.isArray(current.keys)||current.keys.length!==providerPins.keys.length)
  fail('MMF_CURRENT_ACCESS_PIN_DRIFT');
 const fp=value=>{try{return fingerprint(createPublicKey({key:value,format:'jwk'}))}catch{fail('MMF_CURRENT_ACCESS_PIN_DRIFT')}};
 if(!providerPins.keys.every(key=>current.keys.filter(candidate=>candidate?.kid===key.kid&&fp(candidate)===fp(key)).length===1))
  fail('MMF_CURRENT_ACCESS_PIN_DRIFT');
}

export function verifiedOidcPin({oidc,jwks,metadata,now}){
 const cfg=oidc?.saas_app;
 if(!Number.isSafeInteger(now)||cfg?.auth_type!=='oidc'||cfg.client_id!==clientId||
  !isDeepStrictEqual(cfg.redirect_uris,['https://'+host+'/private/oidc/callback'])||
  !isDeepStrictEqual(cfg.grant_types,['authorization_code_with_pkce'])||
  cfg.allow_pkce_without_client_secret!==true||typeof cfg.public_key!=='string'||cfg.public_key.length>20000||
  !plain(jwks)||!Array.isArray(jwks.keys)||jwks.keys.length<1||jwks.keys.length>10||!plain(metadata)||
  metadata.issuer!==issuer||metadata.authorization_endpoint!==issuer+'/authorization'||
  metadata.token_endpoint!==issuer+'/token'||metadata.jwks_uri!==issuer+'/jwks'||
  !metadata.response_types_supported?.includes('code')||
  !metadata.id_token_signing_alg_values_supported?.includes('RS256'))fail('MMF_OIDC_PROVIDER_PIN_DRIFT');
 let apiKey;try{apiKey=cfg.public_key.includes('BEGIN CERTIFICATE')?
  new X509Certificate(cfg.public_key).publicKey:createPublicKey(cfg.public_key)}catch{fail('MMF_OIDC_PROVIDER_PIN_DRIFT')}
 if(apiKey.asymmetricKeyType!=='rsa'||apiKey.asymmetricKeyDetails?.modulusLength<2048)fail('MMF_OIDC_PROVIDER_PIN_DRIFT');
 const apiFingerprint=fingerprint(apiKey);
 const matches=jwks.keys.filter(key=>{try{return plain(key)&&key.kty==='RSA'&&
   (!key.alg||key.alg==='RS256')&&(!key.use||key.use==='sig')&&!key.d&&
   fingerprint(createPublicKey({key,format:'jwk'}))===apiFingerprint}catch{return false}});
 if(matches.length!==1||typeof matches[0].kid!=='string'||!/^[A-Za-z0-9._:-]{4,100}$/.test(matches[0].kid)||
  typeof matches[0].n!=='string'||typeof matches[0].e!=='string')fail('MMF_OIDC_PROVIDER_PIN_DRIFT');
 const result={clientId,issuer,tokenEndpoint:issuer+'/token',redirectUri:'https://'+host+'/private/oidc/callback',
  keyId:matches[0].kid,publicJwk:{kty:'RSA',n:matches[0].n,e:matches[0].e},
  spkiFingerprint:apiFingerprint,validUntil:now+day};
 createCloudflareMmfPkceQualification({...result,env:{MMF_REAL_SEND_ENABLED:'false',
  MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'}});
 return result;
}

function assertCurrentOidcPin(current,fresh,now){
 const keys=['clientId','issuer','keyId','publicJwk','redirectUri','spkiFingerprint','tokenEndpoint','validUntil'];
 if(!plain(current)||!isDeepStrictEqual(Object.keys(current).sort(),keys.sort())||
  current.clientId!==clientId||current.issuer!==issuer||current.tokenEndpoint!==issuer+'/token'||
  current.redirectUri!=='https://'+host+'/private/oidc/callback'||
  current.keyId!==fresh.keyId||current.spkiFingerprint!==fresh.spkiFingerprint||
  !isDeepStrictEqual(current.publicJwk,fresh.publicJwk)||!Number.isSafeInteger(current.validUntil)||
  current.validUntil>now+2*day)fail('MMF_CURRENT_OIDC_PIN_DRIFT');
 let key;try{key=createPublicKey({key:current.publicJwk,format:'jwk'})}catch{fail('MMF_CURRENT_OIDC_PIN_DRIFT')}
 if(fingerprint(key)!==current.spkiFingerprint)fail('MMF_CURRENT_OIDC_PIN_DRIFT');
}

export function planIdentityPinsRefresh({remote,local,certs,oidc,jwks,metadata,now}){
 if(!(remote instanceof Map)||!(local instanceof Map)||remote.size!==moduleNames.length||
  local.size!==moduleNames.length||!moduleNames.every(name=>remote.has(name)&&local.has(name)))
  fail('MMF_MODULE_SET_DRIFT');
 const accessPin=pinned(remote.get(moduleNames[1]),'access');
 const oidcPin=pinned(remote.get(moduleNames[0]),'oidc');
 const nextAccess=verifiedPublicPins(certs,now);
 const nextOidc=verifiedOidcPin({oidc,jwks,metadata,now});
 assertCurrentAccessPin(accessPin.value,nextAccess,now);
 assertCurrentOidcPin(oidcPin.value,nextOidc,now);
 for(const name of moduleNames){
  let expected=local.get(name);
  if(name===moduleNames[0]){
   if(expected.split(OIDC_MARKER).length!==2)fail('MMF_LOCAL_TEMPLATE_DRIFT');
   expected=expected.replace(OIDC_MARKER,oidcPin.statement);
  }
  if(name===moduleNames[1]){
   if(expected.split(ACCESS_MARKER).length!==2)fail('MMF_LOCAL_TEMPLATE_DRIFT');
   expected=expected.replace(ACCESS_MARKER,accessPin.statement);
  }
  if(remote.get(name)!==expected)fail('MMF_EXACT_SEVEN_MODULE_BASELINE_DRIFT');
 }
 const desired=new Map(remote);
 desired.set(moduleNames[0],local.get(moduleNames[0]).replace(OIDC_MARKER,
  'const PINNED_QUALIFICATION_CONFIG=Object.freeze('+JSON.stringify(nextOidc)+');'));
 desired.set(moduleNames[1],local.get(moduleNames[1]).replace(ACCESS_MARKER,
  'const PINNED_ACCESS_CERTS=Object.freeze('+JSON.stringify(nextAccess)+');'));
 const changed=moduleNames.filter(name=>desired.get(name)!==remote.get(name));
 if(!isDeepStrictEqual(changed,[moduleNames[0],moduleNames[1]]))fail('MMF_UNEXPECTED_CHANGE');
 return {desired,summary:{changedModules:changed,accessKeyCount:nextAccess.keys.length,
  previousAccessExpiresAt:new Date(accessPin.value.validUntil).toISOString(),
  accessExpiresAt:new Date(nextAccess.validUntil).toISOString(),
  previousOidcExpiresAt:new Date(oidcPin.value.validUntil).toISOString(),
  oidcExpiresAt:new Date(nextOidc.validUntil).toISOString(),
  previousEntrySha256:digest(remote.get(moduleNames[0])),entrySha256:digest(desired.get(moduleNames[0])),
  previousGatewaySha256:digest(remote.get(moduleNames[1])),gatewaySha256:digest(desired.get(moduleNames[1]))}};
}

async function bounded(response,limit){
 let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>limit)fail('MMF_RESPONSE_TOO_LARGE');chunks.push(chunk)}
 return Buffer.concat(chunks);
}

export async function refreshIdentityPins({token,accountId,sourceSha,loadSource,fetchImpl=fetch,now=Date.now()}){
 const proof={schema:'mmf-private-identity-pins-refresh-20261026-v1',when:new Date(now).toISOString(),sourceSha,
  cloudflareMutations:0,applicationLoginEnabled:false,browserAcceptance:false,realSending:false,payments:false,
  customerApi:false,accessChanged:false,dnsChanged:false,bindingsChanged:false,
  gate:'MMF_IDENTITY_PIN_REFRESH_STOPPED_BEFORE_WRITE'};
 const api=async(path,method='GET',body)=>{
  if(method!=='GET'&&!(method==='PUT'&&path===target+'/content'&&body instanceof FormData))fail('MMF_MUTATION_NOT_ALLOWED');
  if(method!=='GET')proof.cloudflareMutations++;
  const response=await fetchImpl('https://api.cloudflare.com/client/v4/'+path,{method,
   headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),
   ...(body?{body}:{})});
  if(!(response instanceof Response)||!response.ok||response.redirected){proof.httpBlocker=response?.status??null;fail('MMF_CLOUDFLARE_REQUEST_DENIED')}
  if(path.endsWith('/content/v2'))return readModules(response);
  const data=JSON.parse((await bounded(response,400000)).toString('utf8'));
  if(data.success!==true||!Object.hasOwn(data,'result')||Number(data.result_info?.total_pages||1)>1)
   fail('MMF_CLOUDFLARE_RESPONSE_INVALID');
  return data.result;
 };
 const publicJson=async(url,limit)=>{
  const response=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
   headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(!(response instanceof Response)||!response.ok||response.redirected||
   !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type')||''))fail('MMF_PUBLIC_PIN_REQUEST_DENIED');
  return JSON.parse((await bounded(response,limit)).toString('utf8'));
 };
 const snapshot=async()=>Object.fromEntries(await Promise.all(Object.entries({
  zones:'zones?name=mftintelligence.com&per_page=100',org:access+'organizations',app:access+'apps/'+appId,
  policies:access+'apps/'+appId+'/policies?per_page=100',oidc:access+'apps/'+oidcId,
  oidcPolicies:access+'apps/'+oidcId+'/policies?per_page=100',settings:target+'/settings',subdomain:target+'/subdomain',
  domains:prefix+'workers/domains?per_page=100'
 }).map(async([name,path])=>[name,await api(path)])));
 try{
  if(accountId!==account||typeof token!=='string'||token.length<20||typeof loadSource!=='function'||
   !/^[a-f0-9]{40}$/.test(sourceSha||'')||!Number.isSafeInteger(now))fail('MMF_EXISTING_CONNECTION_REQUIRED');
  const [before,remote,certs,jwks,metadata]=await Promise.all([snapshot(),api(target+'/content/v2'),
   publicJson('https://'+team+'/cdn-cgi/access/certs',32768),publicJson(issuer+'/jwks',32768),
   publicJson(issuer+'/.well-known/openid-configuration',32768)]);
  assertProtection(before);proof.accountAndAdminMfaVerified=true;proof.bindingsAndIsolationVerified=true;
  const plan=planIdentityPinsRefresh({remote,local:new Map(moduleNames.map(name=>[name,loadSource(name)])),
   certs,oidc:before.oidc,jwks,metadata,now});
  Object.assign(proof,plan.summary);proof.exactBaselineVerified=true;proof.freshPublicPinsVerified=true;
  const [again,sourceAgain]=await Promise.all([snapshot(),api(target+'/content/v2')]);
  const stableBefore=concurrencySnapshot(before),stableAgain=concurrencySnapshot(again);
  if(!isDeepStrictEqual(stableBefore,stableAgain)||!isDeepStrictEqual(remote,sourceAgain)){
   proof.concurrentDrift=describeSnapshotDrift(stableBefore,stableAgain);
   proof.concurrentSourceChanges=moduleNames.filter(name=>remote.get(name)!==sourceAgain.get(name));
   fail('MMF_CONCURRENT_DRIFT_BEFORE_WRITE');
  }
  if(!isDeepStrictEqual(before,again))proof.ignoredTransientDrift=describeSnapshotDrift(before,again);
  const form=new FormData();
  form.set('metadata',new Blob([JSON.stringify({main_module:moduleNames[0]})],{type:'application/json'}));
  for(const [name,source] of plan.desired)form.set(name,new Blob([source],{type:'application/javascript+module'}),name);
  if((await api(target+'/content','PUT',form))?.id!==worker)fail('MMF_CONTENT_WRITE_UNACKNOWLEDGED');
  const [after,sourceAfter]=await Promise.all([snapshot(),api(target+'/content/v2')]);
  assertProtection(after);
  proof.settingsAndPoliciesUnchanged=isDeepStrictEqual(concurrencySnapshot(before),concurrencySnapshot(after));
  if(!isDeepStrictEqual(before,after))proof.postDeployIgnoredTransientDrift=describeSnapshotDrift(before,after);
  proof.exactDeployedModulesVerified=isDeepStrictEqual(plan.desired,sourceAfter);
  if(!proof.settingsAndPoliciesUnchanged||!proof.exactDeployedModulesVerified)fail('MMF_POST_DEPLOY_DRIFT');
  proof.gate='MMF_PRIVATE_IDENTITY_PINS_REFRESHED_HUMAN_ACCEPTANCE_PENDING';
 }catch(error){
  proof.failure=/^MMF_[A-Z_]+$/.test(error?.message||'')?error.message:'MMF_IDENTITY_PIN_REFRESH_RUNTIME_FAILURE';
  proof.gate=proof.cloudflareMutations?'MMF_IDENTITY_PIN_REFRESH_REVIEW_REQUIRED':'MMF_IDENTITY_PIN_REFRESH_STOPPED_BEFORE_WRITE';
 }
 return proof;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const proof=await refreshIdentityPins({token:process.env.CLOUDFLARE_API_TOKEN,
  accountId:process.env.CLOUDFLARE_ACCOUNT_ID,sourceSha:process.env.GITHUB_SHA,
  loadSource:name=>readFileSync('musitu-mail-fabric/'+name,'utf8')});
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-private-identity-pins-refresh-proof.json'),
  JSON.stringify(proof,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify(proof));
 if(proof.gate!=='MMF_PRIVATE_IDENTITY_PINS_REFRESHED_HUMAN_ACCEPTANCE_PENDING')process.exitCode=2;
}
