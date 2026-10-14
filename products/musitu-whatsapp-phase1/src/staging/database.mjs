import pg from 'pg';
import {createRuntimeRoleBoundPool} from '../postgres/runtime-role-guard.mjs';
import {PostgresTenantRepository} from '../postgres/tenant-repository.mjs';
let pool,guarded,repo;
export function database(){
 if(!pool){
  const value=process.env.DATABASE_URL;
  if(!value)throw Error('DATABASE_NOT_CONFIGURED');
  const url=new URL(value);
  if(url.username!=='musitu_runtime'||url.pathname!=='/musitu_whatsapp_phase1'||!url.hostname.endsWith('.neon.tech'))throw Error('DATABASE_IDENTITY_REJECTED');
  url.searchParams.set('sslmode','verify-full');
  pool=new pg.Pool({connectionString:url.href,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:5000,query_timeout:8000});
  pool.on('error',()=>{});
  guarded=createRuntimeRoleBoundPool({pool,expectedRole:'musitu_runtime'});
  repo=new PostgresTenantRepository({pool:guarded});
 }
 return {pool:guarded,rawPool:pool,repo};
}
export async function scoped(tenantId,subject,roles,work){
 if(!/^[0-9a-f-]{36}$/i.test(tenantId))throw Error('INVALID_TENANT');
 const c=await database().pool.connect();let discard;
 try{
  await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
  const {rows}=await c.query(`SELECT m.role FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=$1 AND m.actor_id=$2 AND m.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF m,t`,[tenantId,subject]);
  if(rows.length!==1||!roles.includes(rows[0].role))throw Error('ACCESS_DENIED');
  const result=await work(c);await c.query('COMMIT');return result;
 }catch(e){try{await c.query('ROLLBACK');}catch(f){discard=f;}throw e;}
 finally{c.release(discard);}
}
