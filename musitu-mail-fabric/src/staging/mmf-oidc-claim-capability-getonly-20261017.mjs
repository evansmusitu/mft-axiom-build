/** Read-only provider capability inspection. No token/identity payloads or writes. */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const account='93f395f5121954671f92fffa453d6b61',appId='4ae515a1-189d-41c2-8020-c99ea157b021';
const idpId='ec04a8ab-9382-4df0-9589-d2c98618e6af',token=process.env.CLOUDFLARE_API_TOKEN;
const prefix='accounts/'+account+'/access/';
const report={schema:'mmf-oidc-claim-capability-getonly-v1',when:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA,
 cloudflareMutations:0,loginAttempted:false,tokenExchangeAttempted:false,rawIdTokenPayloadRead:false,
 applicationLoginEnabled:false,sessionCreated:false,realSending:false,payments:false,gate:'MMF_CLAIM_INSPECTION_INCOMPLETE'};
const fail=code=>{throw Error(code)};
async function jsonGet(url,authorized=false){
 const r=await fetch(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
  headers:{accept:'application/json',...(authorized?{authorization:'Bearer '+token}:{})}});
 if(!r.ok)fail('MMF_GET_HTTP_'+r.status);
 let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>200000)fail('MMF_GET_OVERSIZE');chunks.push(chunk)}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
async function api(path){
 const j=await jsonGet('https://api.cloudflare.com/client/v4/'+path,true);
 if(j.success!==true||!Object.hasOwn(j,'result')||Number(j.result_info?.total_pages||1)>1)fail('MMF_GET_INCOMPLETE');return j.result;
}
const name=v=>typeof v==='string'&&/^[A-Za-z0-9_.:/-]{1,100}$/.test(v)?v:'OTHER';
const names=v=>Array.isArray(v)?v.slice(0,40).map(name):[];
try{
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==account||!token||token.length<20)fail('MMF_EXISTING_CONNECTION_MISSING');
 const [zones,org,app,idp]=await Promise.all([api('zones?name=mftintelligence.com&per_page=100'),api(prefix+'organizations'),api(prefix+'apps/'+appId),api(prefix+'identity_providers/'+idpId)]);
 if(zones?.length!==1||zones[0].account?.id!==account||zones[0].status!=='active'||org.auth_domain!=='musitu-axiom.cloudflareaccess.com'||
  app.id!==appId||app.type!=='saas'||app.saas_app?.auth_type!=='oidc'||idp.id!==idpId)fail('MMF_ACCOUNT_OR_PROVIDER_DRIFT');
 report.accountVerified=true;report.idpType=name(idp.type);report.idpConfigKeys=names(Object.keys(idp.config||{}));
 report.upstreamOidcFields=names(idp.config?.oidc_fields);report.upstreamSamlAttributes=names(idp.config?.saml_attributes);
 report.upstreamAuthTimeDeclared=report.upstreamOidcFields.includes('auth_time')||report.upstreamSamlAttributes.includes('auth_time');
 const cfg=app.saas_app;
 report.configuredScopes=names(cfg.scopes);
 report.customClaims=Array.isArray(cfg.custom_claims)?cfg.custom_claims.slice(0,40).map(c=>({name:name(c.name),scope:name(c.scope),required:c.required===true,
  sourceName:name(c.source?.name),sourceNameForApprovedIdp:name(c.source?.name_by_idp?.[idpId])})):[];
 report.authTimeMappingPresent=report.customClaims.some(c=>c.name==='auth_time');
 report.tokenLifetime=typeof cfg.access_token_lifetime==='number'?cfg.access_token_lifetime:name(cfg.access_token_lifetime);
 report.mfaRequired=app.mfa_config?.mfa_disabled===false&&app.mfa_config.allowed_authenticators?.includes('totp')&&
  JSON.stringify(app.allowed_idps)===JSON.stringify([idpId]);if(!report.mfaRequired)fail('MMF_MFA_DRIFT');
 const issuer='https://'+org.auth_domain+'/cdn-cgi/access/sso/oidc/'+cfg.client_id;
 const meta=await jsonGet(issuer+'/.well-known/openid-configuration');if(meta.issuer!==issuer)fail('MMF_ISSUER_DRIFT');
 report.claimsParameterSupported=typeof meta.claims_parameter_supported==='boolean'?meta.claims_parameter_supported:null;
 report.claimsSupported=names(meta.claims_supported);report.scopesSupported=names(meta.scopes_supported);
 report.authTimeAdvertised=report.claimsSupported.includes('auth_time');report.amrAdvertised=report.claimsSupported.includes('amr');
 report.gate='MMF_CLAIM_CAPABILITIES_READ_NO_AUTHENTICATION_CLAIM_SUBSTITUTED';
}catch(e){report.failure=/^MMF_[A-Z_0-9]+$/.test(e.message||'')?e.message:'MMF_READ_RUNTIME_FAILURE'}
finally{
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-oidc-claim-capability-getonly-proof.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report));if(report.gate==='MMF_CLAIM_INSPECTION_INCOMPLETE')process.exitCode=2;
}
