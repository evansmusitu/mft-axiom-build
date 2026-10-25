/** Restore the existing dashboard's public Access pins only.
 * The expired OIDC qualification configuration and durable state are preserved.
 * No settings, Access, DNS, binding, credential, or other Worker writes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,createPublicKey,X509Certificate} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

const account='93f395f5121954671f92fffa453d6b61';
const worker='mmf-private-identity-edge-20261017';
const host='mail-stage.mftintelligence.com';
const team='musitu-axiom.cloudflareaccess.com';
const appId='f8ab12fe-251f-44fa-80de-1c2f2bdc4055';
const oidcId='4ae515a1-189d-41c2-8020-c99ea157b021';
const idp='ec04a8ab-9382-4df0-9589-d2c98618e6af';
const clientId='cf09992056460080b94aa85a4906ad386356e21cdb0d0d317218a21cc228785a';
const prefix='accounts/'+account+'/',target=prefix+'workers/scripts/'+worker;
const access=prefix+'access/';
const ACCESS_MARKER='const PINNED_ACCESS_CERTS={keys:[],validUntil:0};';
const OIDC_MARKER='const PINNED_QUALIFICATION_CONFIG=null;';
const accessExpiry=Date.parse('2026-10-24T09:37:25.758Z');
const oidcExpiry=Date.parse('2026-10-18T10:33:04.432Z');
const day=86400000;
export const moduleNames=Object.freeze([
 'src/edge/mmf-oidc-qualification-cloudflare.mjs',
 'src/edge/mmf-access-stage-gateway.mjs',
 'src/staging/mmf-oidc-qualification-flow.mjs',
 'src/staging/mmf-cloudflare-pkce-qualification.mjs',
 'src/commercial/mmf-oidc-private-token-exchange.mjs',
 'src/commercial/mmf-oidc-admission.mjs',
 'src/commercial/mmf-db-transaction.mjs'
]);
const fail=code=>{throw Error(code)};
const fingerprint=key=>createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
const digest=text=>createHash('sha256').update(text).digest('hex');

export function assertProtection(s){
 const email=s.policies?.[0]?.include?.[0]?.email?.email;
 const mfa=a=>a?.mfa_config?.mfa_disabled===false&&
  isDeepStrictEqual(a.allowed_idps,[idp])&&a.mfa_config.allowed_authenticators?.includes('totp');
 const policy=p=>p?.length===1&&p[0].name==='MMF sole administrator private staging only'&&
  p[0].decision==='allow'&&p[0].session_duration==='15m'&&
  isDeepStrictEqual(p[0].include,[{email:{email}}])&&
  isDeepStrictEqual(p[0].require,[{login_method:{id:idp}}])&&p[0].exclude?.length===0;
 if(s.zones?.length!==1||s.zones[0].account?.id!==account||s.zones[0].status!=='active'||
  s.org?.auth_domain!==team||s.app?.id!==appId||s.app.type!=='self_hosted'||s.app.domain!==host||
  s.oidc?.id!==oidcId||s.oidc.type!=='saas'||!mfa(s.app)||!mfa(s.oidc)||
  email!=='evansmusitu5@gmail.com'||!policy(s.policies)||!policy(s.oidcPolicies))fail('MMF_ACCOUNT_OR_ACCESS_DRIFT');
 const expected={MMF_ACCESS_AUD:s.app.aud,MMF_APPROVED_ADMIN_SHA256:digest(email),
  MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
 const b=s.settings?.bindings;
 if(!Array.isArray(b)||b.length!==6||!Object.entries(expected).every(([name,text])=>
  b.filter(v=>v.name===name&&v.type==='plain_text'&&v.text===text).length===1)||
  b.filter(v=>v.name==='MMF_OIDC_QUALIFICATION'&&v.type==='durable_object_namespace'&&
   v.class_name==='MmfOidcQualificationDO'&&/^[a-f0-9]{32}$/.test(v.namespace_id||'')).length!==1||
  s.settings.compatibility_date!=='2026-10-17'||!s.settings.compatibility_flags?.includes('nodejs_compat')||
  s.settings.logpush!==false||s.settings.tail_consumers?.length||s.settings.observability?.enabled===true||
  s.subdomain?.enabled!==false||s.subdomain.previews_enabled!==false||
  s.domains?.filter(d=>d.hostname===host&&d.service===worker).length!==1)fail('MMF_PROTECTED_SETTINGS_DRIFT');
 const cfg=s.oidc.saas_app;
 if(cfg?.auth_type!=='oidc'||cfg.client_id!==clientId||
  !isDeepStrictEqual(cfg.redirect_uris,['https://'+host+'/private/oidc/callback'])||
  !isDeepStrictEqual(cfg.grant_types,['authorization_code_with_pkce'])||
  cfg.allow_pkce_without_client_secret!==true)fail('MMF_OIDC_REGISTRATION_DRIFT');
 return true;
}

export function verifiedPublicPins(certs,now){
 if(!Number.isSafeInteger(now)||!Array.isArray(certs?.keys)||certs.keys.length<1||certs.keys.length>5||
  !Array.isArray(certs.public_certs)||certs.public_certs.length!==certs.keys.length)fail('MMF_CURRENT_CERT_SET_INVALID');
 const keys=certs.keys.map(k=>{
  if(k?.kty!=='RSA'||k.alg!=='RS256'||k.use!=='sig'||typeof k.kid!=='string'||
   !/^[A-Za-z0-9._:-]{10,100}$/.test(k.kid)||typeof k.n!=='string'||!/^[A-Za-z0-9_-]{200,1024}$/.test(k.n)||
   typeof k.e!=='string'||!/^[A-Za-z0-9_-]{2,10}$/.test(k.e)||
   ['d','p','q','dp','dq','qi','oth'].some(x=>Object.hasOwn(k,x)))fail('MMF_CURRENT_JWK_INVALID');
  const key=createPublicKey({key:k,format:'jwk'}),matches=certs.public_certs.filter(p=>p.kid===k.kid);
  if(key.asymmetricKeyDetails?.modulusLength<2048||matches.length!==1||typeof matches[0].cert!=='string')fail('MMF_CURRENT_CERT_PROOF_INVALID');
  const cert=new X509Certificate(matches[0].cert);
  if(fingerprint(cert.publicKey)!==fingerprint(key)||Date.parse(cert.validFrom)>now||Date.parse(cert.validTo)<=now)fail('MMF_CURRENT_CERT_PROOF_INVALID');
  return {kid:k.kid,kty:k.kty,alg:k.alg,use:k.use,n:k.n,e:k.e};
 });
 if(new Set(keys.map(k=>k.kid)).size!==keys.length)fail('MMF_DUPLICATE_CERT_KEY');
 return {keys,validUntil:now+7*day};
}

function pinned(source,name){
 const expression=name==='access'?/const PINNED_ACCESS_CERTS=Object\.freeze\((\{[^;\n]+\})\);/g:
  /const PINNED_QUALIFICATION_CONFIG=Object\.freeze\((\{[^;\n]+\})\);/g;
 const matches=[...(source||'').matchAll(expression)];
 if(matches.length!==1)fail('MMF_PIN_TEMPLATE_DRIFT');
 return {statement:matches[0][0],value:JSON.parse(matches[0][1])};
}
export function planRefresh({remote,local,certs,now}){
 if(!(remote instanceof Map)||!(local instanceof Map)||remote.size!==7||local.size!==7||
  !moduleNames.every(p=>remote.has(p)&&local.has(p)))fail('MMF_MODULE_SET_DRIFT');
 const a=pinned(remote.get(moduleNames[1]),'access'),o=pinned(remote.get(moduleNames[0]),'oidc');
 if(a.value.validUntil!==accessExpiry||o.value.validUntil!==oidcExpiry||o.value.clientId!==clientId||
  o.value.redirectUri!=='https://'+host+'/private/oidc/callback'||
  o.value.issuer!=='https://'+team+'/cdn-cgi/access/sso/oidc/'+clientId||
  o.value.tokenEndpoint!==o.value.issuer+'/token'||
  now<=accessExpiry||now<=oidcExpiry)fail('MMF_EXPECTED_EXPIRED_BASELINE_DRIFT');
 for(const p of moduleNames){
  let expected=local.get(p);
  if(p===moduleNames[0]){if(expected.split(OIDC_MARKER).length!==2)fail('MMF_LOCAL_TEMPLATE_DRIFT');expected=expected.replace(OIDC_MARKER,o.statement)}
  if(p===moduleNames[1]){if(expected.split(ACCESS_MARKER).length!==2)fail('MMF_LOCAL_TEMPLATE_DRIFT');expected=expected.replace(ACCESS_MARKER,a.statement)}
  if(remote.get(p)!==expected)fail('MMF_EXACT_SEVEN_MODULE_BASELINE_DRIFT');
 }
 const pins=verifiedPublicPins(certs,now),desired=new Map(remote);
 desired.set(moduleNames[1],local.get(moduleNames[1]).replace(ACCESS_MARKER,'const PINNED_ACCESS_CERTS=Object.freeze('+JSON.stringify(pins)+');'));
 if(!isDeepStrictEqual(moduleNames.filter(p=>desired.get(p)!==remote.get(p)),[moduleNames[1]]))fail('MMF_UNEXPECTED_CHANGE');
 return {desired,summary:{previousAccessExpiresAt:new Date(a.value.validUntil).toISOString(),
  accessExpiresAt:new Date(pins.validUntil).toISOString(),oidcExpiresAt:new Date(o.value.validUntil).toISOString(),
  oidcConfigurationUnchanged:true,oidcQualificationExpired:true,keyCount:pins.keys.length,
  changedModules:[moduleNames[1]],previousGatewaySha256:digest(remote.get(moduleNames[1])),
  deployedGatewaySha256:digest(desired.get(moduleNames[1]))}};
}

async function bounded(response,limit){
 let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>limit)fail('MMF_RESPONSE_TOO_LARGE');chunks.push(chunk)}
 return Buffer.concat(chunks);
}
export async function readModules(response){
 const type=response.headers.get('content-type')||'';
 if(!type.startsWith('multipart/'))fail('MMF_REMOTE_CONTENT_FORMAT');
 const bytes=await bounded(response,250000);
 const form=await new Response(bytes,{headers:{'content-type':type.replace(/^multipart\/[^;]+/,'multipart/form-data')}}).formData();
 const result=new Map();
 for(const [name,value] of form){if(result.has(name))fail('MMF_DUPLICATE_REMOTE_MODULE');result.set(name,typeof value==='string'?value:await value.text())}
 return result;
}

export async function refreshDashboard({token,accountId,sourceSha,loadSource,fetchImpl=fetch,now=Date.now()}){
 const proof={schema:'mmf-dashboard-access-pin-refresh-20261025-v1',when:new Date(now).toISOString(),sourceSha,
  cloudflareMutations:0,applicationLoginEnabled:false,browserAcceptance:false,realSending:false,payments:false,customerApi:false,
  gate:'MMF_ACCESS_PIN_REFRESH_STOPPED_BEFORE_WRITE'};
 const api=async(path,method='GET',body)=>{
  if(method!=='GET'&&!(method==='PUT'&&path===target+'/content'&&body instanceof FormData))fail('MMF_MUTATION_NOT_ALLOWED');
  if(method!=='GET')proof.cloudflareMutations++;
  const r=await fetchImpl('https://api.cloudflare.com/client/v4/'+path,{method,headers:{authorization:'Bearer '+token,accept:'application/json'},
   redirect:'error',signal:AbortSignal.timeout(20000),...(body?{body}:{})});
  if(!r.ok||r.redirected){proof.httpBlocker=r.status;fail('MMF_CLOUDFLARE_REQUEST_DENIED')}
  if(path.endsWith('/content/v2'))return readModules(r);
  const j=JSON.parse((await bounded(r,400000)).toString('utf8'));
  if(j.success!==true||!Object.hasOwn(j,'result')||Number(j.result_info?.total_pages||1)>1)fail('MMF_CLOUDFLARE_RESPONSE_INVALID');return j.result;
 };
 const snapshot=async()=>Object.fromEntries(await Promise.all(Object.entries({
  zones:'zones?name=mftintelligence.com&per_page=100',org:access+'organizations',app:access+'apps/'+appId,
  policies:access+'apps/'+appId+'/policies?per_page=100',oidc:access+'apps/'+oidcId,
  oidcPolicies:access+'apps/'+oidcId+'/policies?per_page=100',settings:target+'/settings',subdomain:target+'/subdomain',
  domains:prefix+'workers/domains?per_page=100'
 }).map(async([name,path])=>[name,await api(path)])));
 try{
  if(accountId!==account||typeof token!=='string'||token.length<20||!/^[a-f0-9]{40}$/.test(sourceSha||''))fail('MMF_EXISTING_CONNECTION_REQUIRED');
  const [before,remote]=await Promise.all([snapshot(),api(target+'/content/v2')]);
  assertProtection(before);proof.accountAndAdminMfaVerified=true;proof.bindingsAndIsolationVerified=true;
  const r=await fetchImpl('https://'+team+'/cdn-cgi/access/certs',{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
  if(!r.ok||r.redirected||!(r.headers.get('content-type')||'').startsWith('application/json'))fail('MMF_PUBLIC_CERT_REQUEST_DENIED');
  const certs=JSON.parse((await bounded(r,32768)).toString('utf8'));
  const plan=planRefresh({remote,local:new Map(moduleNames.map(p=>[p,loadSource(p)])),certs,now});
  Object.assign(proof,plan.summary);proof.exactBaselineVerified=true;proof.freshPublicCertificatesVerified=true;
  // Re-read immediately before mutation. Concurrent source/config changes stop the write.
  const [again,sourceAgain]=await Promise.all([snapshot(),api(target+'/content/v2')]);
  if(!isDeepStrictEqual(before,again)||!isDeepStrictEqual(remote,sourceAgain))fail('MMF_CONCURRENT_DRIFT_BEFORE_WRITE');
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:moduleNames[0]})],{type:'application/json'}));
  for(const [name,source] of plan.desired)form.set(name,new Blob([source],{type:'application/javascript+module'}),name);
  if((await api(target+'/content','PUT',form))?.id!==worker)fail('MMF_CONTENT_WRITE_UNACKNOWLEDGED');
  const [after,sourceAfter]=await Promise.all([snapshot(),api(target+'/content/v2')]);
  assertProtection(after);
  proof.settingsAndPoliciesUnchanged=isDeepStrictEqual(before,after);
  proof.exactDeployedModulesVerified=isDeepStrictEqual(plan.desired,sourceAfter);
  if(!proof.settingsAndPoliciesUnchanged||!proof.exactDeployedModulesVerified)fail('MMF_POST_DEPLOY_DRIFT');
  // No request to the browser-blocked application: this verifies management-plane
  // deployment only. It cannot assert browser acceptance or anonymous-route denial.
  proof.gate='MMF_DASHBOARD_PINS_REFRESHED_BROWSER_ACCEPTANCE_PENDING';
 }catch(e){
  proof.failure=/^MMF_[A-Z_]+$/.test(e?.message||'')?e.message:'MMF_REFRESH_RUNTIME_FAILURE';
  proof.gate=proof.cloudflareMutations?'MMF_ACCESS_PIN_REFRESH_REVIEW_REQUIRED':'MMF_ACCESS_PIN_REFRESH_STOPPED_BEFORE_WRITE';
 }
 return proof;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const proof=await refreshDashboard({token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  sourceSha:process.env.GITHUB_SHA,loadSource:p=>readFileSync('musitu-mail-fabric/'+p,'utf8')});
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-dashboard-pin-refresh-proof.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(proof));
 if(proof.gate!=='MMF_DASHBOARD_PINS_REFRESHED_BROWSER_ACCEPTANCE_PENDING')process.exitCode=2;
}
