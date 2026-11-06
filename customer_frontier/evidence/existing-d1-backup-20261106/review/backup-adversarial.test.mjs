import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {generateKeyPairSync,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const sourcePath=resolve(root,'existing-d1-recovery/customer_frontier/recovery/export_existing_d1_backup.mjs');
const original=await import(pathToFileURL(sourcePath));
const raw=await readFile(sourcePath,'utf8');
const rows=Array.from({length:5},(_,i)=>({sql:'CREATE TABLE PRIVATE_TABLE_'+i+'(v TEXT)',type:'table',tbl_name:'PRIVATE_TABLE_'+i,name:'PRIVATE_TABLE_'+i}));
const clone=raw.replace(original.NAME_SHA,original.sha('PRIVATE_DATABASE_SENTINEL')).replace(original.CATALOG_SHA,original.catalogHash(rows));
assert.notEqual(clone,raw);
assert.equal(clone.replace(original.sha('PRIVATE_DATABASE_SENTINEL'),original.NAME_SHA).replace(original.catalogHash(rows),original.CATALOG_SHA),raw);
const fixturePath=resolve(import.meta.dirname,'backup-adversarial-fixture.mjs');
await writeFile(fixturePath,clone,{mode:0o600});
const fixture=await import(pathToFileURL(fixturePath));
const recipient=await readFile(resolve(root,'existing-d1-recovery/customer_frontier/recovery/recipient-20261106.pem'));
const download='https://fixture.r2.cloudflarestorage.com/PRIVATE_PATH?signature=PRIVATE_SIGNATURE';
const done=()=>({success:true,result:{success:true,type:'export',status:'complete',result:{signed_url:download}}});
const response=value=>new Response(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value),{status:200});
async function run({change=()=>{},options={}}={}){
 const input=[{success:true,result:{uuid:fixture.DATABASE,name:'PRIVATE_DATABASE_SENTINEL',file_size:40960}},
 {success:true,result:[{success:true,meta:{changed_db:false,changes:0,rows_written:0},results:structuredClone(rows)}]},done(),'PRIVATE_SQL_SENTINEL'];
 change(input);const calls=[];
 const fetcher=async(url,opts)=>{calls.push({url,opts});assert(input.length);const v=input.shift();if(v instanceof Error)throw v;return v instanceof Response?v:response(v);};
 let value,error;
 try{value=await fixture.exportBackup({token:'PRIVATE_TOKEN_SENTINEL',publicKey:recipient,sourceSha:'a'.repeat(40),fetcher,delay:async()=>{},...options});}catch(e){error=e;}
 const receipt=value?.receipt||error?.receipt;assert(receipt);
 for(const key of ['backup_saved_to_drive','restore_qualified','hosted_migration_qualified','target_admitted','release_authority'])assert.equal(receipt[key],false);
 const encoded=JSON.stringify(receipt);
 for(const privateText of ['PRIVATE_TOKEN_SENTINEL','PRIVATE_DATABASE_SENTINEL','PRIVATE_PATH','PRIVATE_SIGNATURE','PRIVATE_SQL_SENTINEL','PRIVATE_ERROR_SENTINEL','PRIVATE_BOOKMARK_SENTINEL','PRIVATE_TABLE_'])assert(!encoded.includes(privateText));
 for(const {url,opts}of calls){
  assert.equal(opts.redirect,'error');assert(opts.signal instanceof AbortSignal);
  if(url.startsWith(fixture.API)){
   assert.equal(opts.headers.Authorization,'Bearer PRIVATE_TOKEN_SENTINEL');
   if(url===fixture.API){assert.equal(opts.method,'GET');assert.equal(opts.body,undefined);}
   else if(url===fixture.API+'/query'){assert.equal(opts.method,'POST');assert.deepEqual(JSON.parse(opts.body),{sql:fixture.SQL,params:[]});}
   else{assert.equal(url,fixture.API+'/export');assert.equal(opts.method,'POST');const body=JSON.parse(opts.body);assert.deepEqual(body.dump_options,{compatibility:'d1'});assert.equal(body.output_format,'polling');assert(Object.keys(body).every(k=>['output_format','dump_options','current_bookmark'].includes(k)));}
  }else{assert.equal(url,download);assert.equal(opts.method,'GET');assert.equal(opts.headers,undefined);assert.equal(opts.body,undefined);}
 }
 assert(calls.length<=13);
 if(error)assert(!value);
 return {value,error,calls,receipt};
}
test('baseline pipeline encrypts signed download without credential transfer or plaintext artifact',async()=>{
 const {value,error,calls,receipt}=await run();assert.equal(error,undefined);assert.equal(calls.length,4);assert.equal(receipt.export_complete,true);assert.equal(original.sha(value.envelope),receipt.envelope_sha256);
 const e=JSON.parse(value.envelope);assert.equal(Buffer.from(e.wrapped_key_b64,'base64').length,512);assert.equal(Buffer.from(e.nonce_b64,'base64').length,12);assert.equal(Buffer.from(e.tag_b64,'base64').length,16);assert(!value.envelope.includes(Buffer.from('PRIVATE_SQL_SENTINEL')));
});
test('constant bookmark is retained on poll and never emitted',async()=>{
 const {error,calls}=await run({change:d=>d.splice(2,0,{success:true,result:{success:true,type:'export',at_bookmark:'PRIVATE_BOOKMARK_SENTINEL'}})});
 assert.equal(error,undefined);assert.equal(calls.length,5);assert.equal(JSON.parse(calls[3].opts.body).current_bookmark,'PRIVATE_BOOKMARK_SENTINEL');
});
test('bookmark change aborts before any download',async()=>{
 const {error,calls}=await run({change:d=>d.splice(2,0,...['PRIVATE_BOOKMARK_SENTINEL','changed'].map(at_bookmark=>({success:true,result:{success:true,at_bookmark}})))});
 assert.equal(error.message,'INVALID_EXPORT_BOOKMARK');assert.equal(calls.length,4);
});
test('ten unfinished polls exhaust without download or complete claim',async()=>{
 const {error,calls,receipt}=await run({change:d=>d.splice(2,2,...Array.from({length:10},()=>({success:true,result:{success:true,at_bookmark:'PRIVATE_BOOKMARK_SENTINEL'}})))});
 assert.equal(error.message,'EXPORT_NOT_COMPLETE');assert.equal(calls.length,12);assert.equal(receipt.export_complete,false);
});
test('wrong ID size and name fail before catalog or export',async()=>{
 for(const patch of [{uuid:'another'},{name:'another'},{file_size:0},{file_size:true},{file_size:1.5},{file_size:1048577}]){
  const {error,calls}=await run({change:d=>Object.assign(d[0].result,patch)});assert(error);assert.equal(calls.length,1);
 }
});
test('catalog write or proof drift blocks all export requests',async()=>{
 for(const change of [d=>d[1].result[0].meta.changed_db=0,d=>d[1].result[0].meta.rows_written=false,d=>d[1].result[0].meta.changes=1,d=>d[1].result[0].results[0].sql+=' ',d=>d[1].result[0].results.push(d[1].result[0].results[0])]){
  const {error,calls}=await run({change});assert(error);assert.equal(calls.length,2);
 }
});
test('preflight token provenance and recipient mismatches make zero calls',async()=>{
 for(const options of [{token:''},{token:'x\r\ny'},{sourceSha:'g'.repeat(40)},{publicKey:Buffer.from('another')}]){
  const {error,calls}=await run({options});assert(error);assert.equal(calls.length,0);
 }
});
test('origin confusion credentials ports nonHTTPS and deceptive suffixes fail safely',async()=>{
 for(const signed_url of ['http://fixture.r2.cloudflarestorage.com/','https://fixture.r2.cloudflarestorage.com.evil.example/','https://cloudflare.com.evil.example/','https://user:pass@fixture.r2.cloudflarestorage.com/','https://fixture.r2.cloudflarestorage.com:8443/','file:///tmp/PRIVATE_PATH','https://127.0.0.1/']){
  const {error,calls}=await run({change:d=>d[2].result.result.signed_url=signed_url});assert.equal(error.message,'UNQUALIFIED_EXPORT_DOWNLOAD_ORIGIN');assert.equal(calls.length,3);
 }
});
test('provider error code is retained while body text remains private',async()=>{
 const {error,calls,receipt}=await run({change:d=>d[0]=new Response(JSON.stringify({success:false,errors:[{code:8000024,message:'PRIVATE_ERROR_SENTINEL'},{code:true},{code:'8000024'}]}),{status:403})});
 assert.equal(error.message,'PROVIDER_FAILURE');assert.equal(calls.length,1);assert.deepEqual(receipt.transport[0].provider_error_codes,[8000024]);
});
test('provider redirects invalidJSON and oversized bodies do not produce backup',async()=>{
 for(const value of [new Response('PRIVATE_ERROR_SENTINEL',{status:307}),'{PRIVATE_ERROR_SENTINEL','x'.repeat(2_000_001)]){
  const {error,calls,receipt}=await run({change:d=>d[0]=value});assert(error);assert.equal(calls.length,1);assert.equal(receipt.export_complete,false);
 }
 const {error,receipt}=await run({change:d=>d[3]='x'.repeat(8_000_001)});assert.equal(error.message,'BACKUP_EXPORT_UNAVAILABLE');assert.equal(receipt.export_complete,false);
});
test('expired deadline makes zero requests and no completed backup',async()=>{
 let n=0;const {error,calls,receipt}=await run({options:{clock:()=>n++===0?0:180001}});assert.equal(error.message,'REQUEST_BUDGET_EXHAUSTED');assert.equal(calls.length,0);assert.equal(receipt.export_complete,false);
});
test('authenticated envelope decrypts only exact content and authenticates metadata nonce key tag',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:4096});const plaintext=Buffer.from('PRIVATE_SYNTHETIC_SQL');
 const decode=e=>{const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(e.wrapped_key_b64,'base64'));const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.nonce_b64,'base64'));decipher.setAAD(Buffer.from(e.aad_b64,'base64'));decipher.setAuthTag(Buffer.from(e.tag_b64,'base64'));return Buffer.concat([decipher.update(Buffer.from(e.ciphertext_b64,'base64')),decipher.final()]);};
 const e=JSON.parse(original.encryptBackup(plaintext,publicKey,{database_id:'synthetic',sql_bytes:plaintext.length,sql_sha256:original.sha(plaintext)}));assert.deepEqual(decode(e),plaintext);
 for(const field of ['aad_b64','wrapped_key_b64','nonce_b64','tag_b64','ciphertext_b64']){const changed=structuredClone(e);const b=Buffer.from(changed[field],'base64');b[0]^=1;changed[field]=b.toString('base64');assert.throws(()=>decode(changed));}
});
test.after(async()=>{await unlink(fixturePath);});
