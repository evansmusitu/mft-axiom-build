import {parseBody,parseExpression,hashPayload,respond,fail,OPERATION,authConfigured,verifyApproval,deny} from './_contract.js';
import {ledgerReady,lookup,assessRuntimeRole} from './_ledger.js';
export default async function handler(req:any,res:any){
 if(req.method!=='POST')return respond(res,405,{error:'Method not allowed.'});
 try{
  const data=parseBody(req);
  if(data.action==='status'){
   verifyApproval(data.accessCode,'0'.repeat(64),true);
   if(typeof data.idempotencyKey!=='string'||!(/^[a-f\d-]{36}$/i.test(data.idempotencyKey)))
    throw deny(400,'A valid idempotency key is required.');
   const record=await lookup(data.idempotencyKey);
   if(!record)return respond(res,404,{error:'No recorded execution for this private tenant and key.'});
   return respond(res,200,{status:record.status,requestId:record.request_id,
     completedAt:record.updated_at,requestSha256:record.request_sha256,
     result:record.status==='SUCCEEDED'?record.result:null,
     outcome:'The ledger cannot infer upstream success from an uncertain response. Never replay a pending operation.'});
  }
  if(data.action!==undefined)throw deny(400,'Unknown preview action.');
  const expression=parseExpression(data.expression);
  const privilegeCheck=ledgerReady()?await assessRuntimeRole().catch(()=>null):null;
  return respond(res,200,{
   previewVersion:'axiom-atlas-v1',operation:OPERATION,
   args:{expression},digest:hashPayload(expression),
   status:'READY_FOR_REVIEW_NOT_EXECUTED',
   sideEffects:'One account-metered Axiom compute operation if submitted.',
   executionConfigured:authConfigured()&&ledgerReady()&&privilegeCheck?.restricted===true,
   runtimeRoleRestricted:privilegeCheck?.restricted===true,
   ledgerConnected:ledgerReady(),
   quotaLimitPerUtcDay:20,
   requiresOperatorConsent:true,requiresPrivateAccessCode:true,
   source:'Certified Axiom capability; actual computation not performed during preview',
   expiryPolicy:'Preview does not reserve capacity or authorize a later execution.',
   note:'A matching preview digest, private access code, and explicit consent are required before execution.'
  });
 }catch(error){return fail(res,error);}
}
