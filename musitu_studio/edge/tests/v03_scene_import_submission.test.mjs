import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import * as preview from '../public_v03/scene-preview.mjs';
import {createSubmissionIntent,submittedJobId,submitSceneWithIdempotentRefresh} from '../public_v03/submission-intent.mjs';

const scene=()=>({schema:'musitu.blender.job.v1',job_id:'SceneForImport',frame_end:12,
 objects:[{name:'Model',type:'cube',location:[0,0,1],dimensions:[1,1,1],material:'teal'}],
 animations:[{object:'Model',axis:'Z',degrees:45,start:1,end:12}]});
const bytes=x=>new TextEncoder().encode(x);

test('imported scene bytes round trip into the exact backend-compatible scene',()=>{
 assert.equal(typeof preview.parseImportedSceneBytes,'function');
 const source=scene(),data=bytes(JSON.stringify(source));
 assert.deepEqual(preview.parseImportedSceneBytes(data),source);
 assert.deepEqual(source,scene());
 assert.deepEqual(preview.parseImportedSceneBytes(bytes('\ufeff'+JSON.stringify(source))),source);
});

test('file import fails closed on >64 KiB, invalid UTF-8, malformed and executable scene',()=>{
 const parse=preview.parseImportedSceneBytes;
 assert.equal(typeof parse,'function');
 assert.throws(()=>parse(bytes(' '.repeat(65537))),/TOO_LARGE/);
 assert.throws(()=>parse(new Uint8Array([0xc3,0x28])),/INVALID_UTF8/);
 assert.throws(()=>parse(bytes('{')),/INVALID_JSON/);
 assert.throws(()=>parse(bytes(JSON.stringify({...scene(),script:'alert(1)'}))),/INVALID_SCHEMA/);
 assert.throws(()=>parse('not bytes'),/INVALID_BYTES/);
});

test('submission intent uses stable key for retries, and new keys after acknowledgement',()=>{
 let num=0;
 const cache=createSubmissionIntent(()=>`submission-${++num}-long-key`);
 const first=cache.prepare({projectId:'project-a',scene:scene()});
 const second=cache.prepare({projectId:'project-a',scene:scene()});
 assert.equal(first.submission_key,second.submission_key);
 assert.equal(num,1);
 first.scene.objects[0].name='Changed';
 assert.equal(second.scene.objects[0].name,'Model');
 cache.acknowledge();
 const third=cache.prepare({projectId:'project-a',scene:scene()});
 assert.notEqual(third.submission_key,first.submission_key);
 assert.equal(num,2);
});

test('project or scene changes replace idempotency key without cross-project reuse',()=>{
 let num=0;const cache=createSubmissionIntent(()=>`key-${++num}-unique-safe`);
 const a=cache.prepare({projectId:'project-a',scene:scene()});
 const b=cache.prepare({projectId:'project-b',scene:scene()});
 const mutated=scene();mutated.animations[0].degrees=60;
 const c=cache.prepare({projectId:'project-b',scene:mutated});
 assert.equal(new Set([a.submission_key,b.submission_key,c.submission_key]).size,3);
 assert.equal(num,3);
 assert.equal(a.device,'CPU');
 assert.throws(()=>cache.prepare({projectId:'project-b',scene:{script:'import evil'}}));
});

test('duplicate submission receipt normalizes job_id safely',()=>{
 const id='ee259a63-f4ce-46b1-aa2e-f66a8ad1c621';
 assert.equal(submittedJobId({job_id:id}),id);
 assert.equal(submittedJobId({duplicate:true,job:{id}}),id);
 for(const x of [{}, {job_id:'BAD'}, {duplicate:true,job:{}},null])
   assert.throws(()=>submittedJobId(x),/SUBMISSION_RECEIPT_INVALID/);
});

test('signed Studio remains explicit-submission-only and guards idempotent retries',()=>{
 const html=readFileSync(new URL('../public_v03/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public_v03/studio.js',import.meta.url),'utf8');
 for(const label of ['id=\"scene-upload-json\"','id=\"scene-import-json\"','type=\"module\" src=\"/studio.js\"'])assert.ok(html.includes(label),label);
 assert.ok(js.includes('createSubmissionIntent()'));
 const intentSource=readFileSync(new URL('../public_v03/submission-intent.mjs',import.meta.url),'utf8');
 assert.ok(intentSource.includes('submittedJobId(receipt)'));
 assert.match(js,/AbortSignal\.timeout\(30_000\)/);
 assert.ok(js.includes('submitBusy'));
 assert.doesNotMatch(js,/\blocalStorage\s*[.\[]\s*(?:getItem|setItem|removeItem)/);
 assert.doesNotMatch(js,/\bsessionStorage\s*[.\[]\s*(?:getItem|setItem|removeItem)/);
 assert.ok(!js.includes('STUDIO_RENDER_DEVICE'));
 assert.ok(!js.includes('uploadFile('));
});

// Regression: cloud accepted the job but the subsequent listing timed out.
// A second tap must NOT create an extra render/approval record.
test('successful remote creation followed by failed refresh keeps the same key for retry',async()=>{
 let serial=0;const intent=createSubmissionIntent(()=>`submission-safe-${++serial}-123456`);
 const accepted='ee259a63-f4ce-46b1-aa2e-f66a8ad1c621',seen=[],events=[];
 const readback=async id=>({ok:true,job:{id,project_id:'project-a',device:'CPU',created_by_me:true}});
 const post=async data=>{seen.push(data.submission_key);return seen.length===1?{job_id:accepted}:
   {duplicate:true,job:{id:accepted}}};
 await assert.rejects(()=>submitSceneWithIdempotentRefresh({intent,projectId:'project-a',scene:scene(),post,readback,refresh:async()=>{events.push('refresh-failed');throw Error('OFFLINE_AFTER_COMMIT')}}),/OFFLINE_AFTER_COMMIT/);
 assert.equal(serial,1);
 const second=await submitSceneWithIdempotentRefresh({intent,projectId:'project-a',scene:scene(),post,readback,refresh:async()=>{events.push('refresh-success')}});
 assert.equal(second.jobId,accepted);assert.equal(second.duplicate,true);
 assert.deepEqual(seen,[seen[0],seen[0]]);
 assert.deepEqual(events,['refresh-failed','refresh-success']);
 const next=intent.prepare({projectId:'project-a',scene:scene()});
 assert.notEqual(next.submission_key,seen[0],'acknowledge only after confirmed refresh');
});

test('malformed receipt or failed POST never clears the submission key',async()=>{
 let serial=0;const intent=createSubmissionIntent(()=>`submission-safe-${++serial}-123456`);
 let key;
 await assert.rejects(()=>submitSceneWithIdempotentRefresh({intent,projectId:'project-a',scene:scene(),post:async data=>{key=data.submission_key;return {job_id:'invalid'}},readback:async()=>{throw Error('SHOULD_NOT_READBACK')},refresh:async()=>{throw Error('SHOULD_NOT_REFRESH')}}),/SUBMISSION_RECEIPT_INVALID/);
 assert.equal(intent.prepare({projectId:'project-a',scene:scene()}).submission_key,key);
 await assert.rejects(()=>submitSceneWithIdempotentRefresh({intent,projectId:'project-a',scene:scene(),post:async()=>{throw Error('NETWORK_TIMEOUT')},readback:async()=>{throw Error('SHOULD_NOT_READBACK')},refresh:async()=>{throw Error('UNREACHABLE')}}),/NETWORK_TIMEOUT/);
 assert.equal(intent.prepare({projectId:'project-a',scene:scene()}).submission_key,key);
});

test('signed owner readback is mandatory before clearing the retry key',async()=>{
 const id='ee259a63-f4ce-46b1-aa2e-f66a8ad1c621';let seq=0;
 const intent=createSubmissionIntent(()=>`verified-safe-${++seq}-1234567`);
 const payload={intent,projectId:'project-a',scene:scene(),post:async()=>({job_id:id}),refresh:async()=>{}};
 const valid=async()=>({ok:true,job:{id,project_id:'project-a',device:'CPU',created_by_me:true}});
 for(const readback of [undefined,async()=>({ok:true,job:{id,project_id:'project-b',device:'CPU',created_by_me:true}}),
   async()=>({ok:true,job:{id,project_id:'project-a',device:'GPU',created_by_me:true}}),
   async()=>({ok:true,job:{id,project_id:'project-a',device:'CPU',created_by_me:false}}),
   async()=>({ok:true,job:{id:'ee259a63-f4ce-46b1-aa2e-f66a8ad1c622',project_id:'project-a',device:'CPU',created_by_me:true}}),
   async()=>({job:{id,project_id:'project-a',device:'CPU',created_by_me:true}})]){
   await assert.rejects(()=>submitSceneWithIdempotentRefresh({...payload,readback}),/SUBMISSION_(READBACK_UNVERIFIED|CALLBACK_INVALID)/);
   assert.equal(intent.prepare({projectId:'project-a',scene:scene()}).submission_key,'verified-safe-1-1234567');
 }
 const result=await submitSceneWithIdempotentRefresh({...payload,readback:valid});
 assert.equal(result.jobId,id);
 assert.equal(seq,1);
 assert.notEqual(intent.prepare({projectId:'project-a',scene:scene()}).submission_key,'verified-safe-1-1234567');
});

test('authorized readback network error and failed list refresh preserve the same retry key',async()=>{
 const id='ee259a63-f4ce-46b1-aa2e-f66a8ad1c621';let seq=0,readbackCalls=0,refreshCalls=0;
 const intent=createSubmissionIntent(()=>`stable-safe-${++seq}-123456789`);
 const post=async()=>({job_id:id});
 const verified=async()=>{readbackCalls++;return {ok:true,job:{id,project_id:'project-a',device:'CPU',created_by_me:true}}};
 const args={intent,projectId:'project-a',scene:scene(),post};
 await assert.rejects(()=>submitSceneWithIdempotentRefresh({...args,readback:async()=>{throw Error('READBACK_TIMEOUT')},refresh:async()=>{refreshCalls++}}),/READBACK_TIMEOUT/);
 assert.equal(refreshCalls,0,'refresh must not run before authoritative readback');
 const saved=intent.prepare({projectId:'project-a',scene:scene()}).submission_key;
 await assert.rejects(()=>submitSceneWithIdempotentRefresh({...args,readback:verified,refresh:async()=>{refreshCalls++;throw Error('LIST_REFRESH_TIMEOUT')}}),/LIST_REFRESH_TIMEOUT/);
 assert.equal(intent.prepare({projectId:'project-a',scene:scene()}).submission_key,saved);
 await submitSceneWithIdempotentRefresh({...args,readback:verified,refresh:async()=>{refreshCalls++}});
 assert.equal(refreshCalls,2);assert.equal(readbackCalls,2);assert.equal(seq,1);
 assert.notEqual(intent.prepare({projectId:'project-a',scene:scene()}).submission_key,saved);
});

test('signed-in UI invokes the transaction helper instead of acknowledging before refresh',()=>{
 const js=readFileSync(new URL('../public_v03/studio.js',import.meta.url),'utf8');
 assert.match(js,/submitSceneWithIdempotentRefresh/);
 assert.ok(js.includes("readback:jobId=>api('/api/jobs/'+jobId)"), 'signed job readback must be called through Access-protected same-origin API');
 assert.doesNotMatch(js,/submitIntent\.acknowledge\(\)/);
});
