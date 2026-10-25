import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createTenantWorkspaceClient} from '../enterprise-client.mjs';
import {encryptTenantText} from '../client-encrypted-artifact.mjs';

const BASE='https://musitu-private-canary.mft-education-nexus-93f395f5.workers.dev';
const TENANT='tenant_alpha001',OTHER='tenant_bravo002';
const ID1='artifact_entry_001',ID2='artifact_entry_002';
const ETag='"00000000-0000-4000-8000-000000000002"';
const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const separate=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const pack=async(k=key,tenant=TENANT)=>({kind:'musitu-enterprise-encrypted-export',version:1,tenantId:tenant,artifacts:[
{id:ID1,etag:ETag,envelope:await encryptTenantText('Private backup item #1',k,tenant,ID1)},
{id:ID2,etag:ETag,envelope:await encryptTenantText('Private backup item #2',k,tenant,ID2)}
]});
const api=(fetcher,getToken=async()=>'mock-valid-access-jwt',cryptoKey=key,tenantId=TENANT)=>
 createTenantWorkspaceClient({baseUrl:BASE,tenantId,key:cryptoKey,getToken,fetcher});

test('offline inspection authenticates every cipher envelope without network or exposing plaintext',async()=>{
 let fetches=0,tokens=0;
 const client=api(async()=>{fetches++;throw Error('should never fetch');},async()=>{tokens++;throw Error('should not acquire a token');});
 const b=await pack();
 const report=await client.inspectEncryptedBundle(b);
 assert.deepEqual(report,{tenantId:TENANT,count:2,ids:[ID1,ID2]});
 assert.equal(fetches,0);assert.equal(tokens,0);
 assert.ok(!JSON.stringify(report).includes('Private backup'));
});

test('explicit selection and affirmative create-only approval are both required before any network action',async()=>{
 let calls=0;
 const client=api(async()=>{calls++;throw Error('unexpected network');});
 const b=await pack();
 for(const opts of [{bundle:b,id:ID1},{bundle:b,id:'artifact_missing_001',acknowledgeCreateOnly:true},
 {bundle:b,id:ID1,acknowledgeCreateOnly:'yes'},{bundle:b,acknowledgeCreateOnly:true}]){
  await assert.rejects(client.restoreEncryptedArtifact(opts));
 }
 assert.equal(calls,0);
});

test('restoration uses only authenticated ciphertext and If-None-Match star, never plaintext or overwrite',async()=>{
 const b=await pack();let count=0;
 const client=api(async(url,init)=>{
  count++;assert.equal(init.method,'PUT');
  assert.equal(new URL(url).searchParams.get('id'),ID2);
  assert.equal(new Headers(init.headers).get('if-none-match'),'*');
  assert.equal(new Headers(init.headers).get('if-match'),null);
  assert.equal(init.credentials,'omit');
  assert.deepEqual(JSON.parse(init.body),b.artifacts[1].envelope);
  assert.ok(!init.body.includes('Private backup item'));
  return new Response(JSON.stringify({id:ID2,stored:true,encryptedOpaque:true}),{status:200,headers:{'content-type':'application/json','etag':ETag}});
 });
 const result=await client.restoreEncryptedArtifact({bundle:b,id:ID2,acknowledgeCreateOnly:true});
 assert.deepEqual(result,{id:ID2,etag:ETag,created:true});
 assert.equal(count,1);
});

test('malformed, unsorted, duplicate, foreign, tampered, or wrong-key backups fail before token acquisition',async()=>{
 const b=await pack();let tokens=0,calls=0;
 const client=api(async()=>{calls++;throw Error('network not expected');},async()=>{tokens++;return 'fake';});
 const cases=[
 {...b,tenantId:OTHER},
 {...b,kind:'legacy-local-encrypted-workspace'},
 {...b,version:2},
 {...b,extra:'untrusted'},
 {...b,artifacts:[b.artifacts[1],b.artifacts[0]]},
 {...b,artifacts:[b.artifacts[0],b.artifacts[0]]},
 {...b,artifacts:[{...b.artifacts[0],etag:'W/'+ETag},b.artifacts[1]]},
 {...b,artifacts:[{...b.artifacts[0],envelope:{...b.artifacts[0].envelope,ciphertext:'not-real-base64!'}},b.artifacts[1]]},
 {...b,artifacts:[{...b.artifacts[0],id:ID2},b.artifacts[1]]},
 {...b,artifacts:Array.from({length:51},(_,i)=>({...b.artifacts[0],id:'artifact_over_'+String(i).padStart(4,'0')}))}
 ];
 for(const candidate of cases)await assert.rejects(client.restoreEncryptedArtifact({bundle:candidate,id:ID1,acknowledgeCreateOnly:true}));
 const wrongKey=api(async()=>{calls++;},async()=>{tokens++;return 'fake';},separate);
 await assert.rejects(wrongKey.restoreEncryptedArtifact({bundle:b,id:ID1,acknowledgeCreateOnly:true}));
 assert.equal(tokens,0);assert.equal(calls,0);
});

test('server-side occupied artifact conflict stops without retries or overwrites',async()=>{
 const b=await pack();let calls=0;
 const client=api(async()=>{calls++;return new Response(JSON.stringify({code:'PRECONDITION_FAILED'}),{status:412,headers:{'content-type':'application/json'}});});
 await assert.rejects(client.restoreEncryptedArtifact({bundle:b,id:ID1,acknowledgeCreateOnly:true}),
  error=>error.status===412&&error.code==='PRECONDITION_FAILED');
 assert.equal(calls,1);
});


test('restore sends the exact envelope authenticated before awaiting the external token callback',async()=>{
 const bundle=await pack();const pristine=JSON.stringify(bundle.artifacts[0].envelope);
 let calls=0,tokens=0;
 const client=api(async(url,init)=>{
  calls++;
  assert.equal(new URL(url).searchParams.get('id'),ID1);
  assert.equal(init.body,pristine,'mutable backup changed after authenticated inspection');
  return new Response(JSON.stringify({id:ID1,stored:true,encryptedOpaque:true}),{
   status:200,headers:{'content-type':'application/json',etag:ETag}
  });
 },async()=>{
  tokens++;
  bundle.artifacts[0].envelope.ciphertext='malicious_modified_ciphertext';
  return 'mock-valid-access-jwt';
 });
 const created=await client.restoreEncryptedArtifact({bundle,id:ID1,acknowledgeCreateOnly:true});
 assert.equal(created.created,true);
 assert.equal(tokens,1);
 assert.equal(calls,1);
});
