import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {generateKeyPairSync,randomBytes,hkdfSync,createCipheriv,createDecipheriv,privateDecrypt,publicEncrypt,constants,createHash} from 'node:crypto';

const account='93f395f5121954671f92fffa453d6b61';
const idp='ec04a8ab-9382-4df0-9589-d2c98618e6af';
const label='MUSITU Mail Fabric administrator MFA enrollment';
// Cloudflare assigns its singleton launcher the fixed display name App Launcher.
// This ID was returned by our successful scoped creation, never inferred by name.
const ownedLauncherId='9dfc2a78-0dae-463b-9235-03ae134be007';
const closedIds=['f8ab12fe-251f-44fa-80de-1c2f2bdc4055','4ae515a1-189d-41c2-8020-c99ea157b021'];
const scope='mmf-enrollment-only:v1:evansmusitu/mft-axiom-build:product/musitu-mail-fabric-isolated-20261009:'+account;
const token=process.env.CLOUDFLARE_API_TOKEN;
const evidence={schema:'mmf-enrollment-launcher-v1',observedAt:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA,requests:[],created:false,policyCreated:false,verified:false};
function pack(bytes,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([c.update(bytes),c.final()]);return {iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:c.getAuthTag().toString('base64')};}
function unpack(e,key){const d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));return Buffer.concat([d.update(Buffer.from(e.ciphertext,'base64')),d.final()]);}
const wrapKey=salt=>Buffer.from(hkdfSync('sha256',Buffer.from(token),Buffer.from(salt,'base64'),Buffer.from(scope),32));
async function api(path,method='GET',body){
 const r=await fetch('https://api.cloudflare.com/client/v4/'+path,{method,headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 const text=await r.text();if(text.length>2000000)throw Error('API_RESPONSE_SIZE');let j;try{j=JSON.parse(text)}catch{j={}}
 evidence.requests.push({operation:path.includes('/policies')?'policies':path.includes('/apps')?'apps':'preflight',method,status:r.status,codes:(j.errors||[]).map(x=>x.code)});
 if(!r.ok||j.success!==true)throw Error('API_REQUEST_DENIED');if(Number(j.result_info?.total_pages||1)>1)throw Error('PAGINATION_INCOMPLETE');return j.result;
}
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).filter(k=>!['created_at','updated_at'].includes(k)).sort().map(k=>[k,canonical(x[k])]));return x;}
const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
async function snapshot(){
 const apps=await api('accounts/'+account+'/access/apps?per_page=100');const out={};
 for(const app of apps.filter(x=>x.type!=='app_launcher')){
  const [a,p]=await Promise.all([api('accounts/'+account+'/access/apps/'+app.id),api('accounts/'+account+'/access/apps/'+app.id+'/policies?per_page=100')]);
  if(closedIds.includes(app.id)&&(!Array.isArray(p)||p.length||a.mfa_config?.mfa_disabled!==false))throw Error('MMF_CLOSED_MFA_DRIFT');
  out[app.id]=digest({app:a,policies:p});
 }
 if(!closedIds.every(id=>out[id]))throw Error('MMF_APPS_MISSING');return out;
}
try{
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==account||!token||token.length<20)throw Error('AUTHORIZED_CONNECTION_UNAVAILABLE');
 const [zones,org,providers,apps]=await Promise.all([api('zones?name=mftintelligence.com&per_page=50'),api('accounts/'+account+'/access/organizations'),api('accounts/'+account+'/access/identity_providers?per_page=100'),api('accounts/'+account+'/access/apps?per_page=100')]);
 if(zones.length!==1||zones[0].account?.id!==account||zones[0].status!=='active'||org.auth_domain!=='musitu-axiom.cloudflareaccess.com')throw Error('ACCOUNT_ZONE_DRIFT');
 if(!org.mfa_config?.allowed_authenticators?.includes('totp')||!org.mfa_config?.allowed_authenticators?.includes('security_key'))throw Error('ORGANIZATION_MFA_UNAVAILABLE');
 if(!providers.some(x=>x.id===idp&&x.type==='cloudflare'&&x.config?.restrict_to_account_members===true))throw Error('APPROVED_IDP_DRIFT');
 const launchers=apps.filter(x=>x.type==='app_launcher');if(launchers.length>1||launchers.some(x=>x.id!==ownedLauncherId||!['App Launcher',label].includes(x.name)))throw Error('EXISTING_SHARED_LAUNCHER_REQUIRES_REVIEW');
 evidence.before=await snapshot();
 if(process.env.MMF_ENROLLMENT_MODE==='prepare'){
  // Transfer key is not an identity credential. Seal it with a token-derived,
  // purpose-separated key so the approved address need never enter public text.
  const pair=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const salt=randomBytes(32).toString('base64'),key=wrapKey(salt);
  const transfer={schema:'mmf-enrollment-transfer-v1',scope,expiresAt:Date.now()+7200000,publicKey:pair.publicKey,salt,sealedPrivateKey:pack(Buffer.from(pair.privateKey),key)};key.fill(0);
  writeFileSync(join(process.env.RUNNER_TEMP,'mmf-enrollment-transfer.json'),JSON.stringify(transfer),{mode:0o600,flag:'wx'});evidence.transferPrepared=true;
 }else if(process.env.MMF_ENROLLMENT_MODE==='configure'){
  const input=JSON.parse(readFileSync(new URL('./mmf-enrollment-input.encrypted.json',import.meta.url)));
  const t=input.transfer;
  if(t?.schema!=='mmf-enrollment-transfer-v1'||t.scope!==scope||!Number.isSafeInteger(t.expiresAt)||t.expiresAt<Date.now()||t.expiresAt>Date.now()+7200000)throw Error('TRANSFER_SCOPE_OR_EXPIRY_DENIED');
  const key=wrapKey(t.salt),pem=unpack(t.sealedPrivateKey,key);key.fill(0);
  let payload;try{payload=JSON.parse(privateDecrypt({key:pem,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(input.ciphertext,'base64')));}finally{pem.fill(0);}
  if(payload.scope!==scope||payload.expiresAt!==t.expiresAt||Object.keys(payload).sort().join(',')!=='email,expiresAt,scope'||typeof payload.email!=='string'||!/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(payload.email)||payload.email.length>254)throw Error('APPROVED_INPUT_INVALID');
  const email=payload.email.toLowerCase();
  const policy={name:'MMF sole administrator enrollment only',decision:'allow',include:[{email:{email}}],require:[{login_method:{id:idp}}],exclude:[],session_duration:'15m'};
  let launcher=launchers[0];
  if(!launcher){launcher=await api('accounts/'+account+'/access/apps','POST',{type:'app_launcher',name:label,allowed_idps:[idp],auto_redirect_to_identity:true,session_duration:'15m',policies:[]});evidence.created=true;}
  evidence.launcherId=launcher.id;
  const path='accounts/'+account+'/access/apps/'+launcher.id;
  let policies=await api(path+'/policies?per_page=100');
  const exactPolicy=p=>p.decision==='allow'&&JSON.stringify(canonical(p.include))===JSON.stringify(canonical(policy.include))&&JSON.stringify(canonical(p.require))===JSON.stringify(canonical(policy.require))&&!(p.exclude||[]).length&&p.session_duration==='15m';
  if(policies.length===0){await api(path+'/policies','POST',policy);evidence.policyCreated=true;}
  else if(policies.length!==1||!exactPolicy(policies[0]))throw Error('EXISTING_LAUNCHER_POLICY_DRIFT');
  const [readback,readPolicies]=await Promise.all([api(path),api(path+'/policies?per_page=100')]);
  evidence.launcher=readback;evidence.policies=readPolicies;
  if(readback.type!=='app_launcher'||readback.id!==ownedLauncherId||readback.domain!==org.auth_domain||!['App Launcher',label].includes(readback.name)||JSON.stringify(readback.allowed_idps)!==JSON.stringify([idp])||readback.session_duration!=='15m'||readPolicies.length!==1||!exactPolicy(readPolicies[0]))throw Error('LAUNCHER_READBACK_MISMATCH');
  evidence.after=await snapshot();
  if(JSON.stringify(canonical(evidence.before))!==JSON.stringify(canonical(evidence.after)))throw Error('UNRELATED_OR_CLOSED_APP_DRIFT');
  evidence.approvedAdministrator=email;evidence.verified=true;evidence.mmfAppsStillClosed=true;
 }else throw Error('MODE_DENIED');
}catch(error){evidence.failure=/^[A-Z_]+$/.test(error.message)?error.message:'ENROLLMENT_OPERATION_FAILED';process.exitCode=2;}
finally{
 const k=randomBytes(32),box=pack(Buffer.from(JSON.stringify(evidence)),k);
 const envelope={schema:'mmf-private-diagnostic-envelope-v1',algorithm:'RSA-OAEP-SHA256+AES-256-GCM',key:publicEncrypt({key:process.env.MMF_EVIDENCE_PUBLIC_KEY,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},k).toString('base64'),...box};k.fill(0);
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-enrollment-evidence.encrypted.json'),JSON.stringify(envelope),{mode:0o600,flag:'wx'});
 const summary={sourceSha:evidence.sourceSha,observedAt:evidence.observedAt,transferPrepared:evidence.transferPrepared===true,created:evidence.created,policyCreated:evidence.policyCreated,verified:evidence.verified,mmfAppsStillClosed:evidence.mmfAppsStillClosed===true,failure:evidence.failure,requests:evidence.requests};
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-enrollment-summary.json'),JSON.stringify(summary,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(summary));
}
