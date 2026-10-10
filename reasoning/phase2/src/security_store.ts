import { DatabaseSync } from "node:sqlite";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { AuditRepository, AuthorizationGrantRepository, IdempotencyRepository } from "./repositories.ts";
import type {
  ApiAction, AuditEvent, AuditRecord, AuditVerificationResult, AuthorizationGrant,
  IdempotencyClaimInput, IdempotencyClaimResult, IdempotencyCompleteInput, StoredApiOutcome
} from "./types.ts";

const GENESIS="0".repeat(64);
const ACTIONS=new Set<ApiAction>(["fact:ingest","execution:create","execution:read","execution:replay","execution:job:read","evidence:acquire","model:compile","model:execute","model:dispatch","model:explain"]);

function required(value:string,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function action(value:ApiAction):ApiAction {
  if(!ACTIONS.has(value))throw new TypeError("Unsupported API action");
  return value;
}
function timestamp(value:string,label:string):string {
  required(value,label);
  if(!Number.isFinite(Date.parse(value)))throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return value;
}
function outcome(value:StoredApiOutcome):StoredApiOutcome {
  if(!Number.isInteger(value.statusCode)||value.statusCode<100||value.statusCode>599)throw new TypeError("statusCode must be an HTTP status");
  if(typeof value.bodyJson!=="string")throw new TypeError("bodyJson must be a string");
  required(value.contentType,"contentType");
  return value;
}
function auditHashCore(event:AuditEvent,sequence:number,previousHash:string){
  return {
    requestedTenantId:event.requestedTenantId,
    requestId:event.requestId,
    principalId:event.principalId??null,
    action:event.action,
    resource:event.resource,
    credentialTokenHash:event.credentialTokenHash??null,
    authorizationDecisionHash:event.authorizationDecisionHash??null,
    requestHash:event.requestHash,
    idempotencyKeyHash:event.idempotencyKeyHash??null,
    outcome:event.outcome,
    timestamp:event.timestamp,
    sequence,
    previousHash
  };
}
function validateGrant(grant:AuthorizationGrant):void {
  required(grant.grantId,"grantId");required(grant.principalId,"principalId");required(grant.tenantId,"tenantId");action(grant.action);
}
function validateClaim(input:IdempotencyClaimInput):void {
  required(input.principalId,"principalId");required(input.tenantId,"tenantId");action(input.action);
  required(input.idempotencyKeyHash,"idempotencyKeyHash");required(input.requestHash,"requestHash");timestamp(input.createdAt,"createdAt");
}
function eventFromRow(row:any):AuditEvent {
  return {
    requestedTenantId:String(row.tenant_id),
    requestId:String(row.request_id),
    ...(row.principal_id===null?{}:{principalId:String(row.principal_id)}),
    action:String(row.action) as ApiAction,
    resource:JSON.parse(String(row.resource_json)),
    ...(row.credential_token_hash===null?{}:{credentialTokenHash:String(row.credential_token_hash)}),
    ...(row.authorization_decision_hash===null?{}:{authorizationDecisionHash:String(row.authorization_decision_hash)}),
    requestHash:String(row.request_hash),
    ...(row.idempotency_key_hash===null?{}:{idempotencyKeyHash:String(row.idempotency_key_hash)}),
    outcome:String(row.outcome),
    timestamp:String(row.occurred_at)
  };
}

export class SecurityStore implements AuthorizationGrantRepository,IdempotencyRepository,AuditRepository {
  private readonly db:DatabaseSync;
  constructor(databasePath:string){
    this.db=new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS axiom_authorization_grants(
        principal_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        action TEXT NOT NULL,
        grant_id TEXT NOT NULL,
        PRIMARY KEY(principal_id,tenant_id,action,grant_id)
      );
      CREATE TABLE IF NOT EXISTS axiom_idempotency_records(
        principal_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        action TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        status_code INTEGER,
        body_json TEXT,
        content_type TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        PRIMARY KEY(principal_id,tenant_id,action,idempotency_key_hash),
        CHECK(status IN ('IN_PROGRESS','COMPLETE'))
      );
      CREATE TABLE IF NOT EXISTS axiom_audit_heads(
        tenant_id TEXT PRIMARY KEY,
        record_count INTEGER NOT NULL,
        head_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS axiom_audit_records(
        tenant_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        principal_id TEXT,
        action TEXT NOT NULL,
        resource_json TEXT NOT NULL,
        credential_token_hash TEXT,
        authorization_decision_hash TEXT,
        request_hash TEXT NOT NULL,
        idempotency_key_hash TEXT,
        outcome TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        PRIMARY KEY(tenant_id,sequence)
      );
    `);
  }
  close():void{this.db.close();}

  async putGrant(grant:AuthorizationGrant):Promise<void>{
    validateGrant(grant);
    this.db.prepare(`
      INSERT OR IGNORE INTO axiom_authorization_grants(principal_id,tenant_id,action,grant_id)
      VALUES(?,?,?,?)
    `).run(grant.principalId,grant.tenantId,grant.action,grant.grantId);
  }
  async listApplicable(principalId:string,tenantId:string):Promise<AuthorizationGrant[]>{
    required(principalId,"principalId");required(tenantId,"tenantId");
    return this.db.prepare(`
      SELECT grant_id,principal_id,tenant_id,action
      FROM axiom_authorization_grants
      WHERE principal_id=? AND tenant_id=?
      ORDER BY grant_id,action
    `).all(principalId,tenantId).map((row:any)=>({
      grantId:String(row.grant_id),principalId:String(row.principal_id),tenantId:String(row.tenant_id),action:String(row.action) as ApiAction
    }));
  }

  async claim(input:IdempotencyClaimInput):Promise<IdempotencyClaimResult>{
    validateClaim(input);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const inserted=this.db.prepare(`
        INSERT OR IGNORE INTO axiom_idempotency_records(
          principal_id,tenant_id,action,idempotency_key_hash,request_hash,status,created_at
        ) VALUES(?,?,?,?,?,'IN_PROGRESS',?)
      `).run(input.principalId,input.tenantId,input.action,input.idempotencyKeyHash,input.requestHash,input.createdAt);
      if(Number(inserted.changes)===1){this.db.exec("COMMIT");return {status:"CLAIMED"};}
      const row:any=this.db.prepare(`
        SELECT request_hash,status,status_code,body_json,content_type
        FROM axiom_idempotency_records
        WHERE principal_id=? AND tenant_id=? AND action=? AND idempotency_key_hash=?
      `).get(input.principalId,input.tenantId,input.action,input.idempotencyKeyHash);
      if(!row)throw new Error("Idempotency record disappeared during claim");
      let result:IdempotencyClaimResult;
      if(String(row.request_hash)!==input.requestHash)result={status:"CONFLICT"};
      else if(String(row.status)==="COMPLETE"){
        if(row.status_code===null||row.body_json===null||row.content_type===null)throw new Error("Completed idempotency record is corrupt");
        result={status:"REPLAY",outcome:{statusCode:Number(row.status_code),bodyJson:String(row.body_json),contentType:String(row.content_type)}};
      }else result={status:"IN_PROGRESS"};
      this.db.exec("COMMIT");return result;
    }catch(err){try{this.db.exec("ROLLBACK");}catch{}throw err;}
  }

  async complete(input:IdempotencyCompleteInput,storedOutcome:StoredApiOutcome):Promise<void>{
    validateClaim(input);timestamp(input.completedAt,"completedAt");outcome(storedOutcome);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const row:any=this.db.prepare(`
        SELECT request_hash,status,status_code,body_json,content_type FROM axiom_idempotency_records
        WHERE principal_id=? AND tenant_id=? AND action=? AND idempotency_key_hash=?
      `).get(input.principalId,input.tenantId,input.action,input.idempotencyKeyHash);
      if(!row)throw new Error("Cannot complete missing idempotency claim");
      if(String(row.request_hash)!==input.requestHash)throw new Error("Cannot complete conflicting idempotency request");
      if(String(row.status)==="COMPLETE"){
        const same=Number(row.status_code)===storedOutcome.statusCode&&String(row.body_json)===storedOutcome.bodyJson&&String(row.content_type)===storedOutcome.contentType;
        if(!same)throw new Error("Idempotency outcome is already completed with different bytes");
        this.db.exec("COMMIT");return;
      }
      this.db.prepare(`
        UPDATE axiom_idempotency_records
        SET status='COMPLETE',status_code=?,body_json=?,content_type=?,completed_at=?
        WHERE principal_id=? AND tenant_id=? AND action=? AND idempotency_key_hash=? AND request_hash=? AND status='IN_PROGRESS'
      `).run(storedOutcome.statusCode,storedOutcome.bodyJson,storedOutcome.contentType,input.completedAt,input.principalId,input.tenantId,input.action,input.idempotencyKeyHash,input.requestHash);
      this.db.exec("COMMIT");
    }catch(err){try{this.db.exec("ROLLBACK");}catch{}throw err;}
  }

  async append(event:AuditEvent):Promise<AuditRecord>{
    required(event.requestedTenantId,"requestedTenantId");required(event.requestId,"requestId");action(event.action);
    required(event.requestHash,"requestHash");required(event.outcome,"outcome");timestamp(event.timestamp,"timestamp");
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const head:any=this.db.prepare("SELECT record_count,head_hash FROM axiom_audit_heads WHERE tenant_id=?").get(event.requestedTenantId);
      const sequence=head?Number(head.record_count)+1:1;
      const previousHash=head?String(head.head_hash):GENESIS;
      const recordHash=hashJson(auditHashCore(event,sequence,previousHash) as any);
      this.db.prepare(`
        INSERT INTO axiom_audit_records(
          tenant_id,sequence,request_id,principal_id,action,resource_json,credential_token_hash,
          authorization_decision_hash,request_hash,idempotency_key_hash,outcome,occurred_at,previous_hash,record_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        event.requestedTenantId,sequence,event.requestId,event.principalId??null,event.action,JSON.stringify(event.resource),
        event.credentialTokenHash??null,event.authorizationDecisionHash??null,event.requestHash,event.idempotencyKeyHash??null,
        event.outcome,event.timestamp,previousHash,recordHash
      );
      this.db.prepare(`
        INSERT INTO axiom_audit_heads(tenant_id,record_count,head_hash) VALUES(?,?,?)
        ON CONFLICT(tenant_id) DO UPDATE SET record_count=excluded.record_count,head_hash=excluded.head_hash
      `).run(event.requestedTenantId,sequence,recordHash);
      this.db.exec("COMMIT");
      return {...structuredClone(event),sequence,previousHash,recordHash};
    }catch(err){try{this.db.exec("ROLLBACK");}catch{}throw err;}
  }

  async verifyStream(requestedTenantId:string):Promise<AuditVerificationResult>{
    required(requestedTenantId,"requestedTenantId");
    const rows:any[]=this.db.prepare("SELECT * FROM axiom_audit_records WHERE tenant_id=? ORDER BY sequence").all(requestedTenantId) as any[];
    const head:any=this.db.prepare("SELECT record_count,head_hash FROM axiom_audit_heads WHERE tenant_id=?").get(requestedTenantId);
    const diagnostics:string[]=[];
    if(!head){
      if(rows.length)diagnostics.push("audit records exist without a persisted stream head");
      return diagnostics.length?{status:"MISMATCH",diagnostics}:{status:"MATCH",diagnostics:[]};
    }
    if(Number(head.record_count)!==rows.length)diagnostics.push("audit record count does not match persisted stream head");
    let previous=GENESIS;
    for(let i=0;i<rows.length;i++){
      const row=rows[i],expectedSequence=i+1;
      if(Number(row.sequence)!==expectedSequence)diagnostics.push(`audit sequence mismatch at position ${expectedSequence}`);
      if(String(row.previous_hash)!==previous)diagnostics.push(`audit previous-hash mismatch at sequence ${row.sequence}`);
      const event=eventFromRow(row);
      const recomputed=hashJson(auditHashCore(event,Number(row.sequence),String(row.previous_hash)) as any);
      if(recomputed!==String(row.record_hash))diagnostics.push(`audit record hash mismatch at sequence ${row.sequence}`);
      previous=String(row.record_hash);
    }
    if(rows.length&&previous!==String(head.head_hash))diagnostics.push("audit tail hash does not match persisted stream head");
    if(!rows.length&&Number(head.record_count)!==0)diagnostics.push("audit stream head expects records but stream is empty");
    return diagnostics.length?{status:"MISMATCH",diagnostics}:{status:"MATCH",diagnostics:[]};
  }
}
