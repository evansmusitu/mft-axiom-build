import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createCipheriv,publicEncrypt,constants,createPublicKey,X509Certificate,createHash} from 'node:crypto';
import {qualifyPrivateMmfOidcProvider} from '../commercial/mmf-oidc-provider-discovery.mjs';
const account='93f395f5121954671f92fffa453d6b61',host='mail-stage.mftintelligence.com';
const label='MUSITU Mail Fabric staging OIDC (closed qualification)';
const token=process.env.CLOUDFLARE_API_TOKEN,prefix='accounts/'+account+'/access/';
const evidence={schema:'mmf-real-oidc-closed-registration-v1',at:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA,requests:[],created:false,allowPoliciesCreated:0,liveAuthentication:false,liveMfa:false,privateProviderQualified:false,gate:'OIDC_REGISTRATION_NOT_VERIFIED'};
const fingerprint=k=>createHash('sha256').update(k.export({format:'der',type:'spki'})).digest('hex');
async function api(path,method='GET',body){
 const r=await fetch('https://api.cloudflare.com/client/v4/'+path,{method,headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});
 const text=await r.text();if(text.length>1000000)throw Error('API_RESPONSE_SIZE');
 let j;try{j=JSON.parse(text)}catch{j={}}
 evidence.requests.push({operation:path.startsWith(prefix+'apps')?'application':path.startsWith(prefix+'organizations')?'organization':'preflight',method,status:r.status,codes:(j.errors||[]).map(x=>x.code),messages:(j.errors||[]).map(x=>String(x.message||'').slice(0,300))});
 if(!r.ok||j.success!==true)throw Error(method+'_REJECTED');
 if(Number(j.result_info?.total_pages||1)>1)throw Error('PAGINATION_INCOMPLETE');return j.result;
}
const safe=x=>({id:x.id,name:x.name,type:x.type,allowed_idps:x.allowed_idps,mfa_config:x.mfa_config,session_duration:x.session_duration,saas_app:x.saas_app?Object.fromEntries(Object.entries(x.saas_app).filter(([k])=>k!=='client_secret')):null});
try{
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==account||!token||token.length<20)throw Error('AUTHORIZED_CONNECTION_UNAVAILABLE');
 const [zones,apps,org,idps]=await Promise.all([api('zones?name=mftintelligence.com&per_page=100'),api(prefix+'apps?per_page=100'),api(prefix+'organizations'),api(prefix+'identity_providers?per_page=100')]);
 if(zones.length!==1||zones[0].account?.id!==account||zones[0].status!=='active')throw Error('ACCOUNT_ZONE_DRIFT');
 if(org.mfa_required_for_all_apps===true||!org.mfa_config?.allowed_authenticators?.includes('totp')||!org.mfa_config?.allowed_authenticators?.includes('security_key'))throw Error('ORGANIZATION_MFA_UNVERIFIED');
 const gateway=apps.filter(x=>x.name==='MUSITU Mail Fabric closed private stage (deny all)'&&x.domain===host&&x.type==='self_hosted');
 if(gateway.length!==1)throw Error('EXISTING_GATEWAY_AMBIGUOUS');
 const [gw,policies]=await Promise.all([api(prefix+'apps/'+gateway[0].id),api(prefix+'apps/'+gateway[0].id+'/policies?per_page=100')]);
 if(policies.length||gw.mfa_config?.mfa_disabled!==false||!gw.mfa_config?.allowed_authenticators?.includes('totp'))throw Error('CLOSED_GATEWAY_MFA_UNVERIFIED');
 const providers=idps.filter(x=>x.type==='cloudflare'&&x.config?.restrict_to_account_members===true);
 if(providers.length!==1)throw Error('EXISTING_IDENTITY_PROVIDER_UNVERIFIED');
 const matches=apps.filter(x=>x.name===label);
 if(matches.length>1||matches.some(x=>x.type!=='saas'))throw Error('OIDC_CLIENT_AMBIGUOUS');
 const redirect='https://'+host+'/private/oidc/callback';
 let app=matches[0];
 if(!app){
  app=await api(prefix+'apps','POST',{name:label,type:'saas',allowed_idps:[providers[0].id],session_duration:'15m',app_launcher_visible:false,policies:[],
   mfa_config:{mfa_disabled:false,allowed_authenticators:['totp','security_key'],session_duration:'15m'},
   saas_app:{auth_type:'oidc',scopes:['openid'],redirect_uris:[redirect],grant_types:['authorization_code_with_pkce'],allow_pkce_without_client_secret:true,access_token_lifetime:'5m'}});
  evidence.created=true;
  // This is a public PKCE client. The returned optional client secret is neither
  // needed nor retained; it must never reach stdout, artifacts or local files.
  if(app.saas_app)delete app.saas_app.client_secret;
 }
 const [verified,clientPolicies]=await Promise.all([api(prefix+'apps/'+app.id),api(prefix+'apps/'+app.id+'/policies?per_page=100')]);
 evidence.registeredApplication=safe(verified);evidence.policyCount=clientPolicies.length;
 const cfg=verified.saas_app;
 if(verified.type!=='saas'||clientPolicies.length||cfg?.auth_type!=='oidc'||!cfg.client_id||JSON.stringify(cfg.redirect_uris)!==JSON.stringify([redirect])||JSON.stringify(cfg.grant_types)!==JSON.stringify(['authorization_code_with_pkce'])||cfg.allow_pkce_without_client_secret!==true||verified.mfa_config?.mfa_disabled!==false)throw Error('OIDC_REGISTRATION_READBACK_MISMATCH');
 if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(org.auth_domain)||!/^[A-Za-z0-9._:-]{4,128}$/.test(cfg.client_id))throw Error('ISSUER_CONFIG_INVALID');
 const issuer='https://'+org.auth_domain+'/cdn-cgi/access/sso/oidc/'+cfg.client_id;
 const expected={issuer,authorizationEndpoint:issuer+'/authorization',tokenEndpoint:issuer+'/token',jwksUri:issuer+'/jwks'};
 evidence.provider=expected;
 const meta=await fetch(issuer+'/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
 evidence.discoveryStatus=meta.status;if(!meta.ok)throw Error('REAL_DISCOVERY_UNAVAILABLE');
 const discovery=await meta.json();evidence.discovery=discovery;
 const keysResponse=await fetch(expected.jwksUri,{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
 evidence.jwksStatus=keysResponse.status;if(!keysResponse.ok)throw Error('REAL_JWKS_UNAVAILABLE');
 const jwks=await keysResponse.json();evidence.jwks=jwks;
 if(typeof cfg.public_key!=='string')throw Error('AUTHENTICATED_SIGNING_KEY_UNAVAILABLE');
 let authenticatedKey;try{authenticatedKey=cfg.public_key.includes('BEGIN CERTIFICATE')?new X509Certificate(cfg.public_key).publicKey:createPublicKey(cfg.public_key);}catch{throw Error('AUTHENTICATED_SIGNING_KEY_INVALID')}
 const pin=fingerprint(authenticatedKey);
 const candidates=(jwks.keys||[]).filter(j=>{try{return fingerprint(createPublicKey({key:j,format:'jwk'}))===pin;}catch{return false;}});
 if(candidates.length!==1)throw Error('JWKS_AUTHENTICATED_PIN_MISMATCH');
 const approvedKeys=[{kid:candidates[0].kid,spkiFingerprint:pin}];
 evidence.qualification=await qualifyPrivateMmfOidcProvider({...expected,approvedKeys});
 evidence.privateProviderQualified=true;evidence.gate='REAL_OIDC_CLIENT_AND_DISCOVERY_QUALIFIED_CLOSED_MFA_LOGIN_PENDING';
}catch(error){evidence.failure=/^[A-Z_]+$/.test(error.message)?error.message:'NETWORK_OR_PROVIDER_ERROR';}
finally{
 const k=randomBytes(32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',k,iv);const b=Buffer.concat([c.update(JSON.stringify(evidence)),c.final()]);
 const envelope={schema:'mmf-private-diagnostic-envelope-v1',algorithm:'RSA-OAEP-SHA256+AES-256-GCM',key:publicEncrypt({key:process.env.MMF_EVIDENCE_PUBLIC_KEY,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},k).toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:b.toString('base64')};k.fill(0);
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-oidc-registration.encrypted.json'),JSON.stringify(envelope),{mode:0o600,flag:'wx'});
 const summary={schema:evidence.schema,at:evidence.at,sourceSha:evidence.sourceSha,created:evidence.created,gate:evidence.gate,failure:evidence.failure,providerMetadataQualified:evidence.privateProviderQualified,realUserAuthenticated:false,realMfaAuthenticated:false,allowPoliciesCreated:0,dnsCreated:false,apiResults:evidence.requests.map(x=>({method:x.method,status:x.status,codes:x.codes}))};
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-oidc-registration-summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(summary));
 if(!evidence.privateProviderQualified)process.exitCode=2;
}
