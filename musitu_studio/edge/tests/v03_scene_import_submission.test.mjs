import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import * as preview from '../public_v03/scene-preview.mjs';
import {createSubmissionIntent,submittedJobId} from '../public_v03/submission-intent.mjs';

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
 assert.ok(js.includes('submittedJobId(receipt)'));
 assert.ok(js.includes('submitBusy'));
 assert.doesNotMatch(js,/\blocalStorage\s*[.\[]\s*(?:getItem|setItem|removeItem)/);
 assert.doesNotMatch(js,/\bsessionStorage\s*[.\[]\s*(?:getItem|setItem|removeItem)/);
 assert.ok(!js.includes('STUDIO_RENDER_DEVICE'));
 assert.ok(!js.includes('uploadFile('));
});
