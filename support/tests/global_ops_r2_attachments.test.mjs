import assert from 'node:assert/strict';
import test from 'node:test';
import {handleSupportRequest} from '../worker.js';

const caseId='AX-0123456789AB',code='01234567-89ABCDEF-GHJKMNPQ',attachmentId='AXF-0123456789ABCDEF';
function fakeStore(){const calls=[];return {calls,
 async prepareAttachment(id,recovery,input){calls.push(['prepare',id,recovery,input]);return {attachment_id:attachmentId,case_id:id,filename:'trace.txt',content_type:'text/plain',bytes:5,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',storage_key:'cases/'+id+'/'+attachmentId,scan_state:'PENDING'};},
 async authorizeAttachmentUpload(id,recovery,aid){calls.push(['auth-upload',id,recovery,aid]);return {attachment_id:aid,case_id:id,content_type:'text/plain',bytes:5,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',storage_key:'cases/'+id+'/'+aid,scan_state:'PENDING'};},
 async authorizeAttachmentDownload(id,recovery,aid){calls.push(['auth-download',id,recovery,aid]);return {attachment_id:aid,case_id:id,filename:'trace.txt',content_type:'text/plain',bytes:5,storage_key:'cases/'+id+'/'+aid,scan_state:'CLEAN'};},
 async markAttachmentUploaded(aid){calls.push(['uploaded',aid]);return {attachment_id:aid};}
};}

test('native object storage attachment flow prepares relative upload when R2 binding is present',async()=>{
 const store=fakeStore(),objects={put:async()=>{},get:async()=>null};
 const r=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/attachments',{method:'POST',headers:{authorization:'Support '+code,'content-type':'application/json'},body:JSON.stringify({filename:'trace.txt',content_type:'text/plain',bytes:5,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'})}),{ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_ATTACHMENTS:objects});
 assert.equal(r.status,201);const b=await r.json();assert.equal(b.upload_url,'/api/v1/cases/'+caseId+'/attachments/'+attachmentId+'/content');assert.equal(b.scan_state,'PENDING');
});

test('attachment upload authenticates case, verifies size and SHA-256 before object write',async()=>{
 const store=fakeStore(),puts=[];const objects={async put(key,body,opts){puts.push([key,new Uint8Array(body),opts]);}};
 const r=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/attachments/'+attachmentId+'/content',{method:'PUT',headers:{authorization:'Support '+code,'content-type':'text/plain','content-length':'5'},body:'hello'}),{ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_ATTACHMENTS:objects});
 assert.equal(r.status,201);assert.equal(puts.length,1);assert.equal(puts[0][0],'cases/'+caseId+'/'+attachmentId);assert.equal(store.calls.some(x=>x[0]==='uploaded'),true);
 const bad=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/attachments/'+attachmentId+'/content',{method:'PUT',headers:{authorization:'Support '+code,'content-type':'text/plain','content-length':'5'},body:'HELLO'}),{ENVIRONMENT:'test',SUPPORT_STORE:fakeStore(),SUPPORT_ATTACHMENTS:objects});
 assert.equal(bad.status,422);
});

test('attachment download requires CLEAN authorization and streams private object',async()=>{
 const store=fakeStore();const objects={async get(key){return {body:new Blob(['hello']).stream(),size:5,httpEtag:'etag1'};}};
 const r=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/attachments/'+attachmentId+'/content',{headers:{authorization:'Support '+code}}),{ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_ATTACHMENTS:objects});
 assert.equal(r.status,200);assert.equal(await r.text(),'hello');assert.equal(r.headers.get('content-type'),'text/plain');assert.match(r.headers.get('content-disposition'),/attachment/);
});

test('attachment content endpoints fail closed when object storage is absent',async()=>{
 const store=fakeStore();
 const r=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/attachments/'+attachmentId+'/content',{method:'PUT',headers:{authorization:'Support '+code,'content-type':'text/plain'},body:'hello'}),{ENVIRONMENT:'test',SUPPORT_STORE:store});
 assert.equal(r.status,503);
});

test('store exposes upload/download attachment authorization methods',()=>{
 return import('../d1_case_store.js').then(({D1CaseStore})=>{for(const n of ['authorizeAttachmentUpload','authorizeAttachmentDownload','markAttachmentUploaded'])assert.equal(typeof D1CaseStore.prototype[n],'function',n);});
});
