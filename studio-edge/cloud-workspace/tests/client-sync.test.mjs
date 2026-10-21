import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createCloudWorkspaceSync,CloudSyncError} from '../client-sync.mjs';
import {workspaceFetch,validOpaqueEnvelope} from '../gateway.mjs';
globalThis.crypto??=webcrypto;
const HOST='https://workspace.mftintelligence.com';
const TENANT='securetenant';
const SUBJECT='real-access-subject-1234';
const PASS='Correct horse secure cloud passphrase!';
const encoder=new TextEncoder();
async function encrypted(plain='This private example is never sent in plaintext to the service.'){
  const salt=new Uint8Array(16).fill(7),iv=new Uint8Array(12).fill(9);
  const material=await crypto.subtle.importKey('raw',encoder.encode(PASS),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const clear={transcript:[{role:'user',content:plain}],history:[]};
  const content=await crypto.subtle.encrypt({name:'AES-GCM',iv,
    additionalData:encoder.encode('MUSITU-INTELLIGENCE-LOCAL-VAULT-v1'),tagLength:128},key,
    encoder.encode(JSON.stringify(clear)));
  const b64=u=>Buffer.from(u).toString('base64');
  return JSON.stringify({kind:'musitu-local-encrypted-workspace',version:1,cipher:'AES-256-GCM',
    kdf:'PBKDF2-SHA-256',iterations:310000,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(content))});
}
class D1{
  constructor(){this.role='owner';this.map=new Map();}
  prepare(sql){return {bind:(...args)=>({
    first:async()=>{
      if(sql.startsWith('SELECT role'))return this.role?{role:this.role}:null;
      const role=this.role;
      return role?this.map.get(args[0]+'|'+args[1])||null:null;
    },
    run:async()=>{
      const allowed=this.role==='owner'||this.role==='editor';
      if(!allowed)return {success:true,meta:{changes:0}};
      if(sql.startsWith('INSERT')){
        const [tenant,slot,encrypted,updated]=args,key=tenant+'|'+slot;
        if(this.map.has(key))return {success:true,meta:{changes:0}};
        this.map.set(key,{version:1,encrypted,updated_at:updated});
      }else if(sql.startsWith('UPDATE')){
        const [encrypted,updated,tenant,slot,version]=args,key=tenant+'|'+slot,current=this.map.get(key);
        if(!current||current.version!==version)return {success:true,meta:{changes:0}};
        this.map.set(key,{version:version+1,encrypted,updated_at:updated});
      }else if(sql.startsWith('DELETE')){
        const [tenant,slot,version]=args,key=tenant+'|'+slot,current=this.map.get(key);
        if(!current||current.version!==version)return {success:true,meta:{changes:0}};
        this.map.delete(key);
      }else throw Error('Unexpected SQL');
      return {success:true,meta:{changes:1}};
    }
  })};}
}
function mockClient({storeInit={},role='owner',subject=SUBJECT}={}){
  const db=new D1();db.role=role;
  const data=new Map(Object.entries(storeInit));
  const storage={getItem(k){return data.get(k)??null;},setItem(k,v){data.set(k,v);}};
  const env={WORKSPACE_ORIGIN:HOST,WORKSPACE_ENABLED:'true',WORKSPACE_DB:db,
    WORKSPACE_RATE:{limit:async()=>({success:true})},
    ACCESS_TEAM_DOMAIN:'https://example.cloudflareaccess.com',ACCESS_AUD:'qualified_audience'};
  const calls=[];
  const fetchImpl=async (url,init)=>{
    calls.push({url,method:init.method,body:init.body||'',credentials:init.credentials,
      headers:init.headers,redirect:init.redirect});
    const headers={...init.headers,'cf-access-jwt-assertion':'injected-by-access-for-test'};
    if(init.method!=='GET')headers.origin=HOST;
    return workspaceFetch(new Request(url,{method:init.method,headers,
      ...(init.body?{body:init.body}:{})}),env,{verifyJWT:async()=>({subject})});
  };
  return {client:createCloudWorkspaceSync({tenant:TENANT,locationOrigin:HOST,storage,fetchImpl}),
    db,data,calls,storage};
}
function rejectsCode(fn,code){return assert.rejects(fn,error=>error instanceof CloudSyncError&&error.code===code);}
const SLOT1='musitu.intelligence.encrypted.v1';
const SLOT2='musitu.intelligence.encrypted.slot.2.v2';

test('private first-party origin and valid tenant required, without network calls',()=>{
  for(const origin of ['https://evansmusitu.github.io','https://fake.mftintelligence.com','http://workspace.mftintelligence.com','']){
    assert.throws(()=>createCloudWorkspaceSync({tenant:TENANT,locationOrigin:origin,storage:new Map(),fetchImpl:()=>{}}),
      error=>error instanceof CloudSyncError&&error.code==='PRIVATE_ORIGIN_REQUIRED');
  }
  assert.throws(()=>createCloudWorkspaceSync({tenant:'../x',locationOrigin:HOST}),
    error=>error.code==='INVALID_TENANT');
});
test('zero network calls on construction or unapproved actions; missing local slot denies',async()=>{
  const {client,calls}=mockClient();
  assert.equal(calls.length,0);
  await rejectsCode(()=>client.upload(1,{expectedVersion:0}), 'USER_CONSENT_REQUIRED');
  await rejectsCode(()=>client.download(1),'USER_CONSENT_REQUIRED');
  await rejectsCode(()=>client.deleteRemote(1,{expectedVersion:1}),'USER_CONSENT_REQUIRED');
  await rejectsCode(()=>client.upload(1,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'}),'LOCAL_SLOT_EMPTY');
  assert.equal(calls.length,0);
});
test('real PBKDF2 AES-GCM vault bytes are transferred opaque, without plaintext/password/JWT',async()=>{
  const secret='The confidential team meeting and patient record are private.';
  const vault=await encrypted(secret);
  assert.equal(validOpaqueEnvelope(vault),true);
  const {client,data,calls}=mockClient({storeInit:{[SLOT1]:vault}});
  assert.deepEqual(await client.upload(1,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'}),
    {slot:1,version:1,encryptedOnly:true});
  assert.equal(calls.length,1);
  assert.ok(!calls[0].body.includes(secret));
  assert.ok(!calls[0].body.includes(PASS));
  assert.equal(calls[0].credentials,'same-origin');
  assert.equal(calls[0].headers['cf-access-jwt-assertion'],undefined,'JWT must be injected by Access, not browser JS');
  assert.equal(calls[0].redirect,'error');
  assert.ok(data.get(SLOT1).includes('ciphertext'));
});
test('remote GET restore is opt-in and never silently replaces existing slot',async()=>{
  const a=await encrypted('Vault A: private client source record.');
  const b=await encrypted('Vault B: changed encrypted client data.');
  const {client,data,calls}=mockClient({storeInit:{[SLOT1]:a}});
  await client.upload(1,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'});
  assert.equal((await client.download(1,{approval:'DOWNLOAD_ENCRYPTED_COPY'})).localChanged,false);
  data.set(SLOT1,b);
  await rejectsCode(()=>client.download(1,{approval:'DOWNLOAD_ENCRYPTED_COPY'}),
    'LOCAL_REPLACEMENT_REQUIRES_APPROVAL');
  assert.equal(data.get(SLOT1),b,'Local encrypted slot unchanged after refusal');
  assert.equal((await client.download(1,{approval:'DOWNLOAD_ENCRYPTED_COPY',
    overwriteApproval:'REPLACE_LOCAL_ENCRYPTED_COPY'})).localChanged,true);
  assert.equal(data.get(SLOT1),a,'Explicit approval allows encrypted-only replacement');
  assert.ok(calls.every(c=>!c.body.includes('Vault A')&&!c.body.includes('Vault B')));
});
test('remote CAS version conflict does not change existing encrypted local copy',async()=>{
  const cipher=await encrypted();
  const {client,data}=mockClient({storeInit:{[SLOT1]:cipher}});
  await client.upload(1,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'});
  await rejectsCode(()=>client.upload(1,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'}),'VERSION_CONFLICT');
  assert.equal(data.get(SLOT1),cipher);
  const next=await client.upload(1,{expectedVersion:1,approval:'UPLOAD_ENCRYPTED_COPY'});
  assert.equal(next.version,2);
});
test('remote deletion requires explicit consent and leaves encrypted local copy intact',async()=>{
  const cipher=await encrypted(),{client,data}=mockClient({storeInit:{[SLOT2]:cipher}});
  await client.upload(2,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'});
  await rejectsCode(()=>client.deleteRemote(2,{expectedVersion:0,approval:'DELETE_REMOTE_ENCRYPTED_COPY'}),'INVALID_VERSION');
  assert.deepEqual(await client.deleteRemote(2,{expectedVersion:1,approval:'DELETE_REMOTE_ENCRYPTED_COPY'}),
    {slot:2,remoteDeleted:true,localPreserved:true});
  assert.equal(data.get(SLOT2),cipher);
  assert.deepEqual(await client.download(2,{approval:'DOWNLOAD_ENCRYPTED_COPY'}),
    {slot:2,remoteEmpty:true,localChanged:false});
});
test('viewer server authorization denies writes even with encrypted payload',async()=>{
  const cipher=await encrypted(),{client,calls,data}=mockClient({storeInit:{[SLOT1]:cipher},role:'viewer'});
  await rejectsCode(()=>client.upload(1,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'}),'ACCESS_DENIED');
  assert.equal(calls.length,1);assert.equal(data.get(SLOT1),cipher);
});
test('malformed local ciphertext and invalid slot fail before any remote calls',async()=>{
  const {client,calls}=mockClient({storeInit:{[SLOT1]:'my plain secret'}});
  await rejectsCode(()=>client.upload(1,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'}),'INVALID_LOCAL_CIPHERTEXT');
  await rejectsCode(()=>client.upload(6,{expectedVersion:0,approval:'UPLOAD_ENCRYPTED_COPY'}),'INVALID_SLOT');
  assert.equal(calls.length,0);
});
test('storage failures and server-side outages fail closed without fallbacks',async()=>{
  const cipher=await encrypted(),remoteCipher=await encrypted('A distinct remote encrypted document record.'),testMap=new Map([[SLOT1,cipher]]);
  const badStorage={getItem(k){return testMap.get(k)},setItem(){throw Error('QuotaExceededError');}};
  const fetchImpl=async()=>new Response(JSON.stringify({tenant:TENANT,slot:1,version:1,encrypted:remoteCipher}),
    {status:200,headers:{'content-type':'application/json'}});
  const client=createCloudWorkspaceSync({tenant:TENANT,locationOrigin:HOST,storage:badStorage,fetchImpl});
  await rejectsCode(()=>client.download(1,{approval:'DOWNLOAD_ENCRYPTED_COPY',overwriteApproval:'REPLACE_LOCAL_ENCRYPTED_COPY'}),
    'LOCAL_STORAGE_UNAVAILABLE');
  assert.equal(testMap.get(SLOT1),cipher);
  const failing=createCloudWorkspaceSync({tenant:TENANT,locationOrigin:HOST,storage:badStorage,
    fetchImpl:async()=>{throw Error('Connection refused: private login unavailable');}});
  await rejectsCode(()=>failing.download(1,{approval:'DOWNLOAD_ENCRYPTED_COPY'}),'NETWORK_UNAVAILABLE');
});
