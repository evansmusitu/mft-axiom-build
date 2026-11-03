import type {DatabaseSync} from "node:sqlite";
export const TENANT_FAIR_SCHEDULER_PROTOCOL="axiom.tenant-fair/v1";
export function initializeFairSQLite(db:DatabaseSync){
 db.exec("CREATE TABLE IF NOT EXISTS axiom_tenant_fair_mode(singleton INTEGER PRIMARY KEY CHECK(singleton=1));CREATE TABLE IF NOT EXISTS axiom_tenant_fair_cursor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),ordinal INTEGER NOT NULL CHECK(ordinal>=0));CREATE TABLE IF NOT EXISTS axiom_tenant_fair_served(tenant_id TEXT PRIMARY KEY,last_ordinal INTEGER NOT NULL CHECK(last_ordinal>0));");
}
export function enableFairSQLite(db:DatabaseSync){
 db.exec("BEGIN IMMEDIATE");
 try{
  initializeFairSQLite(db);
  db.prepare("INSERT OR IGNORE INTO axiom_tenant_fair_cursor VALUES(1,0)").run();
  db.prepare("INSERT OR IGNORE INTO axiom_tenant_fair_mode VALUES(1)").run();
  db.exec("COMMIT");
 }catch(e){try{db.exec("ROLLBACK");}catch{}throw e;}
}
export function selectFairSQLite(db:DatabaseSync,at:string):any{
 if(!db.prepare("SELECT 1 FROM axiom_tenant_fair_mode WHERE singleton=1").get())
  return db.prepare("SELECT * FROM distributed_execution_jobs WHERE status='PENDING' OR (status='LEASED' AND lease_expires_at<=?) ORDER BY created_at,job_id LIMIT 1").get(at);
 return db.prepare("SELECT j.* FROM distributed_execution_jobs j LEFT JOIN axiom_tenant_fair_served s ON s.tenant_id=j.tenant_id WHERE j.status='PENDING' OR (j.status='LEASED' AND j.lease_expires_at<=?) ORDER BY COALESCE(s.last_ordinal,0),j.created_at,j.job_id LIMIT 1").get(at);
}
export function recordFairSQLite(db:DatabaseSync,tenantId:string){
 if(!db.prepare("SELECT 1 FROM axiom_tenant_fair_mode WHERE singleton=1").get())return;
 const row=db.prepare("SELECT ordinal FROM axiom_tenant_fair_cursor WHERE singleton=1").get() as any;
 const ordinal=Number(row?.ordinal);
 if(!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>=Number.MAX_SAFE_INTEGER)
  throw new Error("Tenant scheduler cursor integrity mismatch");
 const next=ordinal+1;
 db.prepare("UPDATE axiom_tenant_fair_cursor SET ordinal=? WHERE singleton=1").run(next);
 db.prepare("INSERT INTO axiom_tenant_fair_served VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET last_ordinal=excluded.last_ordinal").run(tenantId,next);
}
