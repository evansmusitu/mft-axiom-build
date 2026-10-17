/** One-shot content-only correction to the existing MMF qualification Worker.
 * Exact seven-module baseline; no settings/binding/policy/DNS writes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createHash,createPublicKey,X509Certificate} from 'node:crypto';
import {createCloudflareMmfPkceQualification} from './mmf-cloudflare-pkce-qualification.mjs';
const baseline='6a51489c1aaf309e1934437600379ed9522af46d';
const account='93f395f5121954671f92fffa453d6b61',worker='mmf-private-identity-edge-20261017';
const prefix='accounts/'+account+'/',target=prefix+'workers/scripts/'+worker;
const access=prefix+'access/',appId='f8ab12fe-251f-44fa-80de-1c2f2bdc4055',oidcId='4ae515a1-189d-41c2-8020-c99ea157b021';
const token=process.env.CLOUDFLARE_API_TOKEN;
const report={schema:'mmf-phone-landing-content-release-v1',when:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA,
 cloudflareMutations:0,baselineVerified:false,settingsUnchanged:false,sourceReadback:false,applicationLoginEnabled:false,
 realSending:false,payments:false,gate:'MMF_PHONE_LANDING_NOT_RELEASED'};
const deny=message=>{throw Error(message)};
async function api(path,method='GET',body){
 if(method!=='GET'&&!(method==='PUT'&&path===target+'/content'&&body instanceof FormData))deny('MMF_CONTENT_ONLY_WRITE_REQUIRED');
 if(method!=='GET')report.cloudflareMutations++;
 const response=await fetch('https://api.cloudflare.com/client/v4/'+path,{method,headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),...(body?{body}:{})});
 if(!response.ok){report.httpBlocker=response.status;deny('MMF_CF_HTTP_DENIED')}
 if(path.endsWith('/content/v2'))return response;
 const text=await response.text();if(text.length>250000)deny('MMF_CF_RESPONSE_OVERSIZE');
 const data=JSON.parse(text);if(data.success!==true||!Object.hasOwn(data,'result')||data.result_info?.total_pages>1)deny('MMF_CF_API_DENIED');return data.result;
}
async function modules(response){
 const type=response.headers.get('content-type')||'';if(!type.startsWith('multipart/'))deny('MMF_REMOTE_FORMAT');
 const bytes=await response.arrayBuffer();if(bytes.byteLength>250000)deny('MMF_REMOTE_OVERSIZE');
 const form=await new Response(bytes,{headers:{'content-type':type.replace(/^multipart\/[^;]+/,'multipart/form-data')}}).formData();
 const data=new Map();for(const [name,value] of form){if(data.has(name))deny('MMF_DUPLICATE_REMOTE_SOURCE');data.set(name,typeof value==='string'?value:await value.text())}return data;
}
const load=path=>readFileSync('musitu-mail-fabric/'+path,'utf8');
const old=path=>execFileSync('git',['show',baseline+':musitu-mail-fabric/'+path],{encoding:'utf8'});
const fp=key=>createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
try{
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==account||!token||token.length<20)deny('MMF_CONNECTION_UNAVAILABLE');
 const [zones,app,policies,oidc,oidcPolicies,settings,sub,domains,remote]=await Promise.all([
  api('zones?name=mftintelligence.com&per_page=100'),api(access+'apps/'+appId),api(access+'apps/'+appId+'/policies?per_page=100'),
  api(access+'apps/'+oidcId),api(access+'apps/'+oidcId+'/policies?per_page=100'),api(target+'/settings'),api(target+'/subdomain'),api(prefix+'workers/domains?per_page=100'),api(target+'/content/v2').then(modules)]);
 const email='evansmusitu5@gmail.com',idp='ec04a8ab-9382-4df0-9589-d2c98618e6af';
 const approved=p=>p?.length===1&&p[0].name==='MMF sole administrator private staging only'&&p[0].decision==='allow'&&p[0].session_duration==='15m'&&
  p[0].include?.length===1&&p[0].include[0].email?.email===email&&p[0].require?.length===1&&p[0].require[0].login_method?.id===idp&&p[0].exclude?.length===0;
 const mfa=a=>a.mfa_config?.mfa_disabled===false&&a.mfa_config.allowed_authenticators?.includes('totp')&&JSON.stringify(a.allowed_idps)===JSON.stringify([idp]);
 if(zones?.length!==1||zones[0].account?.id!==account||zones[0].status!=='active'||app.id!==appId||app.domain!=='mail-stage.mftintelligence.com'||
  app.type!=='self_hosted'||oidc.id!==oidcId||oidc.type!=='saas'||!mfa(app)||!mfa(oidc)||!approved(policies)||!approved(oidcPolicies)||
  sub.enabled!==false||sub.previews_enabled!==false||domains.filter(d=>d.hostname===app.domain&&d.service===worker).length!==1)deny('MMF_ACCESS_OR_ACCOUNT_DRIFT');
 const b=settings.bindings||[],values={MMF_ACCESS_AUD:app.aud,MMF_APPROVED_ADMIN_SHA256:createHash('sha256').update(email).digest('hex'),
  MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
 if(b.length!==6||!Object.entries(values).every(([name,text])=>b.filter(v=>v.name===name&&v.type==='plain_text'&&v.text===text).length===1)||
  b.filter(v=>v.name==='MMF_OIDC_QUALIFICATION'&&v.type==='durable_object_namespace'&&v.class_name==='MmfOidcQualificationDO'&&/^[a-f0-9]{32}$/.test(v.namespace_id||'')).length!==1||
  settings.logpush!==false||settings.tail_consumers?.length||settings.observability?.enabled===true||settings.compatibility_date!=='2026-10-17'||!settings.compatibility_flags?.includes('nodejs_compat'))deny('MMF_PROTECTED_SETTINGS_DRIFT');
 const names=['src/edge/mmf-oidc-qualification-cloudflare.mjs','src/edge/mmf-access-stage-gateway.mjs','src/staging/mmf-oidc-qualification-flow.mjs',
  'src/staging/mmf-cloudflare-pkce-qualification.mjs','src/commercial/mmf-oidc-private-token-exchange.mjs','src/commercial/mmf-oidc-admission.mjs','src/commercial/mmf-db-transaction.mjs'];
 const configMatch=remote.get(names[0])?.match(/const PINNED_QUALIFICATION_CONFIG=Object\.freeze\((\{[^;\n]+\})\);/);
 const accessMatch=remote.get(names[1])?.match(/const PINNED_ACCESS_CERTS=Object\.freeze\((\{[^;\n]+\})\);/);
 if(!configMatch||!accessMatch||remote.size!==7)deny('MMF_REMOTE_SOURCE_SHAPE_DRIFT');
 const render=(path,source)=>path===names[0]?source.replace('const PINNED_QUALIFICATION_CONFIG=null;',configMatch[0]):
  path===names[1]?source.replace('const PINNED_ACCESS_CERTS={keys:[],validUntil:0};',accessMatch[0]):source;
 if(!names.every(p=>remote.get(p)===render(p,old(p))))deny('MMF_SEVEN_MODULE_BASELINE_DRIFT');
 const cfg=JSON.parse(configMatch[1]),pins=JSON.parse(accessMatch[1]),registered=oidc.saas_app;
 const providerKey=registered.public_key.includes('BEGIN CERTIFICATE')?new X509Certificate(registered.public_key).publicKey:createPublicKey(registered.public_key);
 if(cfg.clientId!==registered.client_id||cfg.spkiFingerprint!==fp(providerKey)||cfg.validUntil<=Date.now()||pins.validUntil<=Date.now()||
  JSON.stringify(registered.redirect_uris)!==JSON.stringify([cfg.redirectUri])||JSON.stringify(registered.grant_types)!==JSON.stringify(['authorization_code_with_pkce'])||registered.allow_pkce_without_client_secret!==true)deny('MMF_PINNED_REGISTRATION_DRIFT');
 createCloudflareMmfPkceQualification({...cfg,env:values});
 const desired=new Map(names.map(p=>[p,render(p,load(p))]));
 const changed=names.filter(p=>desired.get(p)!==remote.get(p));
 if(!isDeepStrictEqual(changed,['src/edge/mmf-oidc-qualification-cloudflare.mjs','src/staging/mmf-oidc-qualification-flow.mjs','src/staging/mmf-cloudflare-pkce-qualification.mjs']))deny('MMF_UNEXPECTED_RUNTIME_CHANGE');
 report.baselineVerified=true;report.changedModules=changed;report.qualificationExpiresAt=new Date(cfg.validUntil).toISOString();
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:names[0]})],{type:'application/json'}));
 for(const [name,source] of desired)form.set(name,new Blob([source],{type:'application/javascript+module'}),name);
 const result=await api(target+'/content','PUT',form);if(result.id!==worker)deny('MMF_CONTENT_UPDATE_NOT_ACKNOWLEDGED');
 const [after,s2,a2,p2,o2,op2,d2,sub2]=await Promise.all([api(target+'/content/v2').then(modules),api(target+'/settings'),
  api(access+'apps/'+appId),api(access+'apps/'+appId+'/policies?per_page=100'),api(access+'apps/'+oidcId),api(access+'apps/'+oidcId+'/policies?per_page=100'),api(prefix+'workers/domains?per_page=100'),api(target+'/subdomain')]);
 report.settingsUnchanged=[[settings,s2],[app,a2],[policies,p2],[oidc,o2],[oidcPolicies,op2],[domains,d2],[sub,sub2]].every(([left,right])=>isDeepStrictEqual(left,right));
 report.sourceReadback=after.size===desired.size&&[...desired].every(([path,source])=>after.get(path)===source);
 if(!report.settingsUnchanged||!report.sourceReadback)deny('MMF_POST_UPDATE_DRIFT');
 report.gate='MMF_PRIVATE_PHONE_LANDING_RELEASED';
}catch(e){report.failure=/^MMF_[A-Z_]+$/.test(e.message||'')?e.message:'MMF_CONTENT_RELEASE_RUNTIME_FAILURE'}
finally{
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-phone-landing-release-proof.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report));if(report.gate!=='MMF_PRIVATE_PHONE_LANDING_RELEASED')process.exitCode=2;
}
