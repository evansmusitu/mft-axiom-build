/** Offline operator intake. Requires trusted hash from actual Actions evidence.
 * Authenticated encryption alone does not authenticate an export's origin.
 */
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createPrivateKey,createPublicKey,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {DATABASE,CATALOG_SHA,RECIPIENT_SHA,sha} from './export_existing_d1_backup.mjs';

export function decrypt(envelope,privateKey,{expectedEnvelopeSha,expectedSourceSha,expectedRecipientSha=RECIPIENT_SHA}={}){
 const fail=()=>{throw new Error('ENVELOPE_PROVENANCE_OR_AUTHENTICATION_FAILED');};
 if(!Buffer.isBuffer(envelope)||envelope.length>12_000_000||!/^[0-9a-f]{64}$/.test(expectedEnvelopeSha||'')||sha(envelope)!==expectedEnvelopeSha||!/^[0-9a-f]{40}$/.test(expectedSourceSha||''))fail();
 const object=JSON.parse(envelope.toString('utf8'));
 if(!object||Array.isArray(object)||Object.keys(object).sort().join(',')!=='aad_b64,algorithm,ciphertext_b64,nonce_b64,schema,tag_b64,wrapped_key_b64'||object.schema!=='musitu.axiom.encrypted_d1_backup.v1'||object.algorithm!=='RSA-OAEP-SHA256+AES-256-GCM')fail();
 function decoded(value){if(typeof value!=='string'||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail();const b=Buffer.from(value,'base64');if(b.toString('base64')!==value)fail();return b;}
 const aad=decoded(object.aad_b64),nonce=decoded(object.nonce_b64),tag=decoded(object.tag_b64),wrapped=decoded(object.wrapped_key_b64),ciphertext=decoded(object.ciphertext_b64);
 if(aad.length>4096||nonce.length!==12||tag.length!==16||wrapped.length!==512||ciphertext.length===0||ciphertext.length>8_000_000)fail();
 const header=JSON.parse(aad.toString('utf8'));
 if(!header||Array.isArray(header)||Object.keys(header).sort().join(',')!=='catalog_sha256,created_at,database_id,recipient_public_sha256,schema,source_sha,sql_bytes,sql_sha256'||header.schema!=='musitu.axiom.d1_logical_export.v1'||header.database_id!==DATABASE||header.catalog_sha256!==CATALOG_SHA||header.recipient_public_sha256!==expectedRecipientSha||header.source_sha!==expectedSourceSha||!Number.isSafeInteger(header.sql_bytes)||header.sql_bytes!==ciphertext.length||!/^[0-9a-f]{64}$/.test(header.sql_sha256)||typeof header.created_at!=='string'||!Number.isFinite(Date.parse(header.created_at)))fail();
 const privateObject=createPrivateKey(privateKey),publicPem=createPublicKey(privateObject).export({type:'spki',format:'pem'});
 if(privateObject.asymmetricKeyType!=='rsa'||privateObject.asymmetricKeyDetails?.modulusLength!==4096||sha(publicPem)!==expectedRecipientSha)fail();
 const key=privateDecrypt({key:privateObject,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},wrapped);
 try{
  if(key.length!==32)fail();const d=createDecipheriv('aes-256-gcm',key,nonce);d.setAAD(aad);d.setAuthTag(tag);const sql=Buffer.concat([d.update(ciphertext),d.final()]);
  if(sql.length!==header.sql_bytes||sha(sql)!==header.sql_sha256){sql.fill(0);fail();}return {sql,header};
 }finally{key.fill(0);}
}
async function main(){
 let sql;
 try{
  const args=process.argv.slice(2);if(args.length!==6)throw Error('INVALID_INTAKE_ARGUMENTS');
  const [encryptedPath,keyPath,expectedEnvelopeSha,expectedSourceSha,outputPath,receiptPath]=args;
  if((await stat(encryptedPath)).size>12_000_000)throw Error('EXPORT_TOO_LARGE');
  const recovered=decrypt(await readFile(encryptedPath),await readFile(keyPath),{expectedEnvelopeSha,expectedSourceSha});sql=recovered.sql;
  const child=spawnSync('python3',[fileURLToPath(new URL('./restore_sql_private.py',import.meta.url)),'--output',outputPath],{input:sql,timeout:30000,maxBuffer:1_000_000,env:{PATH:process.env.PATH}});
  sql.fill(0);sql=undefined;if(child.status!==0)throw Error('PRIVATE_LOCAL_RESTORE_FAILED');
  const proof=JSON.parse(child.stdout.toString('utf8'));if(proof.status!=='LOCAL_USER_SQL_RESTORE_VERIFIED')throw Error('PRIVATE_LOCAL_RESTORE_FAILED');
  const receipt={...proof,database_id:DATABASE,envelope_sha256:expectedEnvelopeSha,source_sha:expectedSourceSha,recipient_public_sha256:RECIPIENT_SHA,sql_sha256:recovered.header.sql_sha256,sql_bytes:recovered.header.sql_bytes,independent_custody_qualified:false};
  await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(receipt));
 }catch{if(sql)sql.fill(0);console.log(JSON.stringify({status:'PRIVATE_LOCAL_RESTORE_FAILED_UNKNOWN',hosted_restore_qualified:false,target_admitted:false,release_authority:false}));process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
