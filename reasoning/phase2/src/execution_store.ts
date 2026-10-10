import { DatabaseSync } from "node:sqlite";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { ExecutionRepository } from "./repositories.ts";
import type { PlatformExecutionRecord, TenantScope } from "./types.ts";

function tenantId(scope:TenantScope):string {
  if(!scope?.tenantId?.trim())throw new TypeError("tenantId is required");
  return scope.tenantId;
}
function required(value:string,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function tableExists(db:DatabaseSync,name:string):boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}
function columns(db:DatabaseSync,name:string):string[] {
  return (db.prepare(`PRAGMA table_info(${name})`).all() as any[]).map(row=>String(row.name));
}
function recordCore(record:PlatformExecutionRecord):Omit<PlatformExecutionRecord,"recordHash"> {
  const {recordHash:_,...core}=record;
  return core;
}
function verifyRecord(scope:TenantScope,record:PlatformExecutionRecord,storedHash?:string):PlatformExecutionRecord {
  const tenant=tenantId(scope);
  if(!record.id)throw new TypeError("execution record id is required");
  if(record.tenantId!==tenant)throw new Error("Execution record tenant mismatch");
  const expected=hashJson(recordCore(record) as any);
  if(record.recordHash!==expected||(storedHash!==undefined&&storedHash!==expected))throw new Error("Stored execution record integrity mismatch");
  return record;
}

export class ExecutionStore implements ExecutionRepository {
  private readonly db:DatabaseSync;
  constructor(databasePath:string){
    this.db=new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    if(tableExists(this.db,"platform_executions")&&!columns(this.db,"platform_executions").includes("tenant_id")){
      throw new Error("Legacy Phase-2 SQLite schema detected: platform_executions has no tenant_id; archive or migrate this database before Phase 2.1");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS platform_executions (
        tenant_id TEXT NOT NULL,id TEXT NOT NULL,record_hash TEXT NOT NULL,record_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE IF NOT EXISTS execution_intents (
        tenant_id TEXT NOT NULL,intent_id TEXT NOT NULL,execution_id TEXT NOT NULL,record_hash TEXT NOT NULL,
        PRIMARY KEY (tenant_id, intent_id)
      );
    `);
  }
  close():void { this.db.close(); }

  async put(scope:TenantScope,record:PlatformExecutionRecord):Promise<void> {
    const tenant=tenantId(scope);
    verifyRecord(scope,record);
    this.db.prepare("INSERT INTO platform_executions(tenant_id,id,record_hash,record_json) VALUES (?,?,?,?)")
      .run(tenant,record.id,record.recordHash,JSON.stringify(record));
  }

  async get(scope:TenantScope,id:string):Promise<PlatformExecutionRecord> {
    const tenant=tenantId(scope);
    const row=this.db.prepare("SELECT record_hash,record_json FROM platform_executions WHERE tenant_id = ? AND id = ?").get(tenant,id) as any;
    if(!row)throw new Error(`Execution record not found for tenant ${tenant}: ${id}`);
    const record=JSON.parse(String(row.record_json)) as PlatformExecutionRecord;
    return verifyRecord(scope,record,String(row.record_hash));
  }

  async getByIntent(scope:TenantScope,executionIntentId:string):Promise<PlatformExecutionRecord|undefined> {
    const tenant=tenantId(scope),intent=required(executionIntentId,"executionIntentId");
    const mapping=this.db.prepare("SELECT execution_id,record_hash FROM execution_intents WHERE tenant_id=? AND intent_id=?").get(tenant,intent) as any;
    if(!mapping)return undefined;
    const row=this.db.prepare("SELECT record_hash,record_json FROM platform_executions WHERE tenant_id=? AND id=?").get(tenant,String(mapping.execution_id)) as any;
    if(!row)throw new Error("Execution intent mapping references a missing execution");
    const record=verifyRecord(scope,JSON.parse(String(row.record_json)) as PlatformExecutionRecord,String(row.record_hash));
    if(record.executionIntentId!==intent||String(mapping.record_hash)!==record.recordHash)throw new Error("Stored execution intent mapping integrity mismatch");
    return record;
  }

  async putForIntent(scope:TenantScope,executionIntentId:string,record:PlatformExecutionRecord):Promise<PlatformExecutionRecord> {
    const tenant=tenantId(scope),intent=required(executionIntentId,"executionIntentId");
    verifyRecord(scope,record);
    if(record.executionIntentId!==intent)throw new Error("Execution record intent mismatch");
    if(!record.executionRequestHash?.trim())throw new Error("Execution record request hash is required for an execution intent");
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const mapping=this.db.prepare("SELECT execution_id,record_hash FROM execution_intents WHERE tenant_id=? AND intent_id=?").get(tenant,intent) as any;
      if(mapping){
        const row=this.db.prepare("SELECT record_hash,record_json FROM platform_executions WHERE tenant_id=? AND id=?").get(tenant,String(mapping.execution_id)) as any;
        if(!row)throw new Error("Execution intent mapping references a missing execution");
        const existing=verifyRecord(scope,JSON.parse(String(row.record_json)) as PlatformExecutionRecord,String(row.record_hash));
        if(existing.executionIntentId!==intent||String(mapping.record_hash)!==existing.recordHash)throw new Error("Stored execution intent mapping integrity mismatch");
        if(existing.recordHash!==record.recordHash)throw new Error("Execution intent is already bound to a different execution record");
        this.db.exec("COMMIT");
        return existing;
      }

      const byId=this.db.prepare("SELECT record_hash,record_json FROM platform_executions WHERE tenant_id=? AND id=?").get(tenant,record.id) as any;
      if(byId){
        const existing=verifyRecord(scope,JSON.parse(String(byId.record_json)) as PlatformExecutionRecord,String(byId.record_hash));
        if(existing.recordHash!==record.recordHash)throw new Error("Execution record ID is already bound to different content");
      }else{
        this.db.prepare("INSERT INTO platform_executions(tenant_id,id,record_hash,record_json) VALUES (?,?,?,?)")
          .run(tenant,record.id,record.recordHash,JSON.stringify(record));
      }
      this.db.prepare("INSERT INTO execution_intents(tenant_id,intent_id,execution_id,record_hash) VALUES (?,?,?,?)")
        .run(tenant,intent,record.id,record.recordHash);
      this.db.exec("COMMIT");
      return record;
    }catch(error){
      try{this.db.exec("ROLLBACK");}catch{}
      throw error;
    }
  }
}
