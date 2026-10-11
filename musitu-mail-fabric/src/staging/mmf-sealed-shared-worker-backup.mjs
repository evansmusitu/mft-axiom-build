/**
 * Offline-capable, GET-only capture of EXACT Cloudflare worker source response
 * and settings; source/settings NEVER leave the runner except AES-GCM ciphertext.
 * The RSA private recovery key is generated/stored entirely outside GitHub.
 * Cloudflare secret_text values are NONEXPORTABLE and not restored by this.
 */
import {createHash,createCipheriv,createDecipheriv,publicEncrypt,privateDecrypt,
 randomBytes,constants,createPublicKey} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalCloudflareWorkerSource} from './canonical-cloudflare-worker-source.mjs';
export const MMF_BACKUP_SCHEMA='mmf-shared-paynow-encrypted-source-settings-v1';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const NAMES=Object.freeze(['mft-phase8-external-authority','mft-paynow-transport-gateway']);
const BASE=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/`;
const DENIED='MMF_SHARED_WORKER_BACKUP_DENIED';
const hash=x=>createHash('sha256').update(x).digest('hex');
const deny=()=>{throw Error(DENIED)};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const keys=(x,k)=>plain(x)&&Object.keys(x).length===k.length&&k.every(y=>Object.hasOwn(x,y));
function parseBase64(s,max){
 if(typeof s!=='string'||s.length>max||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))deny();
 return Buffer.from(s,'base64');
}
export async function captureMmfSharedWorkerBackup({accountId,token,publicKeyPem,fetchImpl=globalThis.fetch}={}){
 try{
  if(accountId!==ACCOUNT||typeof token!=='string'||token.length<20||token.length>500||
   typeof publicKeyPem!=='string'||publicKeyPem.length>5000||typeof fetchImpl!=='function')deny();
  const pub=createPublicKey(publicKeyPem);
  if(pub.asymmetricKeyType!=='rsa'||pub.asymmetricKeyDetails?.modulusLength<2048)deny();
  const recoveryFingerprint=hash(pub.export({format:'der',type:'spki'}));
  const headers={authorization:`Bearer ${token}`,accept:'application/json','cache-control':'no-store'};
  const GET=async suffix=>{
   const res=await fetchImpl(BASE+suffix,{method:'GET',headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!(res instanceof Response)||!res.ok)deny();
   const contentType=res.headers.get('content-type')||'';
   const length=res.headers.get('content-length');
   if(length!==null&&(!/^\d+$/.test(length)||Number(length)>2_000_000))deny();
   const bytes=Buffer.from(await res.arrayBuffer());
   if(bytes.length<20||bytes.length>2_000_000)deny();
   return {bytes,contentType};
  };
  const workers=[];
  for(const name of NAMES){
   const raw=await GET(name),again=await GET(name);
   const canonical=await canonicalCloudflareWorkerSource(new Response(raw.bytes,{headers:{'content-type':raw.contentType}}));
   const repeat=await canonicalCloudflareWorkerSource(new Response(again.bytes,{headers:{'content-type':again.contentType}}));
   if(canonical.sourceSha256!==repeat.sourceSha256)deny();
   const settings=await GET(name+'/settings');
   if(!/^application\/json(?:\s*;|\s*$)/i.test(settings.contentType))deny();
   const obj=JSON.parse(settings.bytes.toString('utf8'));
   if(obj?.success!==true||!Array.isArray(obj.result?.bindings)||
     obj.result.bindings.length>150||
     obj.result.bindings.some(b=>!plain(b)||typeof b.name!=='string'||b.name.length>100))deny();
   workers.push({name,contentType:raw.contentType,rawSourceBase64:raw.bytes.toString('base64'),
    rawSourceSha256:hash(raw.bytes),normalizedSourceSha256:canonical.sourceSha256,
    sourceRepresentation:canonical.multipartNormalized?'cloudflare-multipart':'single-script',
    settings:obj,settingsSha256:hash(settings.bytes)});
  }
  const backup={schema:MMF_BACKUP_SCHEMA,accountId:ACCOUNT,workerCount:2,
   method:'GET',cloudflareMutationCount:0,secretValuesExported:false,
   secretBindingsRestorable:false,workers};
  const clear=Buffer.from(JSON.stringify(backup),'utf8');
  if(clear.length>5_000_000)deny();
  const aesKey=randomBytes(32),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',aesKey,iv);
  const encrypted=Buffer.concat([cipher.update(clear),cipher.final()]);
  const sealed=Object.freeze({schema:MMF_BACKUP_SCHEMA,algorithm:'AES-256-GCM+RSA-OAEP-SHA256',
   recipientPublicKeyFingerprint:recoveryFingerprint,nonceBase64:iv.toString('base64'),
   tagBase64:cipher.getAuthTag().toString('base64'),
   keyCiphertextBase64:publicEncrypt({key:pub,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},aesKey).toString('base64'),
   ciphertextBase64:encrypted.toString('base64')});
  aesKey.fill(0);clear.fill(0);
  const summary=Object.freeze({schema:MMF_BACKUP_SCHEMA,gate:'MMF_SHARED_WORKER_SOURCE_SETTINGS_SEALED_GET_ONLY',
   workerCount:2,normalizedSha256ByWorker:Object.fromEntries(workers.map(w=>[w.name,w.normalizedSourceSha256])),
   readOnlyGetCount:6,cloudflareMutationCount:0,secretValuesExported:false,
   secretBindingsRestorable:false,exactSourceSettingsEncrypted:true,merchantEligibilityProven:false,
   preProductionRestoreTestPerformed:false,independentReleaseApproved:false,
   recoveryPublicKeyFingerprint:recoveryFingerprint});
  return {sealed,summary};
 }catch{deny()}
}
export function unsealMmfSharedWorkerBackup(sealed,privateKeyPem){
 try{
  if(!keys(sealed,['schema','algorithm','recipientPublicKeyFingerprint','nonceBase64','tagBase64','keyCiphertextBase64','ciphertextBase64'])||
   sealed.schema!==MMF_BACKUP_SCHEMA||sealed.algorithm!=='AES-256-GCM+RSA-OAEP-SHA256'||
   typeof sealed.recipientPublicKeyFingerprint!=='string')deny();
  const publicKey=createPublicKey(privateKeyPem);
  if(hash(publicKey.export({format:'der',type:'spki'}))!==sealed.recipientPublicKeyFingerprint)deny();
  const iv=parseBase64(sealed.nonceBase64,20),tag=parseBase64(sealed.tagBase64,24);
  if(iv.length!==12||tag.length!==16)deny();
  const key=privateDecrypt({key:privateKeyPem,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},parseBase64(sealed.keyCiphertextBase64,1024));
  if(key.length!==32)deny();
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
  const clear=Buffer.concat([decipher.update(parseBase64(sealed.ciphertextBase64,7_000_000)),decipher.final()]);
  key.fill(0);
  const obj=JSON.parse(clear.toString('utf8'));clear.fill(0);
  if(obj.schema!==MMF_BACKUP_SCHEMA||obj.accountId!==ACCOUNT||obj.workerCount!==2||obj.method!=='GET'||
   obj.cloudflareMutationCount!==0||obj.secretValuesExported!==false||obj.secretBindingsRestorable!==false||
   !Array.isArray(obj.workers)||obj.workers.length!==2||obj.workers.some((w,i)=>{
    if(w.name!==NAMES[i]||typeof w.contentType!=='string'||typeof w.rawSourceSha256!=='string')return true;
    const raw=parseBase64(w.rawSourceBase64,4_000_000);
    return hash(raw)!==w.rawSourceSha256||w.settings?.success!==true||!Array.isArray(w.settings?.result?.bindings);
   }))deny();
  return obj;
 }catch{deny()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--capture')deny();
 const pub=readFileSync(new URL('../../backup-public-keys/mmf-shared-paynow-20261011.pub.pem',import.meta.url),'utf8');
 const x=await captureMmfSharedWorkerBackup({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,publicKeyPem:pub});
 const dir=process.env.RUNNER_TEMP;if(!dir)deny();mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'mmf-shared-paynow-restore-source.sealed.json'),JSON.stringify(x.sealed)+'\n',{mode:0o600,flag:'wx'});
 writeFileSync(join(dir,'mmf-shared-paynow-restore-manifest.json'),JSON.stringify(x.summary,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({gate:x.summary.gate,workerCount:x.summary.workerCount,
  readOnlyGetCount:6,cloudflareMutationCount:0,secretValuesExported:false,
  secretBindingsRestorable:false,recoveryPublicKeyFingerprint:x.summary.recoveryPublicKeyFingerprint}));
}