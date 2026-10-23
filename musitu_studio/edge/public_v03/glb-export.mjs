/** MUSITU Studio V0.3 — pure, bounded, offline glTF 2.0 binary exporter.
 * Static geometry may be baked at a selected frame or exported as bounded animation. No scripts, URLs,
 * network, DOM credentials, server rendering or cloud storage is involved.
 * The signed Studio's server-side scene validation remains authoritative.
 */
import {parsePreviewScene,poseAtFrame,previewMeshTriangles} from './scene-preview.mjs';

const colors=Object.freeze({
  teal:[41,202,181],copper:[207,124,83],ivory:[222,229,217],
  graphite:[74,91,116],blueglass:[94,164,218],rubber:[55,70,84],wood:[168,129,91]
});
const XYZ=3, F32=5126, TRIANGLES=4;
const align4=n=>(n+3)&~3;
const convert=p=>[p[0],p[2],-p[1]]; // Z-up Blender => Y-up glTF, proper rotation.
const difference=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const normal=(a,b,c)=>{
  const u=difference(b,a),v=difference(c,a);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const length=Math.hypot(...n);
  return length>1e-10?n.map(x=>x/length):[0,1,0];
};
const linearColor=x=>{
  const v=x/255;
  return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
};

// Compose Euler X,Y,Z in the same intrinsic order as the on-screen preview:
// R = Rz * Ry * Rx. All axes are conjugated from Z-up to glTF Y-up.
const quatMul=(a,b)=>[
 a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
 a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
 a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
 a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const quatFor=(angles)=>{
 const axis=(x,y,z,theta)=>{
  const half=theta/2;return [x*Math.sin(half),y*Math.sin(half),z*Math.sin(half),Math.cos(half)];
 };
 const x=axis(1,0,0,angles.X),y=axis(0,0,-1,angles.Y),z=axis(0,1,0,angles.Z);
 const q=quatMul(quatMul(z,y),x),length=Math.hypot(...q);
 return q.map(v=>v/length);
};

export function buildSceneGlb(scene,frame=1,{animate=false}={}){
  if(scene===null||typeof scene!=='object'||Array.isArray(scene))
    throw Error('GLB_SCENE_INVALID');
  const s=parsePreviewScene(JSON.stringify(scene));
  if(!Number.isInteger(frame)||frame<1||frame>(s.frame_end??24))
    throw Error('GLB_FRAME_INVALID');
  if(typeof animate!=='boolean'||(animate&&frame!==1))throw Error('GLB_ANIMATION_FLAG_INVALID');
  const objects=poseAtFrame(s,frame),chunks=[],bufferViews=[],accessors=[],meshes=[],nodes=[],materials=[];
  let binSize=0;
  function addFloatBuffer(values,type,min,max,attribute=false){
    const stride=type==='SCALAR'?1:type==='VEC4'?4:type==='VEC3'?3:0;
    if(!stride||values.length%stride||values.length<stride)throw Error('GLB_GEOMETRY_INVALID');
    const length=values.length*4,offset=align4(binSize);
    if(offset+length>3_000_000)throw Error('GLB_GEOMETRY_TOO_LARGE');
    const data=new Uint8Array(length),view=new DataView(data.buffer);
    for(let i=0;i<values.length;i++){
      if(!Number.isFinite(values[i]))throw Error('GLB_NONFINITE_GEOMETRY');
      view.setFloat32(i*4,values[i],true);
    }
    chunks.push({offset,data});binSize=offset+length;
    const entry={buffer:0,byteOffset:offset,byteLength:length};
    if(attribute)entry.target=34962;
    const bufferView=bufferViews.push(entry)-1;
    const accessor={bufferView,componentType:F32,count:values.length/stride,type};
    if(min)accessor.min=min;
    if(max)accessor.max=max;
    return accessors.push(accessor)-1;
  }
  for(const o of objects){
    const positions=[],normals=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    // Animation lives in node TRS; mesh vertices must remain in local space.
    // Static exports intentionally retain their historical baked-world geometry.
    const vertexObject=animate?{...o,location:[0,0,0],rotations:{X:0,Y:0,Z:0}}:o;
    for(const triangle of previewMeshTriangles(vertexObject)){
      const pts=triangle.map(convert),n=normal(pts[0],pts[1],pts[2]);
      for(const p of pts){
        for(let a=0;a<3;a++){
          min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);
          positions.push(p[a]);normals.push(n[a]);
        }
      }
    }
    const p=addFloatBuffer(positions,'VEC3',min,max,true),n=addFloatBuffer(normals,'VEC3',undefined,undefined,true);
    const color=colors[o.material];
    const material=materials.push({name:o.material+'_'+o.name,
      pbrMetallicRoughness:{baseColorFactor:[...color.map(linearColor),1],metallicFactor:0,roughnessFactor:.67},
      doubleSided:true})-1;
    const mesh=meshes.push({name:o.name,primitives:[{attributes:{POSITION:p,NORMAL:n},material,mode:TRIANGLES}]})-1;
    nodes.push(animate?{name:o.name,mesh,translation:convert(o.location),rotation:quatFor(o.rotations)}:{name:o.name,mesh});
  }
  const gltf={asset:{version:'2.0',generator:'MUSITU Studio offline GLB exporter v0.3'},
    scene:0,scenes:[{name:s.job_id+' frame '+frame,nodes:nodes.map((_,i)=>i)}],
    nodes,meshes,materials,accessors,bufferViews,buffers:[{byteLength:align4(binSize)}]};
  if(animate&&(s.animations??[]).length){
    const keyCount=s.frame_end??24, fps=30;
    // A frame-by-frame sampling is bounded by the scene schema (<=120 frames,
    // <=16 tracks), and handles simultaneous X/Y/Z rotations correctly.
    const timeline=Array.from({length:keyCount},(_,i)=>Math.fround(i/fps));
    const input=addFloatBuffer(timeline,'SCALAR',[0],[Math.fround((keyCount-1)/fps)]);
    const animation={name:s.job_id+' rotation',channels:[],samplers:[]};
    for(let node=0;node<s.objects.length;node++){
      const obj=s.objects[node];
      if(!(s.animations??[]).some(track=>track.object===obj.name))continue;
      const output=[];let previous=null;
      for(let f=1;f<=keyCount;f++){
        const rotations=poseAtFrame(s,f)[node].rotations;
        let q=quatFor(rotations);
        // glTF slerp uses the shortest quaternion arc. Preserve 360°/720°
        // motion by continuous hemisphere selection between adjacent keys.
        if(previous&&previous.reduce((sum,value,i)=>sum+value*q[i],0)<0)
          q=q.map(x=>-x);
        output.push(...q);previous=q;
      }
      const access=addFloatBuffer(output,'VEC4');
      const sampler=animation.samplers.push({input,output:access,interpolation:'LINEAR'})-1;
      animation.channels.push({sampler,target:{node,path:'rotation'}});
    }
    if(animation.channels.length)gltf.animations=[animation];
    gltf.buffers[0].byteLength=align4(binSize);
  }
  const encoded=new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen=align4(encoded.length),binLen=align4(binSize);
  const total=12+8+jsonLen+8+binLen;
  if(total>4_000_000)throw Error('GLB_GEOMETRY_TOO_LARGE');
  const out=new Uint8Array(total),view=new DataView(out.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
  view.setUint32(12,jsonLen,true);view.setUint32(16,0x4e4f534a,true);
  out.fill(0x20,20,20+jsonLen);out.set(encoded,20);
  const binStart=20+jsonLen;view.setUint32(binStart,binLen,true);
  view.setUint32(binStart+4,0x004e4942,true);
  for(const chunk of chunks)out.set(chunk.data,binStart+8+chunk.offset);
  return out;
}

/** Exports sampled rotation animation, preserving every declared frame at 30fps. */
export function buildAnimatedSceneGlb(scene){return buildSceneGlb(scene,1,{animate:true})}

/** Download is an explicit user gesture; never submit, upload or render. */
function attachGlbDownload(){
  for(const [id,animated] of [['scene-download-glb',false],['scene-download-animated-glb',true]]){
    const button=document.getElementById(id);
    if(!button)continue;
    button.addEventListener('click',()=>{
    const status=document.getElementById('scene-preview-status');
    try{
      const scene=parsePreviewScene(document.getElementById('scene').value);
      const frame=Number(document.getElementById('scene-frame').value);
      const glb=animated?buildAnimatedSceneGlb(scene):buildSceneGlb(scene,frame);
      const url=URL.createObjectURL(new Blob([glb],{type:'model/gltf-binary'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='musitu-'+scene.job_id+(animated?'-animated':'-frame-'+frame)+'.glb';
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),15000);
      status.textContent=animated?'Saved animated GLB with '+(scene.frame_end??24)+' frames at 30fps. No cloud render or upload.':'Saved static 3D GLB mesh at frame '+frame+'. No cloud render or upload.';
    }catch(e){status.textContent='GLB export rejected: '+String(e.message||'invalid scene')}
    });
  }
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attachGlbDownload);
  else attachGlbDownload();
}
