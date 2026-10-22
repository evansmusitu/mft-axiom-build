import * as childProcess from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync as readTemp} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSceneGlb} from '../public_v03/glb-export.mjs';
import {validateScene} from '../src/validation.mjs';

const scene=()=>({schema:'musitu.blender.job.v1',job_id:'OfflineModel01',frame_end:32,
 objects:[
 {name:'Foundation',type:'cube',location:[0,0,0],dimensions:[2,2,1],material:'graphite'},
 {name:'Orb',type:'sphere',location:[2,0,1],dimensions:[1,1,1],material:'copper'},
 {name:'Pillar',type:'cylinder',location:[-2,0,1],dimensions:[1,1,2],material:'teal'}],
 animations:[{object:'Orb',axis:'Z',degrees:180,start:1,end:32}]});
function unpack(bytes){
 assert.ok(bytes instanceof Uint8Array);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 assert.equal(view.getUint32(0,true),0x46546c67);
 assert.equal(view.getUint32(4,true),2);
 assert.equal(view.getUint32(8,true),bytes.byteLength);
 const jsonLength=view.getUint32(12,true),jsonType=view.getUint32(16,true);
 assert.equal(jsonType,0x4e4f534a);
 assert.equal(jsonLength%4,0);
 const json=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+jsonLength)).trim());
 const binOffset=20+jsonLength,binLength=view.getUint32(binOffset,true);
 assert.equal(view.getUint32(binOffset+4,true),0x004e4942);
 assert.equal(binOffset+8+binLength,bytes.byteLength);
 assert.equal(binLength%4,0);
 return {json,bin:bytes.slice(binOffset+8),view};
}
test('exports a valid glTF 2.0 binary with 3 distinct triangle meshes and inline PBR materials',()=>{
 const input=scene();const before=JSON.stringify(input);
 const {json,bin}=unpack(buildSceneGlb(input,1));
 assert.equal(json.asset.version,'2.0');
 assert.equal(json.scene,0);
 assert.equal(json.scenes[0].nodes.length,3);
 assert.equal(json.meshes.length,3);
 assert.equal(json.nodes.length,3);
 assert.deepEqual(json.nodes.map(x=>x.name),['Foundation','Orb','Pillar']);
 assert.equal(json.materials.length,3);
 assert.equal(json.buffers[0].byteLength,bin.length);
 for(const mesh of json.meshes){
  assert.equal(mesh.primitives.length,1);
  const p=mesh.primitives[0];
  assert.equal(p.mode,4);
  for(const channel of ['POSITION','NORMAL']){
   const a=json.accessors[p.attributes[channel]],v=json.bufferViews[a.bufferView];
   assert.equal(a.componentType,5126);assert.equal(a.type,'VEC3');assert.equal(a.count%3,0);
   assert.ok(a.count>0);assert.equal(v.byteOffset%4,0);assert.equal(v.byteLength,a.count*3*4);
   assert.ok(v.byteOffset+v.byteLength<=bin.length);
  }
  assert.ok(json.materials[p.material].pbrMetallicRoughness.baseColorFactor.every(x=>x>=0&&x<=1));
 }
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(validateScene(input),input);
});
test('repeat export is byte-identical and deterministic',()=>{
 const a=buildSceneGlb(scene(),32),b=buildSceneGlb(scene(),32);
 assert.deepEqual(a,b);
 assert.notDeepEqual(buildSceneGlb(scene(),1),a);
});
test('real world geometry includes Z-up to glTF Y-up rotation and correct mins/maxs',()=>{
 const input=scene();input.objects=input.objects.slice(0,1);input.animations=[];
 const {json,bin}=unpack(buildSceneGlb(input,1));
 const position=json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
 assert.deepEqual(position.min,[-1,-.5,-1]);
 assert.deepEqual(position.max,[1,.5,1]);
 const v=json.bufferViews[position.bufferView],data=new DataView(bin.buffer,bin.byteOffset+v.byteOffset,v.byteLength);
 for(let i=0;i<position.count*3;i++) assert.ok(Number.isFinite(data.getFloat32(4*i,true)));
});
test('rejects hostile or invalid scene input and out-of-range frame',()=>{
 assert.throws(()=>buildSceneGlb({...scene(),script:'bad'},1),/SCENE_PREVIEW_INVALID_SCHEMA/);
 assert.throws(()=>buildSceneGlb({...scene(),objects:[]},1),/SCENE_PREVIEW_INVALID_SCHEMA/);
 for(const f of [0,-1,32.3,33,NaN,Infinity,'1',null])assert.throws(()=>buildSceneGlb(scene(),f),/GLB_FRAME_INVALID/);
 assert.throws(()=>buildSceneGlb('{',1),/GLB_SCENE_INVALID/);
});
test('signed and offline UI expose download while retaining no-cost/no-network isolation',()=>{
 const html=readFileSync(new URL('../public_v03/index.html',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../public_v03/glb-export.mjs',import.meta.url),'utf8');
 const gen=readFileSync(new URL('../../../ops/studio_v03_export_offline_keyframe_editor_20261022.py',import.meta.url),'utf8');
 assert.ok(html.includes('id="scene-download-glb"'));
 assert.ok(html.includes('type="module" src="/glb-export.mjs"'));
 assert.ok(gen.includes('glb-export.mjs'));
 assert.ok(preview.includes('buildSceneGlb'));
 assert.doesNotMatch(preview,/\bfetch\s*\(|\bXMLHttpRequest\b|eval\s*\(|https?:\/\//i);
});

test('single-file offline browser bundle has no duplicate top-level identifiers',()=>{
 const root=new URL('../../../',import.meta.url).pathname;
 const dir=mkdtempSync(join(tmpdir(),'musitu-glb-'));
 try{
  const output=join(dir,'studio.html');
  const result=childProcess.execFileSync('python',[
   root+'ops/studio_v03_export_offline_keyframe_editor_20261022.py','--output',output],{encoding:'utf8'});
  assert.match(result,/STUDIO_OFFLINE_KEYFRAME_EXPORT=PASS/);
  const page=readTemp(output,'utf8');
  const blocks=[...page.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length,1);
  const check=childProcess.spawnSync(process.execPath,['--check','--input-type=module'],
   {input:blocks[0][1],encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
