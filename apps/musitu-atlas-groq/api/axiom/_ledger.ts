import {neon} from '@neondatabase/serverless';
import {createHash} from 'node:crypto';
import {deny} from './_contract.js';

export type AttemptStatus='CLAIMED'|'DISPATCHING'|'SUCCEEDED'|'REVIEW_REQUIRED'|'DENIED';
export type ExecutionRecord={request_id:string;status:AttemptStatus;request_sha256:string;expression:string;created_at:string;updated_at:string;result:unknown;error_code:string|null};
const MAX_PER_DAY=20;
function db(){
 const uri=process.env.ATLAS_AXIOM_DATABASE_URL;
 if(!uri)throw deny(503,'Independent Axiom ledger is not connected.');
 return neon(uri,{fetchOptions:{cache:'no-store'}});
}
export function ledgerReady(){return Boolean(process.env.ATLAS_AXIOM_DATABASE_URL);}
function tenant(){
 const v=process.env.ATLAS_AXIOM_TENANT_ID||'atlas-private-owner';
 if(!/^[a-z0-9-]{3,64}$/.test(v))throw deny(503,'Invalid server-owned tenant configuration.');
 return v;
}
function auditDigest(requestId:string,kind:AttemptStatus,body:unknown){
 return createHash('sha256').update(JSON.stringify({version:'atlas-axiom-audit-v1',requestId,kind,body})).digest('hex');
}
export async function event(requestId:string,kind:AttemptStatus,body:Record<string,unknown>){
 const sql=db(),payload=JSON.stringify(body);
 await sql`INSERT INTO atlas_axiom_audit(request_id,event_name,event_sha256,payload)
 VALUES(${requestId}::uuid,${kind},${auditDigest(requestId,kind,body)},${payload}::jsonb)`;
}
export async function claim(id:string,key:string,requestHash:string,expression:string){
 const sql=db(),owner=tenant();
 const rows=await sql`
 INSERT INTO atlas_axiom_attempts(request_id,tenant_id,idempotency_key,request_sha256,operation,expression,status)
 VALUES (${id}::uuid,${owner},${key}::uuid,${requestHash},'arithmetic.evaluate',${expression},'CLAIMED')
 ON CONFLICT (tenant_id,idempotency_key) DO NOTHING
 RETURNING request_id,status`;
 if(rows.length!==1)throw deny(409,'This operation key was already submitted. No repeat Axiom call will be made. Check your saved operation status.');
 await event(id,'CLAIMED',{requestHash,operation:'arithmetic.evaluate'});
 // Atomic quota increment using a unique (tenant,UTC day) record.
 // Capacity is reserved before any external side effect. A denied request is not dispatched.
 const used=await sql`
 INSERT INTO atlas_axiom_quotas(tenant_id,utc_day,used)
 VALUES(${owner},(now() AT TIME ZONE 'UTC')::date,1)
 ON CONFLICT(tenant_id,utc_day) DO UPDATE
 SET used=atlas_axiom_quotas.used+1
 WHERE atlas_axiom_quotas.used<${MAX_PER_DAY}
 RETURNING used`;
 if(used.length!==1){
  await mark(id,'DENIED','DAILY_20_LIMIT',null);
  throw deny(429,'Daily safety ceiling of 20 Axiom operations reached. No call was made.');
 }
 return {requestId:id,quotaCount:Number(used[0].used)};
}
export async function start(id:string){
 const sql=db(),owner=tenant();
 const result=await sql`
 UPDATE atlas_axiom_attempts SET status='DISPATCHING',updated_at=now()
 WHERE request_id=${id}::uuid AND tenant_id=${owner} AND status='CLAIMED'
 RETURNING request_id`;
 if(result.length!==1)throw deny(409,'Operation already dispatched, declined or is not owned by this tenant.');
 await event(id,'DISPATCHING',{note:'Axiom dispatch is authorized exactly once. Ambiguous responses are not retried.'});
}
export async function mark(id:string,status:'SUCCEEDED'|'REVIEW_REQUIRED'|'DENIED',reason:string,receipt:unknown){
 const sql=db(),owner=tenant(),body=receipt?JSON.stringify(receipt):null;
 const updated=await sql`
 UPDATE atlas_axiom_attempts
 SET status=${status},result=${body}::jsonb,error_code=${reason},updated_at=now()
 WHERE request_id=${id}::uuid AND tenant_id=${owner}
   AND status IN('CLAIMED','DISPATCHING')
 RETURNING request_id`;
 if(updated.length!==1)throw deny(409,'Operation not in a terminal-transition state.');
 await event(id,status,{reason,resultDigest:body?createHash('sha256').update(body).digest('hex'):null});
}
export async function lookup(idempotencyKey:string):Promise<ExecutionRecord|null>{
 const sql=db(),owner=tenant();
 const rows=await sql`
 SELECT request_id,status,request_sha256,expression,created_at,updated_at,result,error_code
 FROM atlas_axiom_attempts
 WHERE tenant_id=${owner} AND idempotency_key=${idempotencyKey}::uuid
 LIMIT 1`;
 return (rows[0] as ExecutionRecord)||null;
}
export async function auditStatus(){
 const sql=db(),owner=tenant();
 const [requests,events,used]=await Promise.all([
  sql`SELECT COUNT(*)::int count FROM atlas_axiom_attempts WHERE tenant_id=${owner}`,
  sql`SELECT COUNT(*)::int count FROM atlas_axiom_audit a JOIN atlas_axiom_attempts r ON r.request_id=a.request_id WHERE r.tenant_id=${owner}`,
  sql`SELECT used FROM atlas_axiom_quotas WHERE tenant_id=${owner} AND utc_day=(now() AT TIME ZONE 'UTC')::date`
 ]);
 return {requests:Number(requests[0]?.count||0),auditEvents:Number(events[0]?.count||0),todayUsed:Number(used[0]?.used||0),dailyMax:MAX_PER_DAY};
}
