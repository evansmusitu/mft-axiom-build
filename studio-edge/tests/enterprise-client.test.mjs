import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createTenantWorkspaceClient} from '../enterprise-client.mjs';
import {encryptTenantText} from '../client-encrypted-artifact.mjs';

const BASE='https://musitu-private-canary.mft-education-nexus-93f395f5.workers.dev';
const TENANT='tenant_alpha001', ID='artifact_entry_001', JWT='opaque_signed_access_assertion';
const ETag='"00000000-0000-4000-8000-000000000002"';
const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const ok=(body={},etag=ETag)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json','etag':etag}});
const setup=(fetcher,options={})=>createTenantWorkspaceClient({
 baseUrl:BASE,tenantId:TENANT,key,getToken:async()=>JWT,fetcher,...options
});
test('create sends opaque authenticated AES envelope, explicit create-only precondition, no browser cookies',async()=>{
 let calls=0;
 const api=setup(async (url,init)=>{
  calls++;
  const u=new URL(url);
  assert.equal(u.host,new URL(BASE).host);
  assert.equal(u.pathname,'/api/enterprise/tenants/'+TENANT+'/artifacts');
  assert.equal(u.searchParams.get('id'),ID);
  assert.equal(init.method,'PUT');
  assert.equal(init.credentials,'omit');
  assert.equal(init.cache,'no-store');
  assert.equal(init.redirect,'error');
  const h=new Headers(init.headers);
  assert.equal(h.get('cf-access-jwt-assertion'),JWT);
  assert.equal(h.get('if-none-match'),'*');
  assert.equal(h.get('if-match'),null);
  const envelope=JSON.parse(init.body);
  assert.deepEqual(Object.keys(envelope).sort(),['ciphertext','iv','version']);
  assert.ok(!init.body.includes('SECRET DOCUMENT'));
  assert.equal(envelope.version,1);
  return ok({id:ID,stored:true,encryptedOpaque:true});
 });
 const result=await api.create({id:ID,text:'SECRET DOCUMENT'});
 assert.equal(result.etag,ETag);assert.equal(calls,1);
});
test('read decrypts ONLY for correct tenant/object and supports revisioned update/delete',async()=>{
 const envelope=await encryptTenantText('sealed text',key,TENANT,ID);
 const commands=[];
 const api=setup(async (url,init)=>{
  const q=new URL(url);const h=new Headers(init.headers);
  commands.push({method:init.method,id:q.searchParams.get('id'),ifMatch:h.get('if-match')});
  if(init.method==='GET')return ok({id:ID,envelope});
  return init.method==='DELETE'?ok({id:ID,deleted:true}):ok({id:ID,stored:true});
 });
 const read=await api.get({id:ID});
 assert.equal(read.text,'sealed text');assert.equal(read.etag,ETag);
 const updated=await api.replace({id:ID,text:'updated sealed text',etag:ETag});
 assert.equal(updated.etag,ETag);
 const removed=await api.delete({id:ID,etag:ETag});
 assert.equal(removed.deleted,true);
 assert.deepEqual(commands,[
  {method:'GET',id:ID,ifMatch:null},
  {method:'PUT',id:ID,ifMatch:ETag},
  {method:'DELETE',id:ID,ifMatch:ETag}
 ]);
});
test('server precondition conflicts stop immediately, without automatic retries or token disclosure',async()=>{
 let calls=0;
 const api=setup(async()=>{calls++;return new Response(JSON.stringify({code:'PRECONDITION_FAILED',error:'denied'}),{status:412,headers:{'content-type':'application/json'}});});
 await assert.rejects(api.replace({id:ID,text:'update',etag:ETag}),error=>{
  assert.equal(error.status,412);
  assert.equal(error.code,'PRECONDITION_FAILED');
  assert.ok(!error.message.includes(JWT));
  return true;
 });
 assert.equal(calls,1);
});
test('list requests bounded metadata pages without IDs in route path',async()=>{
 const seen=[];
 const api=setup(async (url,init)=>{
  const q=new URL(url);seen.push({path:q.pathname,after:q.searchParams.get('after'),limit:q.searchParams.get('limit'),method:init.method});
  return ok({items:[{id:ID,revision:ETag.slice(1,-1),updatedAt:1800000000}],nextAfter:null});
 });
 const data=await api.list({limit:3,after:'artifact_prev_001'});
 assert.equal(data.items.length,1);
 assert.deepEqual(seen,[{path:'/api/enterprise/tenants/'+TENANT+'/artifacts',after:'artifact_prev_001',limit:'3',method:'GET'}]);
 await assert.rejects(api.list({limit:11}));
});
test('refuses unsafe endpoints, invalid IDs/versions, or missing identity without network',async()=>{
 let called=0;
 const fetcher=async()=>{called++;return ok();};
 for(const baseUrl of ['http://musitu-private-canary.mft-education-nexus-93f395f5.workers.dev',
 'https://attacker.example',
 'https://musitu-private-canary.mft-education-nexus-93f395f5.workers.dev@attacker.example']){
  assert.throws(()=>createTenantWorkspaceClient({baseUrl,tenantId:TENANT,key,getToken:async()=>JWT,fetcher}));
 }
 const api=setup(fetcher);
 await assert.rejects(api.get({id:'../../users'}));
 await assert.rejects(api.replace({id:ID,text:'secret',etag:'W/"weak"'}));
 const missing=setup(fetcher,{getToken:async()=>''});
 await assert.rejects(missing.list());
 assert.equal(called,0);
});

test('browser request has an AbortSignal and a bounded timeout with no retries',async()=>{
 let calls=0, suppliedSignal;
 const api=setup(async(_url,options)=>{
   calls++;suppliedSignal=options.signal;
   assert.ok(suppliedSignal instanceof AbortSignal);
   return new Promise((_,reject)=>{
     suppliedSignal.addEventListener('abort',()=>reject(new Error('fetch-aborted')),{once:true});
   });
 },{requestTimeoutMs:30});
 await assert.rejects(api.list(),error=>error.code==='REQUEST_TIMEOUT');
 assert.equal(calls,1);assert.equal(suppliedSignal.aborted,true);
});
test('oversized successful and error response bodies are rejected before JSON parsing',async()=>{
 const long=JSON.stringify({items:[],nextAfter:null,padding:'X'.repeat(75000)});
 for(const status of [200,412]){
  const api=setup(async()=>new Response(long,{status,headers:{'content-type':'application/json'}}));
  await assert.rejects(api.list(),error=>error.code==='RESPONSE_TOO_LARGE');
 }
});
test('reject incorrect response media type and malformed content-length header before payload consumption',async()=>{
 for(const headers of [{'content-type':'text/html'}, {'content-type':'application/json','content-length':'abc'}]){
  const api=setup(async()=>new Response(JSON.stringify({items:[],nextAfter:null}),{status:200,headers}));
  await assert.rejects(api.list(),error=>error.code==='INVALID_RESPONSE');
 }
});

test('signed Access token is never sent to public, capacity-canary, or unrelated same-account Workers',()=>{
 const fetcher=async()=>{throw Error('network must not be called');};
 for(const name of [
  'musitu-intelligence-edge-20261019',
  'musitu-intelligence-edge-capacity-canary-20261019',
  'musitu-saas-test',
  'musitu-notes-private',
 ]){
  assert.throws(()=>setup(fetcher,{baseUrl:'https://'+name+'.mft-education-nexus-93f395f5.workers.dev'}),
   error=>error.code==='INVALID_ENDPOINT',name);
 }
});
