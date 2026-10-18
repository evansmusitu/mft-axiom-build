/** Isolated Studio V0.3 policy. Never authorizes from unverified request headers. */
export const ROLE_ORDER=Object.freeze({viewer:0,editor:1,reviewer:2,owner:3});
export const MAX_SCENE_BYTES=65536;
export const MAX_R2_ARTIFACT_BYTES=5_000_000;
export const GLB_FILES=Object.freeze(['scene.blend','scene.glb','preview.png']);
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validSubject(sub){return typeof sub==='string'&&sub.length>0&&sub.length<=200&&!/[\u0000-\u001f]/.test(sub)}
export function globalAdmin(env,sub){
  if(!validSubject(sub))return false;
  const raw=env.STUDIO_V03_GLOBAL_ADMINS;
  if(typeof raw!=='string'||raw.length>10000)return false;
  return raw.split(',').map(x=>x.trim()).filter(validSubject).includes(sub);
}
export function can(role,operation){
  return ({
    view:['viewer','editor','reviewer','owner'],
    submit:['editor','reviewer','owner'],
    approve:['reviewer','owner'],
    dispatch:['reviewer','owner'],
    invite:['owner'],
    audit:['reviewer','owner']
  })[operation]?.includes(role)??false;
}
export function allowed(env,sub,role,operation){
  return globalAdmin(env,sub)||can(role,operation);
}
export function safeDailyLimit(value){
  const n=Number(value);
  return Number.isInteger(n)&&n>=1&&n<=25?n:2;
}
export function securityHeaders(){
  return {'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','x-frame-options':'DENY',
    'referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; frame-ancestors 'none'"};
}
export function safeObjectKey(jobId,filename){
  if(typeof jobId!=='string'||!UUID.test(jobId)||!GLB_FILES.includes(filename))
    throw Error('INVALID_ASSET_REFERENCE');
  return 'studio-v03/jobs/'+jobId+'/'+filename;
}
export function isModalDestination(value){
  try{
    const uri=new URL(value);
    return uri.protocol==='https:'&&uri.hostname.endsWith('.modal.run')&&
      uri.pathname==='/jobs'&&!uri.username&&!uri.password&&!uri.search&&!uri.hash;
  }catch{return false}
}
