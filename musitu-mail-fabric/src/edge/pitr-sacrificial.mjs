/** Private, disposable, separate-class Cloudflare Durable Object.
 * Intentionally destructive only to the newly created per-probe sandbox instance.
 * Never route to the operational staging tenant's Durable Object.
 */
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const PROBE=/^probe-[a-z0-9-]{8,56}$/;
const BOOKMARK=/^[a-zA-Z0-9-]{12,180}$/;
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const fingerprint=s=>createHash('sha256').update(s).digest('hex');
function stage(env){
 return env?.MMF_STAGE_ONLY==='true'&&env?.MMF_REAL_SEND_ENABLED==='false'&&
 env?.MMF_API_ENABLED==='false'&&env?.MMF_WEBHOOK_ENABLED==='false'&&
 env?.MMF_STAGE_PITR_RESTORE_ENABLED==='true'&&
 typeof env?.MMF_STORAGE_RPC_SECRET==='string'&&env.MMF_STORAGE_RPC_SECRET.length>=32;
}
function auth(sent,secret){
 if(typeof sent!=='string'||!sent||typeof secret!=='string'||secret.length<32)return false;
 const a=createHash('sha256').update(sent).digest(),b=createHash('sha256').update(secret).digest();
 return timingSafeEqual(a,b);
}
const tag=(secret,probeId,bookmark)=>createHmac('sha256',secret).update('MMF_ISOLATED_SACRIFICIAL_PITR_V1:'+probeId+':'+bookmark).digest('hex');
export class MmfPitrSacrificialDO {
 constructor(ctx,env){
  if(!ctx?.storage?.sql?.exec)throw Error('SACRIFICIAL_SQLITE_REQUIRED');
  this.ctx=ctx;this.storage=ctx.storage;this.sql=ctx.storage.sql;this.env=env;
  this.sql.exec('CREATE TABLE IF NOT EXISTS mmf_sacrificial_pitr(probe_id TEXT PRIMARY KEY,phase TEXT NOT NULL) STRICT');
 }
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(request.method!=='POST'||!['/checkpoint','/mutate','/restore','/inspect'].includes(path))
   return response({error:'NOT_FOUND'},404);
  if(!auth(request.headers.get('x-mmf-internal'),this.env.MMF_STORAGE_RPC_SECRET))
   return response({error:'UNAUTHORIZED'},401);
  if(!stage(this.env))return response({error:'STAGING_PITR_GATE'},403);
  let input;try{
   const raw=await request.text();if(raw.length>1500)return response({error:'PAYLOAD_TOO_LARGE'},413);
   input=JSON.parse(raw);
  }catch{return response({error:'INVALID_JSON'},400)}
  if(!input||!PROBE.test(input.probeId||''))return response({error:'INVALID_SACRIFICIAL_PROBE'},422);
  try{
   const row=()=>this.sql.exec('SELECT probe_id,phase FROM mmf_sacrificial_pitr WHERE probe_id=?',input.probeId).toArray()[0]||null;
   if(path==='/checkpoint'){
    if(this.sql.exec('SELECT COUNT(*) AS n FROM mmf_sacrificial_pitr').toArray()[0]?.n!==0)
     return response({error:'NONEMPTY_SANDBOX_REFUSED'},409);
    this.sql.exec('INSERT INTO mmf_sacrificial_pitr(probe_id,phase) VALUES(?,?)',input.probeId,'baseline');
    if(row()?.phase!=='baseline')throw Error('SANDBOX_INITIALIZATION_FAILED');
    const bookmark=await this.storage.getCurrentBookmark();
    if(typeof bookmark!=='string'||!BOOKMARK.test(bookmark))throw Error('INVALID_BOOKMARK');
    return response({phase:'baseline',bookmark,tag:tag(this.env.MMF_STORAGE_RPC_SECRET,input.probeId,bookmark)});
   }
   const previous=row();
   if(!previous||previous.probe_id!==input.probeId)return response({error:'PROBE_NOT_FOUND'},404);
   if(path==='/mutate'){
    if(previous.phase!=='baseline')return response({error:'PHASE_MISMATCH'},409);
    this.sql.exec('UPDATE mmf_sacrificial_pitr SET phase=? WHERE probe_id=? AND phase=?',
       'altered',input.probeId,'baseline');
    if(row()?.phase!=='altered')throw Error('ALTERATION_NOT_VERIFIED');
    return response({phase:'altered',syntheticOnly:true});
   }
   if(path==='/inspect')return response({phase:previous.phase,syntheticOnly:true});
   if(previous.phase!=='altered'||typeof input.bookmark!=='string'||!BOOKMARK.test(input.bookmark)||
      typeof input.tag!=='string'||!/^[a-f0-9]{64}$/.test(input.tag))
     return response({error:'UNAUTHORIZED_RESTORE_PHASE'},409);
   const expected=Buffer.from(tag(this.env.MMF_STORAGE_RPC_SECRET,input.probeId,input.bookmark),'hex');
   if(!timingSafeEqual(expected,Buffer.from(input.tag,'hex')))
     return response({error:'INVALID_RESTORE_ATTESTATION'},403);
   if(typeof this.storage.onNextSessionRestoreBookmark!=='function'||typeof this.ctx.abort!=='function')
     throw Error('SACRIFICIAL_PITR_UNAVAILABLE');
   await this.storage.onNextSessionRestoreBookmark(input.bookmark);
   // The request intentionally terminates: caller must verify readback
   // from a NEW Durable Object session; a return value is not accepted as proof.
   this.ctx.abort('MMF_SACRIFICIAL_PITR_RESET', {retryAlarm:false});
   throw Error('PITR_ABORT_DID_NOT_RESET');
  }catch(error){
   if(error?.message==='PITR_ABORT_DID_NOT_RESET')return response({error:'RESET_NOT_PROVEN'},503);
   if(['SACRIFICIAL_PITR_UNAVAILABLE','INVALID_BOOKMARK'].includes(error?.message))
     return response({error:'PITR_UNAVAILABLE'},503);
   throw error; // genuine ctx.abort terminates execution, not recoverable in runtime.
  }
 }
}
/** Orchestrates a fresh, isolated SQLite DO rehearsal; NEVER uses MMF_LEDGER. */
export async function runSacrificialPitrDrill(namespace,env,probeId){
 if(!stage(env))throw Error('STAGING_PITR_GATE');
 if(typeof probeId!=='string'||!PROBE.test(probeId))throw Error('INVALID_SACRIFICIAL_PROBE');
 if(!namespace?.idFromName||!namespace?.get)throw Error('SACRIFICIAL_NAMESPACE_REQUIRED');
 const name='mmf-pitr-only-'+probeId;
 const stub=namespace.get(namespace.idFromName(name));
 if(!stub?.fetch)throw Error('SACRIFICIAL_BINDING_REQUIRED');
 const call=async(path,payload)=>stub.fetch(new Request('https://mmf-internal.invalid'+path,{
  method:'POST',headers:{'x-mmf-internal':env.MMF_STORAGE_RPC_SECRET,'content-type':'application/json'},
  body:JSON.stringify({probeId,...payload})
 }));
 const read=async(path,payload)=>{
  const r=await call(path,payload);
  if(!r.ok)throw Error('SACRIFICIAL_STAGE_'+path.slice(1).toUpperCase()+'_FAILED_'+r.status);
  return r.json();
 };
 // Inspect a NEW Queue invocation before attempting any new checkpoint.
 // A Durable Object abort can poison the same client stub for the rest of
 // the original Queue handler's invocation. Do not poll that stub in place.
 let priorPhase=null;
 try{
  const checked=await call('/inspect',{});
  if(checked.ok){const row=await checked.json();priorPhase=row?.phase;}
  else if(checked.status!==404)throw Error('SACRIFICIAL_INSPECT_REJECTED_'+checked.status);
 }catch(error){
  if(String(error?.message||'').startsWith('SACRIFICIAL_INSPECT_REJECTED_'))throw error;
  throw Error('SACRIFICIAL_INSPECT_NOT_AVAILABLE');
 }
 if(priorPhase==='baseline'){
  return Object.freeze({status:'PASS',wasRestored:true,afterPhase:'baseline',
   targetDedicatedSandbox:true,customerMailSent:false,mainTenantUntouched:true,
   verifiedOnSeparateQueueDelivery:true});
 }
 if(priorPhase==='altered')throw Error('SACRIFICIAL_ROLLBACK_NOT_YET_APPLIED');
 if(priorPhase!==null)throw Error('SACRIFICIAL_UNEXPECTED_OBJECT_STATE');
 const before=await read('/checkpoint');
 if(before.phase!=='baseline'||!BOOKMARK.test(before.bookmark||'')||!/^[a-f0-9]{64}$/.test(before.tag||''))
  throw Error('SACRIFICIAL_BOOKMARK_INVALID');
 const altered=await read('/mutate');
 if(altered.phase!=='altered')throw Error('SACRIFICIAL_ALTERATION_NOT_PROVEN');
 let interrupted=false;
 try{
  const attempt=await call('/restore',{bookmark:before.bookmark,tag:before.tag});
  if(!attempt.ok){
   let detail='UNKNOWN';
   try{const body=await attempt.json();if(['PITR_UNAVAILABLE','RESET_NOT_PROVEN','UNAUTHORIZED_RESTORE_PHASE',
     'INVALID_RESTORE_ATTESTATION','STAGING_PITR_GATE'].includes(body?.error))detail=body.error;}catch{}
   throw Error('SACRIFICIAL_RESTORE_REFUSED_'+detail);
  }
  throw Error('SACRIFICIAL_RESTORE_RETURNED_UNEXPECTED_SUCCESS');
 }catch(error){
  if(typeof error?.message==='string'&&error.message.startsWith('SACRIFICIAL_RESTORE_'))throw error;
  interrupted=true;
 }
 if(!interrupted)throw Error('SACRIFICIAL_RESTORE_NOT_TRIGGERED');
 // This is intentionally NOT a PASS. The next Queue delivery must observe
 // baseline after a brand-new actor session. The independent CI gate
 // correlates both phase observations using the unique probe fingerprint.
 return Object.freeze({status:'RETRY_REQUIRED',mutationVerified:true,
  rollbackRequested:true,bookmarkSha256:fingerprint(before.bookmark),
  targetDedicatedSandbox:true,customerMailSent:false,mainTenantUntouched:true});
}
