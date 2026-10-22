import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePreviewScene,poseAtFrame,previewMeshTriangles,
  previewCamera,projectPreviewPoint} from '../public_v03/scene-preview.mjs';
import {validateScene} from '../src/validation.mjs';
const base={schema:'musitu.blender.job.v1',job_id:'StudioEnterprise01',frame_end:32,
  objects:[{name:'Foundation',type:'cube',location:[0,0,0],dimensions:[6,4,.3],material:'graphite'},
  {name:'Feature',type:'sphere',location:[2,0,1.3],dimensions:[1.6,1.6,1.6],material:'copper'}],
  animations:[{object:'Feature',axis:'Z',degrees:180,start:1,end:32}]};
const copy=()=>structuredClone(base),encode=x=>JSON.stringify(x);
function rejectChange(fn){const x=copy();fn(x);assert.throws(()=>parsePreviewScene(encode(x)));assert.throws(()=>validateScene(x))}
test('local preview accepts canonical Blender declarative JSON and does not mutate source',()=>{
 const original=encode(base);const parsed=parsePreviewScene(original);
 assert.deepEqual(parsed,base);assert.equal(encode(base),original);
 assert.equal(parsed.objects.length,2);
});
test('strict display parser is compatible with authoritative backend schema',()=>{
 rejectChange(x=>x.unexpected='injection');
 rejectChange(x=>x.objects[0].script='eval(1)');
 rejectChange(x=>x.objects[0].material='<img onerror=alert(1)>');
 rejectChange(x=>x.objects[0].type='python');
 rejectChange(x=>x.objects[0].name='../example');
 rejectChange(x=>x.objects[1].name='Foundation');
 rejectChange(x=>x.objects[0].location=[Infinity,0,0]);
 rejectChange(x=>x.objects[0].dimensions=[0,1,1]);
 rejectChange(x=>x.objects[0].location=[21,0,0]);
 rejectChange(x=>x.animations[0].axis='Q');
 rejectChange(x=>x.animations[0].start=33);
 rejectChange(x=>x.objects=[]);
 rejectChange(x=>x.objects=new Array(31).fill(x.objects[0]));
 assert.throws(()=>parsePreviewScene('{'));
 assert.throws(()=>parsePreviewScene(' '.repeat(65537)),/TOO_LARGE/);
});
test('frame 1 and last frame generate correct world-space pose',()=>{
 const early=poseAtFrame(base,1),late=poseAtFrame(base,32);
 assert.equal(early[1].rotations.Z,0);
 assert.ok(Math.abs(late[1].rotations.Z-Math.PI)<1e-10);
 assert.deepEqual(early[0].location,[0,0,0]);
});
test('cube exact triangles and positive coordinate bounds',()=>{
 const object={...copy().objects[0],rotations:{X:0,Y:0,Z:0}};
 const vertices=previewMeshTriangles(object);
 assert.equal(vertices.length,12);
 const unique=vertices.flat();
 for(const p of unique){assert.ok(Math.abs(p[0])<=3);assert.ok(Math.abs(p[1])<=2);assert.ok(Math.abs(p[2])<=.15)}
 assert.throws(()=>previewMeshTriangles({...object,dimensions:[-1,1,1]}));
});
test('sphere and cylinder finite surfaces at supported face counts',()=>{
 for(const type of ['sphere','cylinder']){
   const obj={...copy().objects[1],type,rotations:{X:0,Y:0,Z:Math.PI/4}};
   const mesh=previewMeshTriangles(obj);
   assert.ok(mesh.length>=40&&mesh.length<=360);
   for(const face of mesh)for(const p of face)for(const n of p)assert.ok(Number.isFinite(n));
 }
});
test('perspective projection has near-plane check and finite screen coordinates',()=>{
 const camera=previewCamera();
 const origin=projectPreviewPoint([0,0,0],camera,800,450);
 assert.ok(origin&&Number.isFinite(origin.x)&&Number.isFinite(origin.y));
 assert.equal(projectPreviewPoint(camera.eye,camera,800,450),null);
 assert.equal(previewCamera({pitch:99}).right.length,3);
});
test('touch-first static shell includes preview, inspector, CSP and no external dependency',()=>{
 const html=readFileSync(new URL('../public_v03/index.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public_v03/studio.css',import.meta.url),'utf8');
 const headers=readFileSync(new URL('../public_v03/_headers',import.meta.url),'utf8');
 const script=readFileSync(new URL('../public_v03/scene-preview.mjs',import.meta.url),'utf8');
 for(const token of ['id="scene-preview-canvas"','id="scene-object-select"',
   'id="scene-apply-inspector"','type="module" src="/scene-preview.mjs"',
   'id="scene-frame"','id="scene-download-json"'])assert.ok(html.includes(token),token);
 assert.ok(css.includes('touch-action:none'));
 assert.ok(headers.includes("script-src 'self'"));
 assert.ok(!/(https?:\/\/|eval\(|new Function\(|fetch\()/i.test(script));
});
