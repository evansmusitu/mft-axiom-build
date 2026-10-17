/** GET-only independent readback after the exact source upload succeeded. */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,createPublicKey,X509Certificate} from 'node:crypto';
import {createCloudflareMmfPkceQualification} from './mmf-cloudflare-pkce-qualification.mjs';
const account='93f395f5121954671f92fffa453d6b61',worker='mmf-private-identity-edge-20261017',host='mail-stage.mftintelligence.com';
const prefix='accounts/'+account+'/',access=prefix+'access/',target=prefix+'workers/scripts/'+worker;
const appId='f8ab12fe-251f-44fa-80de-1c2f2bdc4055',oidcId='4ae515a1-189d-41c2-8020-c99ea157b021',idp='ec04a8ab-9382-4df0-9589-d2c98618e6af';
const token=process.env.CLOUDFLARE_API_TOKEN;
const report={schema:'mmf-private-qualification-independent-readback-v1',when:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA,
 cloudflareMutations:0,accountVerified:false,adminOnlyMfa:false,bindingsVerified:false,sourceVerified:false,
 publicPinsVerified:false,anonymousDenied:false,applicationLoginEnabled:false,realSending:false,payments:false,
 browserQualificationObserved:false,gate:'MMF_QUALIFICATION_READBACK_INCOMPLETE'};
const fail=message=>{throw Error(message)};
async function get(path){
 const r=await fetch('https://api.cloudflare.com/client/v4/'+path,{method:'GET',headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok)fail('MMF_CF_READ_DENIED');
 if(path.endsWith('/content/v2'))return r;
 const text=await r.text();if(text.length>400000)fail('MMF_CF_RESPONSE_TOO_BIG');
 const data=JSON.parse(text);if(data.success!==true||!Object.hasOwn(data,'result')||data.result_info?.total_pages>1)fail('MMF_CF_READ_INVALID');return data.result;
}
async function publicJson(url){
 const r=await fetch(url,{redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!r.ok)fail('MMF_PUBLIC_READ_DENIED');const text=await r.text();if(text.length>32768)fail('MMF_PUBLIC_READ_TOO_BIG');return JSON.parse(text);
}
const fp=key=>createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
const load=p=>readFileSync('musitu-mail-fabric/'+p,'utf8');
try{
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==account||!token||token.length<20)fail('MMF_CONNECTION_UNAVAILABLE');
 const [zones,org,app,policies,oidc,oidcPolicies,settings,subdomain,domains,scripts,response]=await Promise.all([
  get('zones?name=mftintelligence.com&per_page=100'),get(access+'organizations'),get(access+'apps/'+appId),get(access+'apps/'+appId+'/policies?per_page=100'),
  get(access+'apps/'+oidcId),get(access+'apps/'+oidcId+'/policies?per_page=100'),get(target+'/settings'),get(target+'/subdomain'),
  get(prefix+'workers/domains?per_page=100'),get(prefix+'workers/scripts?per_page=100'),get(target+'/content/v2')]);
 report.accountVerified=zones?.length===1&&zones[0].account?.id===account&&zones[0].status==='active'&&org?.auth_domain==='musitu-axiom.cloudflareaccess.com';
 const email='evansmusitu5@gmail.com';
 const policy=p=>p?.length===1&&p[0].name==='MMF sole administrator private staging only'&&p[0].decision==='allow'&&p[0].session_duration==='15m'&&
  p[0].include?.length===1&&p[0].include[0].email?.email===email&&p[0].require?.length===1&&p[0].require[0].login_method?.id===idp&&p[0].exclude?.length===0;
 const mfa=a=>a.mfa_config?.mfa_disabled===false&&a.mfa_config.allowed_authenticators?.includes('totp')&&JSON.stringify(a.allowed_idps)===JSON.stringify([idp]);
 report.adminOnlyMfa=app.id===appId&&app.type==='self_hosted'&&app.domain===host&&oidc.id===oidcId&&oidc.type==='saas'&&
  mfa(app)&&mfa(oidc)&&policy(policies)&&policy(oidcPolicies);
 const records=scripts.filter(x=>x.id===worker);if(records.length!==1)fail('MMF_WORKER_RECORD_AMBIGUOUS');
 const record=records[0],bindings=settings.bindings||[];
 report.settingsFields=Object.keys(settings).sort();
 report.settingValues={compatibilityDate:settings.compatibility_date??null,compatibilityFlags:settings.compatibility_flags??null,
  observabilityEnabled:settings.observability?.enabled??null,logpush:settings.logpush??null,
  scriptLogpush:record.logpush??null,scriptMigrationTag:record.migration_tag??null,tailConsumers:settings.tail_consumers?.length??0,
  bindings:bindings.map(b=>({name:b.name,type:b.type,class_name:b.class_name??null,namespacePresent:typeof b.namespace_id==='string'}))};
 const value=name=>bindings.filter(b=>b.name===name&&b.type==='plain_text');
 const original={MMF_ACCESS_AUD:app.aud,MMF_APPROVED_ADMIN_SHA256:createHash('sha256').update(email).digest('hex'),
  MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
 const durable=bindings.filter(b=>b.name==='MMF_OIDC_QUALIFICATION'&&b.type==='durable_object_namespace'&&b.class_name==='MmfOidcQualificationDO'&&/^[a-f0-9]{32}$/.test(b.namespace_id||''));
 report.bindingsVerified=bindings.length===6&&Object.entries(original).every(([k,v])=>value(k).length===1&&value(k)[0].text===v)&&durable.length===1;
 // This API omits the optional observability object. Do not invent an explicit
 // false readback. The upload submitted disabled observability; that field is
 // independently confirmed only when the API actually returns it. All auth,
 // binding, source and runtime checks below still require affirmative evidence.
 report.observabilityReadback=settings.observability===undefined&&record.observability===undefined?
  'OPTIONAL_OBJECT_OMITTED_NOT_INDEPENDENTLY_CONFIRMED':
  (settings.observability??record.observability)?.enabled===false?'EXPLICITLY_DISABLED':'UNEXPECTED_ENABLED_OR_INVALID';
 report.runtimeSettingsVerified=settings.compatibility_date==='2026-10-17'&&settings.compatibility_flags?.includes('nodejs_compat')&&
  settings.logpush===false&&record.logpush===false&&!settings.tail_consumers?.length&&record.migration_tag==='mmf-oidc-qualification-v1-20261017'&&
  report.observabilityReadback!=='UNEXPECTED_ENABLED_OR_INVALID';
 const contentType=response.headers.get('content-type')||'';
 if(!contentType.startsWith('multipart/'))fail('MMF_SOURCE_FORMAT_DENIED');
 const bytes=await response.arrayBuffer();if(bytes.byteLength>250000)fail('MMF_SOURCE_OVERSIZE');
 const form=await new Response(bytes,{headers:{'content-type':contentType.replace(/^multipart\/[^;]+/,'multipart/form-data')}}).formData();
 const modules=new Map();for(const [name,value] of form){if(modules.has(name))fail('MMF_DUPLICATE_SOURCE');modules.set(name,typeof value==='string'?value:await value.text())}
 const entry='src/edge/mmf-oidc-qualification-cloudflare.mjs',gateway='src/edge/mmf-access-stage-gateway.mjs';
 const configMatch=modules.get(entry)?.match(/const PINNED_QUALIFICATION_CONFIG=Object\.freeze\((\{[^;\n]+\})\);/);
 const accessMatch=modules.get(gateway)?.match(/const PINNED_ACCESS_CERTS=Object\.freeze\((\{[^;\n]+\})\);/);
 if(!configMatch||!accessMatch)fail('MMF_PIN_TEMPLATE_MISSING');
 const cfg=JSON.parse(configMatch[1]),pins=JSON.parse(accessMatch[1]);
 const expected=new Map([[entry,load(entry).replace('const PINNED_QUALIFICATION_CONFIG=null;',configMatch[0])],
  [gateway,load(gateway).replace('const PINNED_ACCESS_CERTS={keys:[],validUntil:0};',accessMatch[0])],
  ...['src/staging/mmf-oidc-qualification-flow.mjs','src/staging/mmf-cloudflare-pkce-qualification.mjs','src/commercial/mmf-oidc-private-token-exchange.mjs',
   'src/commercial/mmf-oidc-admission.mjs','src/commercial/mmf-db-transaction.mjs'].map(p=>[p,load(p)])]);
 report.sourceVerified=modules.size===expected.size&&[...expected].every(([name,source])=>modules.get(name)===source);
 const api=oidc.saas_app,issuer='https://'+org.auth_domain+'/cdn-cgi/access/sso/oidc/'+api.client_id;
 if(api.auth_type!=='oidc'||JSON.stringify(api.redirect_uris)!==JSON.stringify(['https://'+host+'/private/oidc/callback'])||
  JSON.stringify(api.grant_types)!==JSON.stringify(['authorization_code_with_pkce'])||api.allow_pkce_without_client_secret!==true||
  cfg.clientId!==api.client_id||cfg.issuer!==issuer||cfg.validUntil<=Date.now()||cfg.validUntil>Date.now()+86400000)fail('MMF_OIDC_CONFIG_DRIFT');
 const [certs,jwks]=await Promise.all([publicJson('https://'+org.auth_domain+'/cdn-cgi/access/certs'),publicJson(issuer+'/jwks')]);
 const apiKey=api.public_key.includes('BEGIN CERTIFICATE')?new X509Certificate(api.public_key).publicKey:createPublicKey(api.public_key);
 createCloudflareMmfPkceQualification({...cfg,env:original});
 const matching=jwks.keys.filter(k=>{try{return k.kid===cfg.keyId&&fp(createPublicKey({key:k,format:'jwk'}))===cfg.spkiFingerprint}catch{return false}});
 report.publicPinsVerified=fp(apiKey)===cfg.spkiFingerprint&&matching.length===1&&pins.validUntil>Date.now()&&pins.validUntil<Date.now()+15*86400000&&
  pins.keys.length===certs.keys.length&&certs.keys.every(k=>pins.keys.filter(p=>p.kid===k.kid&&fp(createPublicKey({key:k,format:'jwk'}))===fp(createPublicKey({key:p,format:'jwk'}))).length===1);
 report.qualificationExpiresAt=new Date(cfg.validUntil).toISOString();report.accessPublicKeysExpireAt=new Date(pins.validUntil).toISOString();
 report.networkIsolationVerified=subdomain.enabled===false&&subdomain.previews_enabled===false&&domains.filter(d=>d.hostname===host&&d.service===worker).length===1;
 if(![report.accountVerified,report.adminOnlyMfa,report.bindingsVerified,report.runtimeSettingsVerified,report.sourceVerified,report.publicPinsVerified,report.networkIsolationVerified].every(Boolean))fail('MMF_READBACK_ASSERTION_FAILED');
 report.anonymousStatuses={};
 for(const path of ['/private/dashboard','/private/gateway','/private/oidc/qualify','/private/oidc/qualification','/private/oidc/callback?state=invalid&code=invalid']){
  const r=await fetch('https://'+host+path,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});
  report.anonymousStatuses[path.split('?')[0]]=r.status;await r.body?.cancel().catch(()=>{});
  if(![302,303,307,308,401,403].includes(r.status))fail('MMF_ANONYMOUS_ROUTE_EXPOSED');
 }
 report.anonymousDenied=true;report.gate='MMF_PRIVATE_QUALIFICATION_READBACK_PASSED_HUMAN_OIDC_PENDING';
}catch(e){report.failure=/^MMF_[A-Z_]+$/.test(e.message||'')?e.message:'MMF_READBACK_RUNTIME_FAILURE'}
finally{
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-oidc-qualification-readback-proof.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report));if(report.gate!=='MMF_PRIVATE_QUALIFICATION_READBACK_PASSED_HUMAN_OIDC_PENDING')process.exitCode=2;
}
