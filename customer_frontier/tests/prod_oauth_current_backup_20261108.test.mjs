import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {sha,encryptBackup,catalogHash,RECIPIENT_SHA,NAME_SHA,CATALOG_SHA,DATABASE,API} from '../recovery/export_prod_oauth_current_backup_20261108.mjs';

const keypair=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const plaintext=Buffer.from("CREATE TABLE private_fixture(value TEXT); INSERT INTO private_fixture VALUES('PRIVATE_SQL_VALUE');");
const header={database_id:'synthetic',sql_sha256:sha(plaintext),sql_bytes:plaintext.length};
function decrypt(envelope){const e=JSON.parse(envelope);const key=privateDecrypt({key:keypair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(e.wrapped_key_b64,'base64'));const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.nonce_b64,'base64'));decipher.setAAD(Buffer.from(e.aad_b64,'base64'));decipher.setAuthTag(Buffer.from(e.tag_b64,'base64'));return Buffer.concat([decipher.update(Buffer.from(e.ciphertext_b64,'base64')),decipher.final()]);}
test('hybrid envelope roundtrip and ciphertext secrecy',()=>{const envelope=encryptBackup(plaintext,keypair.publicKey,header);assert.deepEqual(decrypt(envelope),plaintext);assert(!envelope.includes(Buffer.from('PRIVATE_SQL_VALUE')));});
test('tampered ciphertext or metadata fails authentication',()=>{for(const field of ['ciphertext_b64','aad_b64','tag_b64']){const e=JSON.parse(encryptBackup(plaintext,keypair.publicKey,header));const b=Buffer.from(e[field],'base64');b[0]^=1;e[field]=b.toString('base64');assert.throws(()=>decrypt(Buffer.from(JSON.stringify(e))));}});
test('random data key and nonce prevent deterministic ciphertext',()=>assert.notDeepEqual(encryptBackup(plaintext,keypair.publicKey,header),encryptBackup(plaintext,keypair.publicKey,header)));

// Replace ONLY the two immutable identity/catalog proof literals in a disposable
// fixture copy, as the actual provider catalog is deliberately not public.
// The production CLI source and recipient pin remain unchanged and are checked.
const rows=Array.from({length:33},(_,i)=>({type:'table',name:'synthetic_'+i,tbl_name:'synthetic_'+i,sql:'CREATE TABLE synthetic_'+i+'(value TEXT)'}));
const root=await mkdtemp(join(tmpdir(),'axiom-production-oauth-encrypted-backup-test-'));
const source=await readFile(new URL('../recovery/export_prod_oauth_current_backup_20261108.mjs',import.meta.url),'utf8');
assert.equal(source.split(NAME_SHA).length,2);assert.equal(source.split(CATALOG_SHA).length,2);
const fixtureSource=source.replace(NAME_SHA,sha('SYNTHETIC_DATABASE')).replace(CATALOG_SHA,catalogHash(rows));
const copy=join(root,'fixture.mjs');await writeFile(copy,fixtureSource,{mode:0o600});
const fixture=await import(pathToFileURL(copy));
const publicKey=await readFile(new URL('../recovery/recipient-20261106.pem',import.meta.url));
assert.equal(sha(publicKey),RECIPIENT_SHA);
async function run(change=()=>{},options={}){
 const inputs=[{success:true,result:{uuid:fixture.DATABASE,name:'SYNTHETIC_DATABASE',file_size:40960}},
  {success:true,result:[{success:true,meta:{changed_db:false,changes:0,rows_written:0},results:structuredClone(rows)}]},
  {success:true,result:{success:true,type:'export',status:'complete',result:{signed_url:'https://synthetic.r2.cloudflarestorage.com/private-export?signature=PRIVATE_SIGNATURE'}}},
  'PRIVATE_SQL_EXPORT'];change(inputs);const requests=[];
 const fetcher=async(url,opts)=>{requests.push({url,opts});if(inputs.length===0)throw Error('UNEXPECTED_REQUEST');const value=inputs.shift();return new Response(typeof value==='string'?value:JSON.stringify(value),{status:200});};
 let value,error;try{value=await fixture.exportBackup({token:'PRIVATE_TOKEN',publicKey,sourceSha:'a'.repeat(40),delay:async()=>{},fetcher,...options});}catch(e){error=e;}
 for(const {url,opts}of requests){assert.equal(opts.redirect,'error');if(url.startsWith(fixture.API)){assert.equal(opts.headers.Authorization,'Bearer PRIVATE_TOKEN');assert(['GET','POST'].includes(opts.method));if(url.endsWith('/query'))assert.deepEqual(JSON.parse(opts.body),{sql:fixture.SQL,params:[]});if(url.endsWith('/export')){const body=JSON.parse(opts.body);assert.deepEqual(body.dump_options,{compatibility:'d1'});assert.equal(body.output_format,'polling');}}else{assert.equal(opts.method,'GET');assert(!opts.headers);}}
 const output=JSON.stringify(value?.receipt||error?.receipt);for(const secret of ['PRIVATE_TOKEN','SYNTHETIC_DATABASE','PRIVATE_SQL_EXPORT','PRIVATE_SIGNATURE','synthetic_'])assert(!output.includes(secret));
 for(const flag of ['backup_saved_to_drive','restore_qualified','hosted_migration_qualified','target_admitted','release_authority'])assert.equal((value?.receipt||error.receipt)[flag],false);
 return {value,error,requests};
}
test('fixed export pipeline encrypts without leaking SQL or signed URL',async()=>{const {value,error,requests}=await run();assert.equal(error,undefined);assert.equal(requests.length,4);assert(value.receipt.export_complete);assert(!value.envelope.includes(Buffer.from('PRIVATE_SQL_EXPORT')));assert.equal(sha(value.envelope),value.receipt.envelope_sha256);});
test('name drift stops before catalog or export',async()=>{const {error,requests}=await run(d=>{d[0].result.name='different';});assert.equal(error.message,'DATABASE_IDENTITY_OR_SIZE_DRIFT');assert.equal(requests.length,1);});
test('catalog drift and contradictory counters stop before export',async()=>{for(const mutate of [d=>{d[1].result[0].results[0].sql+=' ';},d=>{d[1].result[0].meta.changed_db=true;},d=>{delete d[1].result[0].meta.rows_written;},d=>{d[1].result[0].meta.changes=false;}]){const {error,requests}=await run(mutate);assert(error);assert.equal(requests.length,2);}});
test('wrong recipient, missing token or source make zero provider calls',async()=>{for(const options of [{token:''},{publicKey:Buffer.from('invalid')},{sourceSha:'bad'}]){const {error,requests}=await run(()=>{},options);assert(error);assert.equal(requests.length,0);}});
test('non-HTTPS, credentials and unknown download origins fail before download',async()=>{for(const signed_url of ['http://synthetic.r2.cloudflarestorage.com/','https://evil.example/','https://user:pass@synthetic.r2.cloudflarestorage.com/']){const {error,requests}=await run(d=>{d[2].result.result.signed_url=signed_url;});assert.equal(error.message,'UNQUALIFIED_EXPORT_DOWNLOAD_ORIGIN');assert.equal(requests.length,3);}});
test('export refusal or unknown result never downloads',async()=>{for(const result of [{success:false},{success:true,status:'error'},{success:true,type:'other'},{success:true,at_bookmark:''}]){const {error,requests}=await run(d=>{d[2].result=result;});assert(error);assert.equal(requests.length,3);}});
test('empty SQL and oversized metadata do not produce an envelope',async()=>{const one=await run(d=>{d[3]='';});assert.equal(one.error.message,'EMPTY_EXPORT');const two=await run(d=>{d[0].result.file_size=16777217;});assert.equal(two.error.message,'DATABASE_IDENTITY_OR_SIZE_DRIFT');});
test.after(async()=>{await rm(root,{recursive:true,force:true});});

test('production OAuth identity is pinned; fixture cannot reach staging or import',()=>{
 assert.equal(DATABASE,'504029cc-f9a5-495e-818f-63c6144b4ea4');
 assert.equal(API,'https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/d1/database/'+DATABASE);
 assert(!API.includes('ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'));
 assert(source.includes("rows.length!==33"));
 assert(source.includes('sha(JSON.stringify(rows))'));
 assert(!source.includes("'/import'"));
});
