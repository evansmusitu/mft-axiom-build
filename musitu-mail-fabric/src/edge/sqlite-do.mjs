/** Private SQLite-backed Durable Object transport, staging only.
 *  No public HTTP route, customer mail, provider secret, or production DB.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {SQL_SCHEMA} from './sqlite-schema.mjs';
import {handleFeedbackRpc} from './feedback-rpc.mjs';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const respond=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:H});
const NAME='mmf-stage-tenant';
const QUERY=/^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
function authorized(given,secret){
 if(typeof secret!=='string'||secret.length<32||typeof given!=='string')return false;
 const a=createHash('sha256').update(given).digest(),b=createHash('sha256').update(secret).digest();
 return timingSafeEqual(a,b);
}
export class MmfStagingSqliteDO {
 constructor(ctx,env){
  if(!ctx?.storage?.sql?.exec)throw Error('SQLITE_DURABLE_OBJECT_REQUIRED');
  this.sql=ctx.storage.sql;this.storage=ctx.storage;this.stageEnv=env;this.secret=String(env.MMF_STORAGE_RPC_SECRET||'');
  if(this.secret.length<32)throw Error('MMF_RPC_SECRET_REQUIRED');
  // The schema is idempotent, and SQLite serializes operations per Durable Object.
  for(const statement of SQL_SCHEMA.split(';').map(s=>s.trim()).filter(Boolean))this.sql.exec(statement);
  this.sql.exec('CREATE TABLE IF NOT EXISTS mmf_staging_probes(probe_id TEXT PRIMARY KEY, seen_ms INTEGER NOT NULL) STRICT');
  this.sql.exec('CREATE TABLE IF NOT EXISTS mmf_staging_recovery(probe_id TEXT PRIMARY KEY, first_seen_ms INTEGER NOT NULL, recovery_count INTEGER NOT NULL, completed_ms INTEGER) STRICT');
 }
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/feedback-rpc')return handleFeedbackRpc(request,this.sql,this.stageEnv);
  if(!['/rpc','/stage-pitr-capability'].includes(path)||request.method!=='POST')return respond({error:'NOT_FOUND'},404);
  if(!authorized(request.headers.get('x-mmf-internal'),this.secret))return respond({error:'UNAUTHORIZED'},401);
  if(path==='/stage-pitr-capability'){
   // Staging-only, read-only: never accept restore bookmarks, rollback or writes.
   if(this.stageEnv.MMF_STAGE_ONLY!=='true'||this.stageEnv.MMF_REAL_SEND_ENABLED!=='false'||
      this.stageEnv.MMF_API_ENABLED!=='false'||this.stageEnv.MMF_WEBHOOK_ENABLED!=='false')
      return respond({error:'STAGING_ONLY'},403);
   if(typeof this.storage.getCurrentBookmark!=='function')return respond({error:'PITR_UNAVAILABLE'},503);
   try{
    const bookmark=await this.storage.getCurrentBookmark();
    if(typeof bookmark!=='string'||!/^[A-Za-z0-9-]{12,180}$/.test(bookmark))throw Error('INVALID_BOOKMARK');
    return respond({supported:true,bookmarkSha256:createHash('sha256').update(bookmark).digest('hex'),
      databaseSizeBytes:Number(this.sql.databaseSize)||0,restoreAttempted:false,customerDataUsed:false});
   }catch{return respond({error:'PITR_UNAVAILABLE'},503);}
  }
  try{
   const body=await request.text();if(body.length>120000)return respond({error:'PAYLOAD_TOO_LARGE'},413);
   const x=JSON.parse(body),sql=x?.sql,params=x?.params;
   if(typeof sql!=='string'||sql.length>100000||!QUERY.test(sql.trim())||sql.includes(';')||!Array.isArray(params)||params.length>100||params.some(p=>p!==null&&!['string','number','boolean'].includes(typeof p)))return respond({error:'INVALID_QUERY'},400);
   const result=this.sql.exec(sql,...params);
   const rows=result.toArray();
   // SqlStorageCursor.rowsWritten is a BILLING metric that also counts index
   // writes. It is NOT the SQLite affected-row count required by D1 .meta.changes.
   // No await occurs between the write and changes(), so this is one DO turn.
   const counted=this.sql.exec('SELECT changes() AS n').toArray();
   const changes=Number(counted[0]?.n);
   if(!Number.isSafeInteger(changes)||changes<0)throw Error('INVALID_SQL_AFFECTED_ROW_COUNT');
   return respond({success:true,rows,changes});
  }catch{return respond({error:'STORAGE_UNAVAILABLE'},503);}
 }
}
/** D1-style storage interface backed by one tenant-scoped, private Durable Object. */
export function createDurableSqlAdapter(namespace,secret){
 if(!namespace?.idFromName||!namespace?.get||typeof secret!=='string'||secret.length<32)throw TypeError('PRIVATE_DURABLE_STORAGE_REQUIRED');
 const instance=namespace.get(namespace.idFromName(NAME));
 if(!instance?.fetch)throw TypeError('DURABLE_OBJECT_BINDING_INVALID');
 async function execute(sql,params){
  const r=await instance.fetch(new Request('https://mmf-internal.invalid/rpc',{method:'POST',headers:{'content-type':'application/json','x-mmf-internal':secret},body:JSON.stringify({sql,params})}));
  if(!r.ok)throw Error('DURABLE_STORAGE_UNAVAILABLE');
  const v=await r.json();if(v.success!==true||!Array.isArray(v.rows)||!Number.isFinite(v.changes))throw Error('DURABLE_STORAGE_INVALID_RESPONSE');
  return v;
 }
 return Object.freeze({prepare(sql){
   if(typeof sql!=='string'||!QUERY.test(sql.trim()))throw TypeError('INVALID_SQL_STATEMENT');
   const bound=(params)=>Object.freeze({
     async run(){const r=await execute(sql,params);return {success:true,meta:{changes:r.changes}};},
     async first(){const r=await execute(sql,params);return r.rows[0]??null;},
     async all(){const r=await execute(sql,params);return {success:true,results:r.rows};}
   });
   return Object.freeze({...bound([]),bind(...params){return bound(params);}});
 }});
}

/** Resolve only the fixed private staging object's read-only PITR capability.
 * Never return the raw Cloudflare bookmark or expose restore operations.
 */
export async function inspectPrivateStagingPitr(namespace,secret){
 if(!namespace?.idFromName||!namespace?.get||typeof secret!=='string'||secret.length<32)
   throw Error('PRIVATE_STAGE_PITR_BINDING_REQUIRED');
 const stub=namespace.get(namespace.idFromName(NAME));
 const response=await stub.fetch(new Request('https://mmf-internal.invalid/stage-pitr-capability',{
   method:'POST',headers:{'x-mmf-internal':secret}
 }));
 if(!response.ok)throw Error('PITR_PROBE_UNAVAILABLE');
 const result=await response.json();
 if(result?.supported!==true||result.restoreAttempted!==false||result.customerDataUsed!==false||
   !/^[a-f0-9]{64}$/.test(result.bookmarkSha256||'')||
   !Number.isFinite(result.databaseSizeBytes)||result.databaseSizeBytes<0)
   throw Error('PITR_PROBE_INVALID');
 return Object.freeze(result);
}
