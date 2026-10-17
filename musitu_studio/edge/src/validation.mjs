// No arbitrary Blender scripts, remote URLs, add-ons, or file paths are accepted.
const IDENT=/^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const PALETTE=new Set(['teal','copper','ivory','graphite','blueglass','rubber','wood']);
const PRIMITIVE=new Set(['cube','cylinder','sphere']);
const AXES=new Set(['X','Y','Z']);
function guard(x){if(!x)throw new Error('INVALID_SCENE');}
function fields(obj,req,opt=[]){
  guard(obj!==null&&typeof obj==='object'&&!Array.isArray(obj));
  const keys=Object.keys(obj), allowed=new Set([...req,...opt]);
  guard(req.every(k=>Object.hasOwn(obj,k))&&keys.every(k=>allowed.has(k)));
}
function num(v,min,max){guard(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max);}
function vec(v,min,max,positive=false){
  guard(Array.isArray(v)&&v.length===3);
  v.forEach(n=>num(n,min,max));if(positive)guard(v.every(n=>n>0));
}
export function validateScene(job) {
  fields(job,['schema','job_id','objects'],['animations','frame_end']);
  guard(job.schema==='musitu.blender.job.v1'&&typeof job.job_id==='string'&&IDENT.test(job.job_id));
  guard(Array.isArray(job.objects)&&job.objects.length>=1&&job.objects.length<=30);
  const names=new Set();
  for(const o of job.objects){
    fields(o,['name','type','location','dimensions','material']);
    guard(typeof o.name==='string'&&IDENT.test(o.name)&&!names.has(o.name));
    names.add(o.name);
    guard(PRIMITIVE.has(o.type)&&PALETTE.has(o.material));
    vec(o.location,-20,20);vec(o.dimensions,0,12,true);
  }
  const end=job.frame_end??24;
  guard(Number.isInteger(end)&&end>=2&&end<=120);
  const tracks=job.animations??[];
  guard(Array.isArray(tracks)&&tracks.length<=16);
  const keys=new Set();
  for(const a of tracks){
    fields(a,['object','axis','degrees','start','end']);
    const k=a.object+':'+a.axis;
    guard(names.has(a.object)&&AXES.has(a.axis)&&!keys.has(k));
    keys.add(k);num(a.degrees,-720,720);
    guard(Number.isInteger(a.start)&&Number.isInteger(a.end)&&a.start>=1&&a.start<a.end&&a.end<=end);
  }
  return job;
}
export async function sha256(data){
  const bytes=typeof data==='string'?new TextEncoder().encode(data):data;
  const b=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function equalSecret(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length<32||a.length!==b.length)return false;
  let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;
}
export function assetType(name){
  return ({'scene.blend':'application/octet-stream','scene.glb':'model/gltf-binary','preview.png':'image/png'})[name]||null;
}

/** Confirm each small Blender deliverable has the expected binary structure.
 * Intentionally bounded to the v0.6 320x200 preview and GLB v2 export contract.
 * This is structural verification, NOT a proof of harmless Blender content.
 */
export function validArtifactHeader(name, bytes){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<32)return false;
  if(name==='scene.blend'){
    return new TextDecoder().decode(bytes.subarray(0,7))==='BLENDER';
  }
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(name==='scene.glb'){
    return new TextDecoder().decode(bytes.subarray(0,4))==='glTF' &&
      view.getUint32(4,true)===2 && view.getUint32(8,true)===bytes.byteLength &&
      view.getUint32(12,true)>=2 && view.getUint32(12,true)<=bytes.byteLength-20 &&
      new TextDecoder().decode(bytes.subarray(16,20))==='JSON';
  }
  if(name==='preview.png'){
    const sig=[137,80,78,71,13,10,26,10];
    return sig.every((n,i)=>bytes[i]===n) &&
      view.getUint32(8,false)===13 &&
      new TextDecoder().decode(bytes.subarray(12,16))==='IHDR' &&
      view.getUint32(16,false)===320 && view.getUint32(20,false)===200;
  }
  return false;
}
