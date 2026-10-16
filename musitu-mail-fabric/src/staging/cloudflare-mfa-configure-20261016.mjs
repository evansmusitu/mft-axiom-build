import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomBytes,createCipheriv,publicEncrypt,constants} from 'node:crypto';
const account='93f395f5121954671f92fffa453d6b61',host='mail-stage.mftintelligence.com';
const label='MUSITU Mail Fabric closed private stage (deny all)';
const token=process.env.CLOUDFLARE_API_TOKEN;
const evidence={schema:'mmf-organization-and-application-mfa-v1',at:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA,requests:[],mutations:[],before:{},after:{},gate:'MFA_NOT_VERIFIED'};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function api(path,method='GET',body){
 const r=await fetch('https://api.cloudflare.com/client/v4/'+path,{method,headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 const text=await r.text();if(text.length>1000000)throw Error('API_SIZE_LIMIT');
 let j;try{j=JSON.parse(text)}catch{j={}}
 evidence.requests.push({method,path,status:r.status,codes:(j.errors||[]).map(x=>x.code),messages:(j.errors||[]).map(x=>String(x.message||'').slice(0,500))});
 if(!r.ok||j.success!==true)throw Error(method+'_REJECTED');
 if(Number(j.result_info?.total_pages||1)>1)throw Error('INCOMPLETE_PAGINATION');
 return j.result;
}
const p='accounts/'+account+'/access/';
async function others(apps,id){
 const result=[];
 for(const a of apps.filter(x=>x.id!==id)){
  const [app,policies]=await Promise.all([api(p+'apps/'+a.id),api(p+'apps/'+a.id+'/policies?per_page=100')]);
  result.push({id:a.id,appHash:hash(app),policyHash:hash(policies),mfa:app.mfa_config??null,policyMfa:policies.map(x=>x.mfa_config??null)});
 }return result;
}
try{
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==account||!token||token.length<20)throw Error('AUTHORIZED_CONNECTION_UNAVAILABLE');
 const [zones,apps,org]=await Promise.all([api('zones?name=mftintelligence.com&per_page=100'),api(p+'apps?per_page=100'),api(p+'organizations')]);
 if(zones.length!==1||zones[0].account?.id!==account||zones[0].status!=='active')throw Error('ACCOUNT_ZONE_DRIFT');
 const mine=apps.filter(x=>x.name===label&&x.domain===host&&x.type==='self_hosted');
 if(mine.length!==1||apps.length!==4)throw Error('APP_INVENTORY_DRIFT');
 const id=mine[0].id;
 const [app,policies,dns,routes,domains]=await Promise.all([api(p+'apps/'+id),api(p+'apps/'+id+'/policies?per_page=100'),api('zones/'+zones[0].id+'/dns_records?name='+host+'&per_page=100'),api('zones/'+zones[0].id+'/workers/routes?per_page=100'),api('accounts/'+account+'/workers/domains?per_page=100')]);
 if(policies.length||dns.length||routes.some(x=>x.pattern?.includes(host)||x.pattern?.includes('*.mftintelligence.com'))||domains.some(x=>x.hostname===host))throw Error('CLOSED_STAGE_DRIFT');
 const baseline=await others(apps,id);evidence.before={organization:org,app,otherApplications:baseline};
 if(org.mfa_required_for_all_apps===true)throw Error('GLOBAL_MFA_ALREADY_REQUIRED_STOP');
 if(baseline.some(x=>x.mfa!==null||x.policyMfa.some(v=>v!==null)))throw Error('OTHER_MFA_IMPACT_UNCERTAIN');
 // Enable available enrollment methods; explicitly do not apply MFA globally.
 const existing=org.mfa_config?.allowed_authenticators||[];
 const allowed=[...new Set([...existing,'totp','security_key'])];
 const orgBody={...org,mfa_config:{...(org.mfa_config||{}),allowed_authenticators:allowed,session_duration:org.mfa_config?.session_duration||'15m'},mfa_required_for_all_apps:false};
 // GET includes response-only metadata and a disabled inactivity object with
 // null enum/integer fields. Those values are not valid PUT parameters.
 for(const k of ['created_at','updated_at','has_migrated_private_apps','trusted_accounts','cache_device_posture'])delete orgBody[k];
 if(orgBody.service_token_inactivity?.enabled===false&&orgBody.service_token_inactivity.action===null&&orgBody.service_token_inactivity.inactivity_threshold_days===null)delete orgBody.service_token_inactivity;
 if(!existing.includes('totp')||!existing.includes('security_key')){
  await api(p+'organizations','PUT',orgBody);evidence.mutations.push('organization_mfa_methods_enabled_global_enforcement_false');
 }
 const orgAfter=await api(p+'organizations');
 // Cloudflare omits the false default on GET. A true value is prohibited;
 // the write explicitly requests false and the MMF app is checked separately.
 if(orgAfter.mfa_required_for_all_apps===true||!orgAfter.mfa_config?.allowed_authenticators?.includes('totp')||!orgAfter.mfa_config?.allowed_authenticators?.includes('security_key'))throw Error('ORGANIZATION_MFA_READBACK_FAILED');
 const policyProjection=o=>Object.fromEntries(Object.entries(o).filter(([k])=>!['created_at','updated_at','mfa_config','mfa_required_for_all_apps'].includes(k)));
 if(hash(policyProjection(org))!==hash(policyProjection(orgAfter)))throw Error('UNRELATED_ORGANIZATION_SETTINGS_DRIFT');
 evidence.after.organization=orgAfter;
 const options={...app,mfa_config:{mfa_disabled:false,allowed_authenticators:['totp','security_key'],session_duration:'15m'}};
 delete options.allow_authenticate_via_warp;
 await api(p+'apps/'+id,'PUT',options);evidence.mutations.push('mmf_closed_app_mfa_required');
 const [verified,policiesAfter]=await Promise.all([api(p+'apps/'+id),api(p+'apps/'+id+'/policies?per_page=100')]);
 const after=await others(await api(p+'apps?per_page=100'),id);evidence.after.app=verified;evidence.after.otherApplications=after;
 if(hash(baseline)!==hash(after))throw Error('UNRELATED_CONFIGURATION_DRIFT');
 if(verified.domain!==host||policiesAfter.length||verified.mfa_config?.mfa_disabled!==false||verified.mfa_config?.session_duration!=='15m'||!verified.mfa_config?.allowed_authenticators?.includes('totp')||!verified.mfa_config?.allowed_authenticators?.includes('security_key'))throw Error('MMF_MFA_READBACK_FAILED');
 evidence.gate='MMF_MFA_CONFIGURED_CLOSED_NO_ALLOW_OR_INGRESS';
}catch(error){evidence.failure=/^[A-Z_]+$/.test(error.message)?error.message:'NETWORK_OR_API_ERROR';}
finally{
 const k=randomBytes(32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',k,iv);
 const bytes=Buffer.concat([c.update(JSON.stringify(evidence)),c.final()]);
 const envelope={schema:'mmf-private-diagnostic-envelope-v1',algorithm:'RSA-OAEP-SHA256+AES-256-GCM',key:publicEncrypt({key:process.env.MMF_EVIDENCE_PUBLIC_KEY,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},k).toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:bytes.toString('base64')};k.fill(0);
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-mfa-configuration.encrypted.json'),JSON.stringify(envelope),{mode:0o600,flag:'wx'});
 const summary={schema:evidence.schema,at:evidence.at,sourceSha:evidence.sourceSha,gate:evidence.gate,failure:evidence.failure,mutations:evidence.mutations,apiResults:evidence.requests.map(x=>({method:x.method,status:x.status,codes:x.codes})),allowPoliciesCreated:0,dnsCreated:false,realMfaAuthenticated:false,genuineOidcVerified:false};
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-mfa-configuration-summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({gate:evidence.gate,failure:evidence.failure,mutationCount:evidence.mutations.length,allowPoliciesCreated:0,dnsCreated:false}));
 if(evidence.gate!=='MMF_MFA_CONFIGURED_CLOSED_NO_ALLOW_OR_INGRESS')process.exitCode=2;
}
