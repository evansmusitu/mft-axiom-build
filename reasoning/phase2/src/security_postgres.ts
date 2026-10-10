import type { Pool } from "pg";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { AuditRepository, AuthorizationGrantRepository, IdempotencyRepository } from "./repositories.ts";
import type {
  ApiAction, AuditEvent, AuditRecord, AuditVerificationResult, AuthorizationGrant,
  IdempotencyClaimInput, IdempotencyClaimResult, IdempotencyCompleteInput, StoredApiOutcome
} from "./types.ts";

const GENESIS="0".repeat(64);
const ACTIONS=new Set<ApiAction>(["fact:ingest","execution:create","execution:read","execution:replay","execution:job:read","evidence:acquire","model:compile","model:execute","model:dispatch","model:explain"]);
function req(v:string,l:string):string{if(typeof v!=="string"||!v.trim())throw new TypeError(`${l} is required`);return v;}
function act(v:ApiAction):ApiAction{if(!ACTIONS.has(v))throw new TypeError("Unsupported API action");return v;}
function time(v:string,l:string):string{req(v,l);if(!Number.isFinite(Date.parse(v)))throw new TypeError(`${l} must be an ISO-8601 timestamp`);return v;}
function checkGrant(g:AuthorizationGrant){req(g.grantId,"grantId");req(g.principalId,"principalId");req(g.tenantId,"tenantId");act(g.action);}
function checkClaim(i:IdempotencyClaimInput){req(i.principalId,"principalId");req(i.tenantId,"tenantId");act(i.action);req(i.idempotencyKeyHash,"idempotencyKeyHash");req(i.requestHash,"requestHash");time(i.createdAt,"createdAt");}
function checkOutcome(o:StoredApiOutcome){if(!Number.isInteger(o.statusCode)||o.statusCode<100||o.statusCode>599)throw new TypeError("statusCode must be an HTTP status");if(typeof o.bodyJson!=="string")throw new TypeError("bodyJson must be a string");req(o.contentType,"contentType");}
function core(e:AuditEvent,sequence:number,previousHash:string){return {
  requestedTenantId:e.requestedTenantId,requestId:e.requestId,principalId:e.principalId??null,action:e.action,resource:e.resource,
  credentialTokenHash:e.credentialTokenHash??null,authorizationDecisionHash:e.authorizationDecisionHash??null,
  requestHash:e.requestHash,idempotencyKeyHash:e.idempotencyKeyHash??null,outcome:e.outcome,timestamp:e.timestamp,sequence,previousHash
};}
function eventRow(r:any):AuditEvent{return {
  requestedTenantId:String(r.tenant_id),requestId:String(r.request_id),...(r.principal_id===null?{}:{principalId:String(r.principal_id)}),
  action:String(r.action) as ApiAction,resource:r.resource_json,
  ...(r.credential_token_hash===null?{}:{credentialTokenHash:String(r.credential_token_hash)}),
  ...(r.authorization_decision_hash===null?{}:{authorizationDecisionHash:String(r.authorization_decision_hash)}),
  requestHash:String(r.request_hash),...(r.idempotency_key_hash===null?{}:{idempotencyKeyHash:String(r.idempotency_key_hash)}),
  outcome:String(r.outcome),timestamp:String(r.occurred_at)
};}

export class PostgresSecurityRepository implements AuthorizationGrantRepository,IdempotencyRepository,AuditRepository {
  private readonly pool:Pool;
  constructor(pool:Pool){this.pool=pool;}

  async putGrant(g:AuthorizationGrant):Promise<void>{checkGrant(g);await this.pool.query(
    `INSERT INTO axiom_authorization_grants(principal_id,tenant_id,action,grant_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [g.principalId,g.tenantId,g.action,g.grantId]
  );}
  async listApplicable(principalId:string,tenantId:string):Promise<AuthorizationGrant[]>{
    req(principalId,"principalId");req(tenantId,"tenantId");
    const q=await this.pool.query(`SELECT grant_id,principal_id,tenant_id,action FROM axiom_authorization_grants WHERE principal_id=$1 AND tenant_id=$2 ORDER BY grant_id,action`,[principalId,tenantId]);
    return q.rows.map(r=>({grantId:String(r.grant_id),principalId:String(r.principal_id),tenantId:String(r.tenant_id),action:String(r.action) as ApiAction}));
  }

  async claim(i:IdempotencyClaimInput):Promise<IdempotencyClaimResult>{
    checkClaim(i);const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const inserted=await c.query(`
        INSERT INTO axiom_idempotency_records(principal_id,tenant_id,action,idempotency_key_hash,request_hash,status,created_at)
        VALUES($1,$2,$3,$4,$5,'IN_PROGRESS',$6) ON CONFLICT DO NOTHING RETURNING 1
      `,[i.principalId,i.tenantId,i.action,i.idempotencyKeyHash,i.requestHash,i.createdAt]);
      if(inserted.rowCount===1){await c.query("COMMIT");return {status:"CLAIMED"};}
      const existing=await c.query(`
        SELECT request_hash,status,status_code,body_json,content_type FROM axiom_idempotency_records
        WHERE principal_id=$1 AND tenant_id=$2 AND action=$3 AND idempotency_key_hash=$4 FOR UPDATE
      `,[i.principalId,i.tenantId,i.action,i.idempotencyKeyHash]);
      if(existing.rowCount!==1)throw new Error("Idempotency record disappeared during claim");
      const r=existing.rows[0];let result:IdempotencyClaimResult;
      if(String(r.request_hash)!==i.requestHash)result={status:"CONFLICT"};
      else if(String(r.status)==="COMPLETE"){
        if(r.status_code===null||r.body_json===null||r.content_type===null)throw new Error("Completed idempotency record is corrupt");
        result={status:"REPLAY",outcome:{statusCode:Number(r.status_code),bodyJson:String(r.body_json),contentType:String(r.content_type)}};
      }else result={status:"IN_PROGRESS"};
      await c.query("COMMIT");return result;
    }catch(e){try{await c.query("ROLLBACK");}catch{}throw e;}finally{c.release();}
  }

  async complete(i:IdempotencyCompleteInput,o:StoredApiOutcome):Promise<void>{
    checkClaim(i);time(i.completedAt,"completedAt");checkOutcome(o);const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const q=await c.query(`SELECT request_hash,status,status_code,body_json,content_type FROM axiom_idempotency_records
        WHERE principal_id=$1 AND tenant_id=$2 AND action=$3 AND idempotency_key_hash=$4 FOR UPDATE`,
        [i.principalId,i.tenantId,i.action,i.idempotencyKeyHash]);
      if(q.rowCount!==1)throw new Error("Cannot complete missing idempotency claim");
      const r=q.rows[0];
      if(String(r.request_hash)!==i.requestHash)throw new Error("Cannot complete conflicting idempotency request");
      if(String(r.status)==="COMPLETE"){
        const same=Number(r.status_code)===o.statusCode&&String(r.body_json)===o.bodyJson&&String(r.content_type)===o.contentType;
        if(!same)throw new Error("Idempotency outcome is already completed with different bytes");
        await c.query("COMMIT");return;
      }
      await c.query(`UPDATE axiom_idempotency_records SET status='COMPLETE',status_code=$1,body_json=$2,content_type=$3,completed_at=$4
        WHERE principal_id=$5 AND tenant_id=$6 AND action=$7 AND idempotency_key_hash=$8 AND request_hash=$9 AND status='IN_PROGRESS'`,
        [o.statusCode,o.bodyJson,o.contentType,i.completedAt,i.principalId,i.tenantId,i.action,i.idempotencyKeyHash,i.requestHash]);
      await c.query("COMMIT");
    }catch(e){try{await c.query("ROLLBACK");}catch{}throw e;}finally{c.release();}
  }

  async append(e:AuditEvent):Promise<AuditRecord>{
    req(e.requestedTenantId,"requestedTenantId");req(e.requestId,"requestId");act(e.action);req(e.requestHash,"requestHash");req(e.outcome,"outcome");time(e.timestamp,"timestamp");
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query(`INSERT INTO axiom_audit_heads(tenant_id,record_count,head_hash) VALUES($1,0,$2) ON CONFLICT DO NOTHING`,[e.requestedTenantId,GENESIS]);
      const h=await c.query(`SELECT record_count,head_hash FROM axiom_audit_heads WHERE tenant_id=$1 FOR UPDATE`,[e.requestedTenantId]);
      const sequence=Number(h.rows[0].record_count)+1,previousHash=String(h.rows[0].head_hash),recordHash=hashJson(core(e,sequence,previousHash) as any);
      await c.query(`INSERT INTO axiom_audit_records(
        tenant_id,sequence,request_id,principal_id,action,resource_json,credential_token_hash,authorization_decision_hash,
        request_hash,idempotency_key_hash,outcome,occurred_at,previous_hash,record_hash
      ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14)`,[
        e.requestedTenantId,sequence,e.requestId,e.principalId??null,e.action,JSON.stringify(e.resource),e.credentialTokenHash??null,
        e.authorizationDecisionHash??null,e.requestHash,e.idempotencyKeyHash??null,e.outcome,e.timestamp,previousHash,recordHash
      ]);
      await c.query(`UPDATE axiom_audit_heads SET record_count=$2,head_hash=$3 WHERE tenant_id=$1`,[e.requestedTenantId,sequence,recordHash]);
      await c.query("COMMIT");return {...structuredClone(e),sequence,previousHash,recordHash};
    }catch(err){try{await c.query("ROLLBACK");}catch{}throw err;}finally{c.release();}
  }

  async verifyStream(tenantId:string):Promise<AuditVerificationResult>{
    req(tenantId,"requestedTenantId");const c=await this.pool.connect();
    try{
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const [headQ,rowsQ]=await Promise.all([
        c.query(`SELECT record_count,head_hash FROM axiom_audit_heads WHERE tenant_id=$1`,[tenantId]),
        c.query(`SELECT * FROM axiom_audit_records WHERE tenant_id=$1 ORDER BY sequence`,[tenantId])
      ]);
      await c.query("COMMIT");
      const rows=rowsQ.rows,diagnostics:string[]=[];
      if(headQ.rowCount===0){
        if(rows.length)diagnostics.push("audit records exist without a persisted stream head");
        return diagnostics.length?{status:"MISMATCH",diagnostics}:{status:"MATCH",diagnostics:[]};
      }
      const head=headQ.rows[0];
      if(Number(head.record_count)!==rows.length)diagnostics.push("audit record count does not match persisted stream head");
      let previous=GENESIS;
      for(let i=0;i<rows.length;i++){
        const r=rows[i],seq=Number(r.sequence),expected=i+1;
        if(seq!==expected)diagnostics.push(`audit sequence mismatch at position ${expected}`);
        if(String(r.previous_hash)!==previous)diagnostics.push(`audit previous-hash mismatch at sequence ${seq}`);
        const recomputed=hashJson(core(eventRow(r),seq,String(r.previous_hash)) as any);
        if(recomputed!==String(r.record_hash))diagnostics.push(`audit record hash mismatch at sequence ${seq}`);
        previous=String(r.record_hash);
      }
      if(rows.length&&previous!==String(head.head_hash))diagnostics.push("audit tail hash does not match persisted stream head");
      if(!rows.length&&Number(head.record_count)!==0)diagnostics.push("audit stream head expects records but stream is empty");
      return diagnostics.length?{status:"MISMATCH",diagnostics}:{status:"MATCH",diagnostics:[]};
    }catch(e){try{await c.query("ROLLBACK");}catch{}throw e;}finally{c.release();}
  }
}
