import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as glb from '../public_v03/glb-export.mjs';
const buildAnimatedSceneGlb=(...args)=>glb.buildAnimatedSceneGlb(...args);
const buildSceneGlb=glb.buildSceneGlb;

const sample=()=>({schema:'musitu.blender.job.v1',job_id:'SpinDemo',frame_end:32,
 objects:[{name:'Orbit',type:'cube',location:[2,3,4],dimensions:[2,4,6],material:'teal'},
 {name:'Still',type:'sphere',location:[-2,0,1],dimensions:[1,1,1],material:'copper'}],
 animations:[{object:'Orbit',axis:'Z',degrees:180,start:1,end:32}]});
function parse(bytes){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 assert.equal(d.getUint32(0,true),0x46546c67);
 assert.equal(d.getUint32(4,true),2);
 assert.equal(d.getUint32(8,true),bytes.byteLength);
 const n=d.getUint32(12,true);
 assert.equal(d.getUint32(16,true),0x4e4f534a);
 const data=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+n)).trim());
 const offset=20+n;
 assert.equal(d.getUint32(offset+4,true),0x004e4942);
 const len=d.getUint32(offset,true);
 assert.equal(offset+8+len,bytes.length);
 return {data,bin:bytes.slice(offset+8)};
}
function access(data,bin,index){
 const a=data.accessors[index],v=data.bufferViews[a.bufferView],stride=a.type==='SCALAR'?1:a.type==='VEC4'?4:3;
 assert.equal(a.componentType,5126);assert.equal(v.byteOffset%4,0);
 assert.equal(v.byteLength,a.count*stride*4);
 assert.ok(v.byteOffset+v.byteLength<=bin.length);
 return Array.from({length:a.count},(_,i)=>Array.from({length:stride},(_,j)=>new DataView(bin.buffer,bin.byteOffset+v.byteOffset).getFloat32((i*stride+j)*4,true)));
}
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
test('animated GLB contains local geometry, Y-up node translation and 32 quaternion keys in seconds',()=>{
 const original=sample(), before=JSON.stringify(original);
 const {data,bin}=parse(buildAnimatedSceneGlb(original));
 assert.equal(JSON.stringify(original),before);
 assert.deepEqual(data.nodes[0].translation,[2,4,-3]);
 assert.deepEqual(data.nodes[1].translation,[-2,1,0]);
 assert.equal(data.meshes.length,2);
 const p=data.accessors[data.meshes[0].primitives[0].attributes.POSITION];
 assert.deepEqual(p.min,[-1,-3,-2]);assert.deepEqual(p.max,[1,3,2]);
 assert.equal(data.animations.length,1);
 const a=data.animations[0];assert.equal(a.channels.length,1);assert.equal(a.samplers.length,1);
 assert.deepEqual(a.channels[0].target,{node:0,path:'rotation'});
 assert.equal(a.samplers[0].interpolation,'LINEAR');
 const times=access(data,bin,a.samplers[0].input);
 const quats=access(data,bin,a.samplers[0].output);
 assert.equal(data.accessors[a.samplers[0].input].type,'SCALAR');
 assert.equal(data.accessors[a.samplers[0].output].type,'VEC4');
 assert.equal(times.length,32);assert.equal(quats.length,32);
 near(times[0][0],0);near(times[31][0],31/30);
 for(let i=1;i<times.length;i++)assert.ok(times[i][0]>times[i-1][0]);
 near(quats[0][3],1);near(quats[31][1],1);near(quats[31][3],0);
 for(const q of quats)near(Math.hypot(...q),1);
});
test('multi-axis rotations are normalized; 720-degree spin preserves full turns',()=>{
 const input=sample();input.animations=[
 {object:'Orbit',axis:'X',degrees:90,start:1,end:32},
 {object:'Orbit',axis:'Y',degrees:-180,start:1,end:32},
 {object:'Orbit',axis:'Z',degrees:720,start:1,end:32}];
 const {data,bin}=parse(buildAnimatedSceneGlb(input));
 const a=data.animations[0].samplers[0];const q=access(data,bin,a.output);
 assert.equal(q.length,32);
 for(let i=0;i<q.length;i++){
  near(Math.hypot(...q[i]),1);
  if(i)assert.ok(q[i].reduce((sum,v,k)=>sum+v*q[i-1][k],0)>0);
 }
 assert.notDeepEqual(q[31],q[0]);
 assert.deepEqual(buildAnimatedSceneGlb(input),buildAnimatedSceneGlb(input));
});
test('no tracks means no fake animation; static exporter retains frozen geometry',()=>{
 const input=sample();input.animations=[];
 const {data}=parse(buildAnimatedSceneGlb(input));
 assert.equal(data.animations,undefined);
 const frozen=parse(buildSceneGlb(sample(),20)).data;
 assert.equal(frozen.animations,undefined);
 assert.equal(frozen.nodes[0].translation,undefined);
});
test('browser surfaces animated export without network APIs or scripts',()=>{
 const html=readFileSync(new URL('../public_v03/index.html',import.meta.url),'utf8');
 const source=readFileSync(new URL('../public_v03/glb-export.mjs',import.meta.url),'utf8');
 assert.match(html,/id="scene-download-animated-glb"/);
 assert.match(source,/buildAnimatedSceneGlb/);
 assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|eval\s*\(/);
});
test('animated local geometry + sampled node quaternion equals static baked geometry for concurrent XYZ',()=>{
 const input=sample();input.animations=[
  {object:'Orbit',axis:'X',degrees:70,start:1,end:25},
  {object:'Orbit',axis:'Y',degrees:120,start:5,end:30},
  {object:'Orbit',axis:'Z',degrees:-255,start:3,end:32}];
 const anim=parse(buildAnimatedSceneGlb(input)),staticGltf=parse(buildSceneGlb(input,17));
 const sampler=anim.data.animations[0].samplers[0],qs=access(anim.data,anim.bin,sampler.output);
 const q=qs[16],offset=anim.data.nodes[0].translation;
 const rotatePoint=p=>{
  const [x,y,z,w]=q;
  const t=[2*(y*p[2]-z*p[1]),2*(z*p[0]-x*p[2]),2*(x*p[1]-y*p[0])];
  return p.map((v,i)=>v+w*t[i]+[y*t[2]-z*t[1],z*t[0]-x*t[2],x*t[1]-y*t[0]][i]+offset[i]);
 };
 const pa=access(anim.data,anim.bin,anim.data.meshes[0].primitives[0].attributes.POSITION);
 const ps=access(staticGltf.data,staticGltf.bin,staticGltf.data.meshes[0].primitives[0].attributes.POSITION);
 assert.equal(pa.length,ps.length);
 for(let i=0;i<pa.length;i++){
  const transformed=rotatePoint(pa[i]);
  for(let k=0;k<3;k++)near(transformed[k],ps[i][k],2e-5);
 }
});

test('a 720-degree rotation in a single frame interval has enough keys to preserve two turns',()=>{
 const input=sample();input.frame_end=2;
 input.animations=[{object:'Orbit',axis:'Z',degrees:720,start:1,end:2}];
 const {data,bin}=parse(buildAnimatedSceneGlb(input));
 const sampler=data.animations[0].samplers[0];
 const times=access(data,bin,sampler.input).map(v=>v[0]);
 const rotations=access(data,bin,sampler.output);
 assert.ok(times.length>=9,'need intermediate subframe samples for 720-degree spin');
 assert.equal(rotations.length,times.length);
 near(times[0],0);near(times.at(-1),1/30);
 for(let i=1;i<times.length;i++){
  assert.ok(times[i]>times[i-1],'strictly increasing glTF keyframe time');
  const dot=rotations[i].reduce((s,x,k)=>s+x*rotations[i-1][k],0);
  assert.ok(dot>0.70,`rotation cannot jump across shortest arc: ${dot}`);
 }
 const mid=Math.floor((rotations.length-1)/2);
 // At frame 1.5 (360 degrees), quaternion must reach the opposite hemisphere.
 near(rotations[mid][3],-1,0.0001);
});

test('simultaneous compressed XYZ rotations use a common bounded subframe timeline',()=>{
 const input=sample();input.frame_end=3;
 input.animations=[
  {object:'Orbit',axis:'X',degrees:720,start:1,end:2},
  {object:'Orbit',axis:'Y',degrees:-720,start:1,end:2},
  {object:'Orbit',axis:'Z',degrees:720,start:1,end:2},
  {object:'Still',axis:'Z',degrees:360,start:1,end:2},
 ];
 const {data,bin}=parse(buildAnimatedSceneGlb(input));
 assert.equal(data.animations[0].channels.length,2);
 const [first,second]=data.animations[0].samplers;
 assert.equal(first.input,second.input);
 const times=access(data,bin,first.input).map(t=>t[0]);
 assert.ok(times.length>24,'combined angular speed requires subdivision');
 assert.ok(times.length<100,'must remain bounded');
 const q=access(data,bin,first.output);
 for(let i=1;i<q.length;i++){
  assert.ok(times[i]>times[i-1]);
  assert.ok(q[i].reduce((s,x,k)=>s+x*q[i-1][k],0)>0.69);
 }
 near(times.at(-1),2/30);
});
