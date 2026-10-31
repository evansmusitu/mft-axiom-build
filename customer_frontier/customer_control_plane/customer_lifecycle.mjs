// Customer-facing cases and privacy request entry. S1 candidate, not a support backend or erase job.
// All principals MUST come from server-verified session + membership. No client tenant id accepted.
import {one,all,execute} from './ledger.mjs';
const valid=(x,lo,hi)=>typeof x==='string'&&x.trim().length>=lo&&x.length<=hi;
const permitted=new Set(['support','privacy_export','privacy_delete']);
const err=s=>{throw new Error(s)};
export async function createCustomerCase(db,principal,input,key){
 const {tenant_id,identity_id}=principal||{};
 if(!valid(tenant_id,1,150)||!valid(identity_id,1,150))err('identity_required');
 if(!valid(key,8,120)||!permitted.has(input?.kind)||!valid(input?.subject,4,160)||!valid(input?.detail,8,3000))err('invalid_customer_request');
 const previous=await one(db,'SELECT * FROM customer_cases WHERE tenant_id=? AND identity_id=? AND client_key=?',tenant_id,identity_id,key);
 if(previous){
  if(previous.kind!==input.kind||previous.subject!==input.subject||previous.detail!==input.detail)err('customer_request_key_collision');
  return {id:previous.id,status:previous.status,idempotent:true};
 }
 if(input.kind!=='support'){
  const outstanding=await one(db,`SELECT id FROM customer_cases WHERE tenant_id=? AND identity_id=?
      AND kind=? AND status IN ('requested','under_review')`,tenant_id,identity_id,input.kind);
  if(outstanding)err('privacy_request_already_pending');
 }
 const id=crypto.randomUUID();
 // Bounded unresolved requests prevents an untrusted account from creating unbounded tickets.
 // Written as a conditional insert to avoid read/check/write race on one D1 writer.
 try{
  const out=await execute(db,`INSERT INTO customer_cases(id,tenant_id,identity_id,client_key,kind,subject,detail)
    SELECT ?,?,?,?,?,?,? WHERE (?!='support' OR (SELECT COUNT(*) FROM customer_cases
    WHERE tenant_id=? AND identity_id=? AND kind='support' AND status IN ('requested','under_review'))<10)`,
    id,tenant_id,identity_id,key,input.kind,input.subject,input.detail,input.kind,tenant_id,identity_id);
  if(out.meta?.changes!==1)err('open_request_limit');
 }catch(e){
  const old=await one(db,'SELECT * FROM customer_cases WHERE tenant_id=? AND identity_id=? AND client_key=?',tenant_id,identity_id,key);
  if(old){
   if(old.kind!==input.kind||old.subject!==input.subject||old.detail!==input.detail)err('customer_request_key_collision');
   return {id:old.id,status:old.status,idempotent:true};
  }
  if(input.kind!=='support'){
   const outstanding=await one(db,`SELECT id FROM customer_cases WHERE tenant_id=? AND identity_id=?
      AND kind=? AND status IN ('requested','under_review')`,tenant_id,identity_id,input.kind);
   if(outstanding)err('privacy_request_already_pending');
  }
  throw e;
 }
 return {id,status:'requested',idempotent:false};
}
export async function listOwnCustomerCases(db,principal){
 if(!valid(principal?.tenant_id,1,150)||!valid(principal?.identity_id,1,150))err('identity_required');
 return all(db,`SELECT id,kind,subject,status,created_at FROM customer_cases
   WHERE tenant_id=? AND identity_id=? ORDER BY created_at DESC,id DESC LIMIT 100`,principal.tenant_id,principal.identity_id);
}
export async function listOwnMemberships(db,principal){
 if(!valid(principal?.tenant_id,1,150)||!valid(principal?.identity_id,1,150))err('identity_required');
 return all(db,`SELECT m.tenant_id,m.role,m.status,t.name AS workspace_name
 FROM memberships m JOIN tenants t ON t.id=m.tenant_id
 WHERE m.identity_id=? AND m.tenant_id=? AND m.status='active' AND t.status='active'`,principal.identity_id,principal.tenant_id);
}
