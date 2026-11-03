import type {Pool,PoolClient} from "pg";
export const TENANT_FAIR_POSTGRES_VERSION="1";
export async function enableFairPostgres(pool:Pool):Promise<void>{
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  await c.query("LOCK TABLE axiom_tenant_fair_mode IN EXCLUSIVE MODE");
  await c.query("INSERT INTO axiom_tenant_fair_cursor(singleton,ordinal) VALUES(TRUE,0) ON CONFLICT(singleton) DO NOTHING");
  await c.query("INSERT INTO axiom_tenant_fair_mode(singleton) VALUES(TRUE) ON CONFLICT(singleton) DO NOTHING");
  await c.query("COMMIT");
 }catch(e){try{await c.query("ROLLBACK")}catch{}throw e;}finally{c.release();}
}
export async function lockFairPostgres(c:PoolClient):Promise<boolean>{
 await c.query("LOCK TABLE axiom_tenant_fair_mode IN SHARE MODE");
 const mode=await c.query("SELECT 1 FROM axiom_tenant_fair_mode WHERE singleton=TRUE");
 if(!mode.rowCount)return false;
 const cursor=await c.query("SELECT ordinal FROM axiom_tenant_fair_cursor WHERE singleton=TRUE FOR UPDATE");
 if(cursor.rowCount!==1)throw new Error("Tenant scheduler cursor integrity mismatch");
 const ordinal=BigInt(cursor.rows[0].ordinal);
 if(ordinal<0n||ordinal>=9223372036854775807n)
  throw new Error("Tenant scheduler cursor integrity mismatch");
 return true;
}
export async function selectFairPostgres(c:PoolClient,at:string,enabled:boolean):Promise<any>{
 const query=enabled
 ?`SELECT j.* FROM axiom_distributed_execution_jobs j
   LEFT JOIN axiom_tenant_fair_served s ON s.tenant_id=j.tenant_id
   WHERE j.status='PENDING' OR (j.status='LEASED' AND j.lease_expires_at<=$1)
   ORDER BY COALESCE(s.last_ordinal,0),j.created_at,j.job_id
   LIMIT 1 FOR UPDATE OF j SKIP LOCKED`
 :`SELECT * FROM axiom_distributed_execution_jobs
   WHERE status='PENDING' OR (status='LEASED' AND lease_expires_at<=$1)
   ORDER BY created_at,job_id LIMIT 1 FOR UPDATE SKIP LOCKED`;
 const result=await c.query(query,[at]);return result.rows[0];
}
export async function recordFairPostgres(c:PoolClient,tenantId:string,enabled:boolean):Promise<void>{
 if(!enabled)return;
 const next=await c.query("UPDATE axiom_tenant_fair_cursor SET ordinal=ordinal+1 WHERE singleton=TRUE RETURNING ordinal");
 if(next.rowCount!==1)throw new Error("Tenant scheduler cursor integrity mismatch");
 await c.query(`INSERT INTO axiom_tenant_fair_served(tenant_id,last_ordinal) VALUES($1,$2)
 ON CONFLICT(tenant_id) DO UPDATE SET last_ordinal=EXCLUDED.last_ordinal`,[tenantId,next.rows[0].ordinal]);
}
