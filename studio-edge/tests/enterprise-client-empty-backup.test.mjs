import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createTenantWorkspaceClient} from '../enterprise-client.mjs';
const ROOT='https://musitu-private-canary.mft-education-nexus-93f395f5.workers.dev';
const TENANT='tenant_alpha001';
const k=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
test('an empty authenticated export remains an inspectable ciphertext-only backup',async()=>{
 let calls=0,tokens=0;
 const api=createTenantWorkspaceClient({
   baseUrl:ROOT,tenantId:TENANT,key:k,
   getToken:async()=>{tokens++;return 'signed-test-token';},
   fetcher:async(url,options)=>{
     calls++;assert.equal(options.method,'GET');
     assert.equal(new URL(url).searchParams.get('id'),null);
     return new Response(JSON.stringify({items:[],nextAfter:null}),{
       headers:{'content-type':'application/json'},status:200
     });
   }
 });
 const empty=await api.exportEncryptedBundle();
 assert.deepEqual(empty,{
   kind:'musitu-enterprise-encrypted-export',version:1,
   tenantId:TENANT,artifacts:[]
 });
 const beforeCalls=calls,beforeTokens=tokens;
 assert.deepEqual(await api.inspectEncryptedBundle(empty),
   {tenantId:TENANT,count:0,ids:[]});
 assert.equal(calls,beforeCalls);
 assert.equal(tokens,beforeTokens);
 await assert.rejects(api.restoreEncryptedArtifact({
   bundle:empty,id:'artifact_entry_001',acknowledgeCreateOnly:true
 }),e=>e.code==='INVALID_RESTORE_SELECTION');
 assert.equal(calls,beforeCalls);
 assert.equal(tokens,beforeTokens);
});
