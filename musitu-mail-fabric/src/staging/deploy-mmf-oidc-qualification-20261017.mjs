/** One-shot isolated MMF migration. Run only through the existing Actions
 * environment. No Access, DNS, token, subscription or unrelated Worker writes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,createPublicKey,X509Certificate} from 'node:crypto';
import {join} from 'node:path';
const account='93f395f5121954671f92fffa453d6b61',worker='mmf-private-identity-edge-20261017';
const host='mail-stage.mftintelligence.com',idp='ec04a8ab-9382-4df0-9589-d2c98618e6af';
const prefix='accounts/'+account+'/',appId='f8ab12fe-251f-44fa-80de-1c2f2bdc4055',oidcId='4ae515a1-189d-41c2-8020-c99ea157b021';
const target=prefix+'workers/scripts/'+worker,access=prefix+'access/';
const token=process.env.CLOUDFLARE_API_TOKEN;
const proof={schema:'mmf-private-oidc-qualification-release-v1',when:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA,
 cloudflareMutations:0,accountVerified:false,accessPreserved:false,exactOriginalSource:false,sourceReadback:false,
 bindingsReadback:false,anonymousDenied:false,applicationLoginEnabled:false,realSending:false,payments:false,
 liveOidcVerified:false,gate:'MMF_QUALIFICATION_NOT_DEPLOYED'};
function fail(message){throw Error(message)}
async function api(path,method='GET',body){
 if(method!=='GET'&&!(method==='PUT'&&path===target&&body instanceof FormData))fail('MMF_CF_MUTATION_NOT_ALLOWED');
 if(method!=='GET')proof.cloudflareMutations++;
 const response=await fetch('https://api.cloudflare.com/client/v4/'+path,{method,
  headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),...(body?{body}:{})});
 if(!response.ok){
  // Only numeric API error identifiers: never dump provider bodies or headers.
  let codes=[];try{codes=(await response.json()).errors?.map(e=>e.code).filter(Number.isInteger)||[]}catch{}
  proof.apiBlocker={status:response.status,codes};fail('MMF_CF_API_REJECTED');
 }
 if(path.endsWith('/content/v2'))return response;
 const text=await response.text();if(text.length>250000)fail('MMF_CF_RESPONSE_TOO_BIG');
 const data=JSON.parse(text);if(data.success!==true||!Object.hasOwn(data,'result')||data.result_info?.total_pages>1)fail('MMF_CF_API_INVALID');return data.result;
}
async function modules(response){
 const type=response.headers.get('content-type')||'';
 if(!type.startsWith('multipart/'))fail('MMF_REMOTE_CONTENT_FORMAT');
 const raw=await response.arrayBuffer();if(raw.byteLength>250000)fail('MMF_REMOTE_CONTENT_TOO_BIG');
 const form=await new Response(raw,{headers:{'content-type':type.replace(/^multipart\/[^;]+/,'multipart/form-data')}}).formData();
 const result=new Map();
 for(const [name,value] of form){
  if(result.has(name))fail('MMF_DUPLICATE_REMOTE_MODULE');
  result.set(name,typeof value==='string'?value:await value.text());
 }
 return result;
}
async function publicJson(url,limit){
 const r=await fetch(url,{redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!r.ok||!(r.headers.get('content-type')||'').startsWith('application/json'))fail('MMF_PUBLIC_KEY_ENDPOINT_DENIED');
 const text=await r.text();if(text.length>limit)fail('MMF_PUBLIC_KEY_OVERSIZE');return JSON.parse(text);
}
const fingerprint=key=>createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
const policy=(policies,email)=>Array.isArray(policies)&&policies.length===1&&policies[0].name==='MMF sole administrator private staging only'&&
 policies[0].decision==='allow'&&policies[0].session_duration==='15m'&&policies[0].include?.length===1&&
 policies[0].include[0].email?.email===email&&policies[0].require?.length===1&&policies[0].require[0].login_method?.id===idp&&
 Array.isArray(policies[0].exclude)&&policies[0].exclude.length===0;
const mfa=app=>app?.mfa_config?.mfa_disabled===false&&app.mfa_config.allowed_authenticators?.includes('totp')&&
 JSON.stringify(app.allowed_idps)===JSON.stringify([idp]);
const names=['MMF_ACCESS_AUD','MMF_APPROVED_ADMIN_SHA256','MMF_REAL_SEND_ENABLED','MMF_COMMERCE_ENABLED','MMF_CUSTOMER_API_ENABLED'];
const load=path=>readFileSync('musitu-mail-fabric/'+path,'utf8');
try{
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==account||!token||token.length<20)fail('MMF_AUTHORIZED_CONNECTION_MISSING');
 const [zones,org,app,policies,oidc,oidcPolicies,settings,subdomain,domains,launcherPolicies]=await Promise.all([
  api('zones?name=mftintelligence.com&per_page=100'),api(access+'organizations'),api(access+'apps/'+appId),api(access+'apps/'+appId+'/policies?per_page=100'),
  api(access+'apps/'+oidcId),api(access+'apps/'+oidcId+'/policies?per_page=100'),api(target+'/settings'),api(target+'/subdomain'),
  api(prefix+'workers/domains?per_page=100'),api(access+'apps/9dfc2a78-0dae-463b-9235-03ae134be007/policies?per_page=100')]);
 proof.accountVerified=zones?.length===1&&zones[0].account?.id===account&&zones[0].status==='active'&&org?.auth_domain==='musitu-axiom.cloudflareaccess.com';
 const email=launcherPolicies?.[0]?.include?.[0]?.email?.email;
 if(!proof.accountVerified||email!=='evansmusitu5@gmail.com'||app.id!==appId||app.type!=='self_hosted'||app.domain!==host||
  !mfa(app)||!policy(policies,email)||oidc.id!==oidcId||oidc.type!=='saas'||!mfa(oidc)||!policy(oidcPolicies,email)||
  subdomain.enabled!==false||subdomain.previews_enabled!==false||domains.filter(d=>d.hostname===host&&d.service===worker).length!==1)fail('MMF_PROTECTION_OR_ACCOUNT_DRIFT');
 const bindings=settings.bindings;
 if(!Array.isArray(bindings)||bindings.length!==5||!names.every(name=>bindings.some(b=>b.name===name&&b.type==='plain_text'))||
  bindings.find(b=>b.name==='MMF_ACCESS_AUD').text!==app.aud||
  bindings.find(b=>b.name==='MMF_APPROVED_ADMIN_SHA256').text!==createHash('sha256').update(email).digest('hex')||
  names.slice(2).some(name=>bindings.find(b=>b.name===name).text!=='false')||
  settings.migration_tag||settings.tail_consumers?.length||settings.logpush===true||settings.observability?.enabled===true)fail('MMF_ORIGINAL_SETTINGS_DRIFT');
 const cfg=oidc.saas_app,clientId=cfg?.client_id;
 if(clientId!=='cf09992056460080b94aa85a4906ad386356e21cdb0d0d317218a21cc228785a'||cfg.auth_type!=='oidc'||
  JSON.stringify(cfg.redirect_uris)!==JSON.stringify(['https://'+host+'/private/oidc/callback'])||
  JSON.stringify(cfg.grant_types)!==JSON.stringify(['authorization_code_with_pkce'])||cfg.allow_pkce_without_client_secret!==true)fail('MMF_OIDC_REGISTRATION_DRIFT');
 const issuer='https://'+org.auth_domain+'/cdn-cgi/access/sso/oidc/'+clientId;
 const [certs,jwks,meta,remote]=await Promise.all([
  publicJson('https://'+org.auth_domain+'/cdn-cgi/access/certs',32768),publicJson(issuer+'/jwks',32768),
  publicJson(issuer+'/.well-known/openid-configuration',16384),api(target+'/content/v2').then(modules)]);
 const marker='const PINNED_ACCESS_CERTS={keys:[],validUntil:0};';
 const gateway=load('src/edge/mmf-access-stage-gateway.mjs');
 if(remote.size!==1||!remote.has('mmf-access-stage-gateway.mjs')||gateway.split(marker).length!==2)fail('MMF_REMOTE_MODULE_SET_DRIFT');
 const old=remote.get('mmf-access-stage-gateway.mjs'),pinMatches=[...old.matchAll(/const PINNED_ACCESS_CERTS=Object\.freeze\((\{[^;\n]+\})\);/g)];
 if(pinMatches.length!==1||old!==gateway.replace(marker,pinMatches[0][0]))fail('MMF_REMOTE_SOURCE_DRIFT');
 const previous=JSON.parse(pinMatches[0][1]);
 if(!Number.isSafeInteger(previous.validUntil)||previous.validUntil<=Date.now()||previous.validUntil>Date.now()+15*86400000||
  !Array.isArray(previous.keys)||previous.keys.length<1||previous.keys.length>5||!Array.isArray(certs.keys)||
  certs.keys.length!==previous.keys.length||!Array.isArray(certs.public_certs)||certs.public_certs.length!==certs.keys.length)fail('MMF_ACCESS_KEYSET_DRIFT');
 for(const key of certs.keys){
  const publicKey=createPublicKey({key,format:'jwk'}),matching=certs.public_certs.filter(x=>x.kid===key.kid);
  if(publicKey.asymmetricKeyDetails?.modulusLength<2048||key.kty!=='RSA'||key.alg!=='RS256'||key.use!=='sig'||key.d||matching.length!==1||
   fingerprint(new X509Certificate(matching[0].cert).publicKey)!==fingerprint(publicKey)||
   previous.keys.filter(k=>k.kid===key.kid&&fingerprint(createPublicKey({key:k,format:'jwk'}))===fingerprint(publicKey)).length!==1)fail('MMF_ACCESS_KEY_PROOF_FAILED');
 }
 if(meta.issuer!==issuer||meta.authorization_endpoint!==issuer+'/authorization'||meta.token_endpoint!==issuer+'/token'||
  meta.jwks_uri!==issuer+'/jwks'||!meta.response_types_supported?.includes('code')||!meta.id_token_signing_alg_values_supported?.includes('RS256'))fail('MMF_OIDC_ENDPOINT_DRIFT');
 const apiKey=cfg.public_key.includes('BEGIN CERTIFICATE')?new X509Certificate(cfg.public_key).publicKey:createPublicKey(cfg.public_key);
 const matches=jwks.keys.filter(k=>{try{return fingerprint(createPublicKey({key:k,format:'jwk'}))===fingerprint(apiKey)}catch{return false}});
 if(matches.length!==1)fail('MMF_OIDC_API_KEY_PIN_MISMATCH');
 const signingKey=matches[0];
 const qualification={clientId,issuer,tokenEndpoint:issuer+'/token',redirectUri:'https://'+host+'/private/oidc/callback',
  keyId:signingKey.kid,publicJwk:{kty:signingKey.kty,n:signingKey.n,e:signingKey.e},spkiFingerprint:fingerprint(apiKey),validUntil:Date.now()+86400000};
 const entry='src/edge/mmf-oidc-qualification-cloudflare.mjs';
 const configMarker='const PINNED_QUALIFICATION_CONFIG=null;';
 if(load(entry).split(configMarker).length!==2)fail('MMF_QUALIFICATION_TEMPLATE_DRIFT');
 const sources=new Map([
  [entry,load(entry).replace(configMarker,'const PINNED_QUALIFICATION_CONFIG=Object.freeze('+JSON.stringify(qualification)+');')],
  ['src/edge/mmf-access-stage-gateway.mjs',old],
  ...['src/staging/mmf-oidc-qualification-flow.mjs','src/staging/mmf-cloudflare-pkce-qualification.mjs',
   'src/commercial/mmf-oidc-private-token-exchange.mjs','src/commercial/mmf-oidc-admission.mjs','src/commercial/mmf-db-transaction.mjs'].map(p=>[p,load(p)])]);
 const form=new FormData();
 form.set('metadata',new Blob([JSON.stringify({main_module:entry,compatibility_date:'2026-10-17',compatibility_flags:['nodejs_compat'],
  bindings:[...bindings,{name:'MMF_OIDC_QUALIFICATION',type:'durable_object_namespace',class_name:'MmfOidcQualificationDO'}],
  migrations:{new_tag:'mmf-oidc-qualification-v1-20261017',new_sqlite_classes:['MmfOidcQualificationDO']},
  logpush:false,tail_consumers:[],observability:{enabled:false,redact_query_string:true}})],{type:'application/json'}));
 for(const [name,source] of sources)form.set(name,new Blob([source],{type:'application/javascript+module'}),name);
 // Complete pin/protocol configuration validation before the only mutation.
 const {createCloudflareMmfPkceQualification}=await import('./mmf-cloudflare-pkce-qualification.mjs');
 createCloudflareMmfPkceQualification({...qualification,env:Object.fromEntries(bindings.map(b=>[b.name,b.text]))});
 proof.exactOriginalSource=true;proof.qualificationExpiresAt=new Date(qualification.validUntil).toISOString();
 proof.accessPublicKeysExpireAt=new Date(previous.validUntil).toISOString();
 const updated=await api(target,'PUT',form);
 if(updated?.id!==worker)fail('MMF_CF_WRITE_NOT_ACKNOWLEDGED');
 const [after,settings2,sub2,domains2,app2,policies2,oidc2,oidcPolicies2]=await Promise.all([
  api(target+'/content/v2').then(modules),api(target+'/settings'),api(target+'/subdomain'),api(prefix+'workers/domains?per_page=100'),
  api(access+'apps/'+appId),api(access+'apps/'+appId+'/policies?per_page=100'),api(access+'apps/'+oidcId),api(access+'apps/'+oidcId+'/policies?per_page=100')]);
 proof.sourceReadback=after.size===sources.size&&[...sources].every(([path,source])=>after.get(path)===source);
 const b2=settings2.bindings,doBinding=b2?.filter(b=>b.name==='MMF_OIDC_QUALIFICATION'&&b.type==='durable_object_namespace'&&b.class_name==='MmfOidcQualificationDO');
 proof.bindingsReadback=b2?.length===6&&bindings.every(b=>b2.some(v=>JSON.stringify(v)===JSON.stringify(b)))&&
  doBinding?.length===1&&typeof doBinding[0].namespace_id==='string'&&settings2.compatibility_date==='2026-10-17'&&settings2.compatibility_flags?.includes('nodejs_compat')&&
  settings2.observability?.enabled===false&&settings2.logpush===false&&!settings2.tail_consumers?.length;
 proof.accessPreserved=JSON.stringify(app)===JSON.stringify(app2)&&JSON.stringify(policies)===JSON.stringify(policies2)&&
  JSON.stringify(oidc)===JSON.stringify(oidc2)&&JSON.stringify(oidcPolicies)===JSON.stringify(oidcPolicies2)&&
  JSON.stringify(domains)===JSON.stringify(domains2)&&sub2.enabled===false&&sub2.previews_enabled===false;
 if(!proof.sourceReadback||!proof.bindingsReadback||!proof.accessPreserved)fail('MMF_POST_DEPLOY_DRIFT');
 proof.anonymousStatuses={};
 for(const route of ['/private/dashboard','/private/gateway','/private/oidc/qualify','/private/oidc/qualification','/private/oidc/callback?state=invalid&code=invalid']){
  const response=await fetch('https://'+host+route,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});
  proof.anonymousStatuses[route.split('?')[0]]=response.status;await response.body?.cancel().catch(()=>{});
  if(![302,303,307,308,401,403].includes(response.status))fail('MMF_ANONYMOUS_ROUTE_LEAK');
 }
 proof.anonymousDenied=true;proof.gate='MMF_PRIVATE_QUALIFICATION_DEPLOYED_HUMAN_OIDC_PENDING';
}catch(error){
 proof.failure=/^MMF_[A-Z_]+$/.test(error.message||'')?error.message:'MMF_DEPLOYMENT_RUNTIME_FAILURE';
 proof.gate=proof.cloudflareMutations?'MMF_QUALIFICATION_RELEASE_REVIEW_REQUIRED':'MMF_QUALIFICATION_RELEASE_STOPPED_BEFORE_WRITE';
}finally{
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-oidc-qualification-release-proof.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(proof));
 if(proof.gate!=='MMF_PRIVATE_QUALIFICATION_DEPLOYED_HUMAN_OIDC_PENDING')process.exitCode=2;
}
