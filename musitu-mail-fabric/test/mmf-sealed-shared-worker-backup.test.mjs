import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {captureMmfSharedWorkerBackup,unsealMmfSharedWorkerBackup} from '../src/staging/mmf-sealed-shared-worker-backup.mjs';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const WORKERS=['mft-phase8-external-authority','mft-paynow-transport-gateway'];
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pub=publicKey.export({type:'spki',format:'pem'});
const priv=privateKey.export({type:'pkcs8',format:'pem'});
const sc={Authorization:`Bearer ${'z'.repeat(45)}`};
const getSource=name=>`/* ${name} */\nexport default {async fetch(req, env) {return new Response('PRIVATE_SOURCE_RESTORE_BYTES_'+${JSON.stringify('x'.repeat(230))});}};\n`;
function setup({mutate=false,missing=false}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method,headers:options.headers,redirect:options.redirect,cache:options.cache});
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.authorization,sc.Authorization);
  const m=url.match(/\/workers\/scripts\/(mft-phase8-external-authority|mft-paynow-transport-gateway)(\/settings)?$/);
  assert.ok(m,'only two allowed workers');
  if(missing&&m[1]==='mft-paynow-transport-gateway')return new Response('not found',{status:404});
  if(m[2])return new Response(JSON.stringify({success:true,result:{bindings:[{name:'LEGACY_FMI_TOKEN',type:'secret_text'}]}}),{headers:{'content-type':'application/json'}});
  let text=getSource(m[1]);
  if(mutate&&m[1]===WORKERS[1]&&calls.filter(x=>x.url===url).length===2)text+='/*changed*/';
  return new Response(text,{headers:{'content-type':'application/javascript'}});
 };
 return {calls,fetchImpl};
}
test('two full GET-only worker source/settings captures are encrypted, verified and recovered',async()=>{
 const {calls,fetchImpl}=setup();
 const data=await captureMmfSharedWorkerBackup({accountId:ACCOUNT,token:sc.Authorization.slice(7),publicKeyPem:pub,fetchImpl});
 assert.equal(calls.length,6);
 assert.deepEqual(new Set(calls.map(x=>x.method)),new Set(['GET']));
 assert.equal(data.summary.workerCount,2);
 assert.equal(data.summary.cloudflareMutationCount,0);
 assert.equal(data.summary.secretValuesExported,false);
 assert.equal(data.summary.secretBindingsRestorable,false);
 assert.equal(data.summary.exactSourceSettingsEncrypted,true);
 const publicSerialized=JSON.stringify(data);
 assert.doesNotMatch(publicSerialized,/PRIVATE_SOURCE_RESTORE_BYTES|LEGACY_FMI_TOKEN|zzzzzzz/);
 const recovered=unsealMmfSharedWorkerBackup(data.sealed,priv);
 assert.equal(recovered.workers.length,2);
 assert.equal(recovered.workers[0].name,WORKERS[0]);
 assert.match(Buffer.from(recovered.workers[1].rawSourceBase64,'base64').toString(),/PRIVATE_SOURCE_RESTORE_BYTES/);
 assert.equal(recovered.workers[0].settings.result.bindings[0].name,'LEGACY_FMI_TOKEN');
});
test('changed source between GETs refuses to seal an untrusted backup',async()=>{
 const {fetchImpl}=setup({mutate:true});
 await assert.rejects(()=>captureMmfSharedWorkerBackup({accountId:ACCOUNT,token:sc.Authorization.slice(7),publicKeyPem:pub,fetchImpl}),/MMF_SHARED_WORKER_BACKUP_DENIED/);
});
test('missing worker refuses partial backup',async()=>{
 const {fetchImpl}=setup({missing:true});
 await assert.rejects(()=>captureMmfSharedWorkerBackup({accountId:ACCOUNT,token:sc.Authorization.slice(7),publicKeyPem:pub,fetchImpl}),/MMF_SHARED_WORKER_BACKUP_DENIED/);
});
test('invalid credential/account and tampered encrypted bytes refuse decryption',async()=>{
 const {fetchImpl}=setup();
 await assert.rejects(()=>captureMmfSharedWorkerBackup({accountId:'foreign',token:sc.Authorization.slice(7),publicKeyPem:pub,fetchImpl}),/MMF_SHARED_WORKER_BACKUP_DENIED/);
 const x=await captureMmfSharedWorkerBackup({accountId:ACCOUNT,token:sc.Authorization.slice(7),publicKeyPem:pub,fetchImpl});
 const tampered={...x.sealed,ciphertextBase64:x.sealed.ciphertextBase64.slice(0,-4)+'AAAA'};
 assert.throws(()=>unsealMmfSharedWorkerBackup(tampered,priv),/MMF_SHARED_WORKER_BACKUP_DENIED/);
 const other=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
 assert.throws(()=>unsealMmfSharedWorkerBackup(x.sealed,other),/MMF_SHARED_WORKER_BACKUP_DENIED/);
});