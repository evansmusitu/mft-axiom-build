import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScene,assetType,equalSecret,sha256} from '../src/validation.mjs';
const good={schema:'musitu.blender.job.v1',job_id:'Proof_01',objects:[{name:'Cube',type:'cube',location:[0,0,0],dimensions:[1,1,1],material:'teal'}]};
test('accept restricted Blender scene',()=>assert.equal(validateScene(good),good));
test('reject executable fields',()=>assert.throws(()=>validateScene({...good,python:'print(1)'})));
test('reject path-like names',()=>assert.throws(()=>validateScene({...good,job_id:'../../etc'})));
test('reject nonfinite values',()=>assert.throws(()=>validateScene({...good,objects:[{...good.objects[0],location:[NaN,0,0]}]})));
test('reject bogus primitive',()=>assert.throws(()=>validateScene({...good,objects:[{...good.objects[0],type:'python'}]})));
test('reject unsupported material',()=>assert.throws(()=>validateScene({...good,objects:[{...good.objects[0],material:'script'}]})));
test('reject invalid frames',()=>assert.throws(()=>validateScene({...good,frame_end:121})));
test('reject unknown animation reference',()=>assert.throws(()=>validateScene({...good,animations:[{object:'Missing',axis:'X',degrees:30,start:1,end:10}]})));
test('reject duplicate names',()=>assert.throws(()=>validateScene({...good,objects:[good.objects[0],good.objects[0]]})));
test('reject oversized dimensions',()=>assert.throws(()=>validateScene({...good,objects:[{...good.objects[0],dimensions:[99,1,1]}]})));
test('accept valid animation',()=>assert.equal(validateScene({...good,animations:[{object:'Cube',axis:'X',degrees:30,start:1,end:12}]}).animations.length,1));
test('reject short or wrong authorization',()=>assert.equal(equalSecret('abc','abc'),false));
test('check strong authorization equality',()=>{const x='a'.repeat(40);assert.equal(equalSecret(x,x),true);assert.equal(equalSecret(x,'b'.repeat(40)),false);});
test('restrict deliverable types',()=>{assert.equal(assetType('scene.glb'),'model/gltf-binary');assert.equal(assetType('../db.sqlite'),null);});
test('SHA-256 stable',async()=>assert.equal(await sha256('hello'),'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'));

import {validArtifactHeader} from '../src/validation.mjs';
test('Blender signature is required',()=>{
  const f=new Uint8Array(64);f.set(new TextEncoder().encode('BLENDER'),0);
  assert.equal(validArtifactHeader('scene.blend',f),true);
  f[0]=0;assert.equal(validArtifactHeader('scene.blend',f),false);
});
test('GLB2 header requires exact length and first JSON chunk',()=>{
  const f=new Uint8Array(60),d=new DataView(f.buffer);
  f.set(new TextEncoder().encode('glTF'),0);d.setUint32(4,2,true);
  d.setUint32(8,60,true);d.setUint32(12,32,true);
  f.set(new TextEncoder().encode('JSON'),16);
  assert.equal(validArtifactHeader('scene.glb',f),true);
  d.setUint32(8,59,true);assert.equal(validArtifactHeader('scene.glb',f),false);
  d.setUint32(8,60,true);d.setUint32(4,1,true);assert.equal(validArtifactHeader('scene.glb',f),false);
  d.setUint32(4,2,true);f.set(new TextEncoder().encode('JS0N'),16);
  assert.equal(validArtifactHeader('scene.glb',f),false);
});
test('PNG requires exact signature and 320x200 IHDR',()=>{
  const f=new Uint8Array(60),d=new DataView(f.buffer);
  f.set(Uint8Array.from([137,80,78,71,13,10,26,10]),0);
  d.setUint32(8,13,false);f.set(new TextEncoder().encode('IHDR'),12);
  d.setUint32(16,320,false);d.setUint32(20,200,false);
  assert.equal(validArtifactHeader('preview.png',f),true);
  d.setUint32(20,201,false);assert.equal(validArtifactHeader('preview.png',f),false);
  d.setUint32(20,200,false);f[6]=0;
  assert.equal(validArtifactHeader('preview.png',f),false);
  assert.equal(validArtifactHeader('preview.png',f.subarray(0,20)),false);
});
test('other file types and view objects rejected',()=>{
  assert.equal(validArtifactHeader('secret.txt',new Uint8Array(100)),false);
  assert.equal(validArtifactHeader('scene.glb',{}),false);
});
