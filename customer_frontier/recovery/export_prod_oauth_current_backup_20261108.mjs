/** Fixed CURRENT 33-object production OAuth component logical export, encrypted in memory to owner's existing recipient. No restore authorization.
 * No import, DELETE, database creation, schema or deployment operation exists.
 */
import {createHash,createCipheriv,publicEncrypt,randomBytes,constants,createPublicKey} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const DATABASE='504029cc-f9a5-495e-818f-63c6144b4ea4';
export const NAME_SHA='b0d9b8d70e3736276b018cc196c1ba823a15b43921b6493e63d95941ea199ef6';
export const CATALOG_SHA='56c70460aecf66af4eab25d4c7e363efb0a76866f788bcd5ae70f52a0f3e7ee1';
export const RECIPIENT_SHA='d97bd50654cd7a02c55d25ebce421e1fc31642f1c4a57d2a24eafe9f5e328fd3';
export const API='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/d1/database/'+DATABASE;
export const SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
export const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new Error(code);};
const asciiJSON=value=>JSON.stringify(value).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export function catalogHash(rows){return sha(JSON.stringify(rows));}
export function encryptBackup(sql,publicKey,header){
 const key=randomBytes(32),nonce=randomBytes(12),aad=Buffer.from(JSON.stringify(header));
 const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);
 const ciphertext=Buffer.concat([cipher.update(sql),cipher.final()]);
 const wrapped=publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);key.fill(0);
 return Buffer.from(JSON.stringify({schema:'musitu.axiom.encrypted_d1_backup.v1',algorithm:'RSA-OAEP-SHA256+AES-256-GCM',aad_b64:aad.toString('base64'),wrapped_key_b64:wrapped.toString('base64'),nonce_b64:nonce.toString('base64'),tag_b64:cipher.getAuthTag().toString('base64'),ciphertext_b64:ciphertext.toString('base64')})+'\n');
}
async function boundedBody(response,max){
 if(!response.body||!response.body.getReader)fail('MISSING_RESPONSE_BODY');
 const reader=response.body.getReader(),chunks=[];let count=0;
 try{for(;;){const next=await reader.read();if(next.done)break;count+=next.value.byteLength;if(count>max)fail('RESPONSE_TOO_LARGE');chunks.push(Buffer.from(next.value));}}
 finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks);
}
export async function exportBackup({token,publicKey,fetcher=fetch,clock=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),sourceSha}={}){
 const receipt={schema:'musitu.axiom.prod_oauth_backup_export.v1',database_id:DATABASE,source_sha:sourceSha,
  recipient_public_sha256:RECIPIENT_SHA,transport:[],catalog_read_zero_writes:false,export_started:false,export_complete:false,
  backup_saved_to_drive:false,restore_qualified:false,hosted_migration_qualified:false,target_admitted:false,release_authority:false};
 const deadline=clock()+180000;
 const error=code=>{const e=new Error(code);e.receipt=receipt;throw e;};
 try{
  if(typeof sourceSha!=='string'||!/^[0-9a-f]{40}$/.test(sourceSha))error('INVALID_SOURCE_PROVENANCE');
  if(typeof token!=='string'||!token||/[\r\n]/.test(token))error('MISSING_OR_INVALID_TOKEN');
  if(!publicKey||sha(publicKey)!==RECIPIENT_SHA)error('RECIPIENT_MISMATCH');
  const recipient=createPublicKey(publicKey);
  if(recipient.asymmetricKeyType!=='rsa'||recipient.asymmetricKeyDetails?.modulusLength!==4096)error('INVALID_RECIPIENT_KEY');
  async function request(kind,body){
   if(receipt.transport.length>=14||clock()>=deadline)error('REQUEST_BUDGET_EXHAUSTED');
   const path=kind==='metadata'?'':kind==='catalog'?'/query':kind==='export'?'/export':null;
   if(path===null)error('UNADMITTED_REQUEST');
   const trace={kind,method:body===undefined?'GET':'POST',http_status:null,provider_error_codes:[]};receipt.transport.push(trace);
   const response=await fetcher(API+path,{method:trace.method,redirect:'error',signal:AbortSignal.timeout(Math.min(20000,deadline-clock())),headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   trace.http_status=response.status;
   const raw=await boundedBody(response,2_000_000);let data;
   try{data=JSON.parse(raw.toString('utf8'));}catch{error('INVALID_PROVIDER_JSON');}
   if(Array.isArray(data?.errors))trace.provider_error_codes=data.errors.filter(v=>v&&Number.isSafeInteger(v.code)&&v.code>=1000&&v.code<=2147483647).slice(0,20).map(v=>v.code);
   if(response.status!==200||!data||data.success!==true)error('PROVIDER_FAILURE');
   return data.result;
  }
  const metadata=await request('metadata');
  if(!metadata||metadata.uuid!==DATABASE||typeof metadata.name!=='string'||sha(metadata.name)!==NAME_SHA||!Number.isSafeInteger(metadata.file_size)||metadata.file_size<1||metadata.file_size>16777216)error('DATABASE_IDENTITY_OR_SIZE_DRIFT');
  const catalog=await request('catalog',{sql:SQL,params:[]});
  if(!Array.isArray(catalog)||catalog.length!==1||catalog[0]?.success!==true)error('INVALID_CATALOG_RESPONSE');
  const meta=catalog[0].meta;
  if(meta?.changed_db!==false||meta.changes!==0||meta.rows_written!==0)error('CATALOG_ZERO_WRITES_NOT_CONFIRMED');
  receipt.catalog_read_zero_writes=true;
  const rows=catalog[0].results;
  if(!Array.isArray(rows)||rows.length!==33||rows.some(v=>!v||Array.isArray(v)||Object.keys(v).sort().join(',')!=='name,sql,tbl_name,type')||catalogHash(rows)!==CATALOG_SHA)error('CATALOG_DRIFT');
  let bookmark,result;
  for(let attempt=0;attempt<10;attempt++){
   receipt.export_started=true;
   result=await request('export',{output_format:'polling',dump_options:{compatibility:'d1'},...(bookmark===undefined?{}:{current_bookmark:bookmark})});
   if(!result||result.success!==true||result.status==='error'||result.type!==undefined&&result.type!=='export')error('EXPORT_REJECTED');
   if(result.status==='complete')break;
   if(typeof result.at_bookmark!=='string'||!result.at_bookmark||result.at_bookmark.length>4096||bookmark!==undefined&&result.at_bookmark!==bookmark)error('INVALID_EXPORT_BOOKMARK');
   bookmark=result.at_bookmark;await delay(250);
  }
  if(result?.status!=='complete')error('EXPORT_NOT_COMPLETE');
  const signed=result.result?.signed_url;let uri;
  try{uri=new URL(signed);}catch{error('INVALID_EXPORT_DOWNLOAD_URL');}
  if(uri.protocol!=='https:'||uri.username||uri.password||uri.port||!(uri.hostname.endsWith('.r2.cloudflarestorage.com')||uri.hostname.endsWith('.cloudflare.com')))error('UNQUALIFIED_EXPORT_DOWNLOAD_ORIGIN');
  if(clock()>=deadline)error('REQUEST_BUDGET_EXHAUSTED');
  const downloadTrace={kind:'encrypted_export_download',method:'GET',http_status:null,provider_error_codes:[]};receipt.transport.push(downloadTrace);
  const downloaded=await fetcher(signed,{method:'GET',redirect:'error',signal:AbortSignal.timeout(Math.min(30000,deadline-clock()))});downloadTrace.http_status=downloaded.status;
  if(downloaded.status!==200)error('EXPORT_DOWNLOAD_FAILED');
  const sql=await boundedBody(downloaded,8_000_000);if(sql.length===0)error('EMPTY_EXPORT');
  const header={schema:'musitu.axiom.d1_logical_export.v1',database_id:DATABASE,source_sha:sourceSha,created_at:new Date(clock()).toISOString(),catalog_sha256:CATALOG_SHA,recipient_public_sha256:RECIPIENT_SHA,sql_bytes:sql.length,sql_sha256:sha(sql)};
  const envelope=encryptBackup(sql,publicKey,header);sql.fill(0);
  receipt.export_complete=true;receipt.envelope_bytes=envelope.length;receipt.envelope_sha256=sha(envelope);receipt.catalog_sha256=CATALOG_SHA;
  return {envelope,receipt};
 }catch(e){if(e.receipt)throw e;error('BACKUP_EXPORT_UNAVAILABLE');}
}
async function main(){
 let receipt;
 try{
  const {envelope,receipt:r}=await exportBackup({token:process.env.CLOUDFLARE_API_TOKEN,publicKey:await readFile(new URL('./recipient-20261106.pem',import.meta.url)),sourceSha:process.env.AXIOM_CHECKOUT_SHA});receipt=r;
  await writeFile('prod-oauth-current-20261108.json.enc',envelope,{flag:'wx',mode:0o600});
 }catch(e){receipt={...(e.receipt||receipt||{}),error:e.receipt?e.message:'BACKUP_EXPORT_UNAVAILABLE'};process.exitCode=1;}
 await writeFile('prod-oauth-current-backup-receipt.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
