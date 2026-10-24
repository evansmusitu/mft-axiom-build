import {createHash,randomUUID} from 'node:crypto';
import {evaluate} from './_rational.js';
import {claim,start,mark,ledgerReady} from './_ledger.js';
import {oauthBearer} from './_oauth.js';
import {parseBody,parseExpression,hashPayload,respond,deny,fail,authConfigured,verifyApproval,OPERATION,TOOL_NAME,mcpCall} from './_contract.js';
function uuid(x:unknown):string {
 if(typeof x!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x))
   throw deny(400,'Each operation needs a fresh UUID idempotency key from its preview.');
 return x.toLowerCase();
}
export default async function handler(req:any,res:any){
 if(req.method!=='POST')return respond(res,405,{error:'Method not allowed.'});
 let requestId='',dispatched=false,created=false;
 try{
  if(!authConfigured()||!ledgerReady())
   throw deny(503,'Axiom account execution is locked. Both approved account token and independent ledger are required.');
  const input=parseBody(req);
  const expression=parseExpression(input.expression);
  verifyApproval(input.accessCode,input.digest,input.approved);
  if(input.digest!==hashPayload(expression))
   throw deny(409,'Expression changed after preview. Request was not sent.');
  const key=uuid(input.idempotencyKey);
  // Resolve/refresh owner-issued OAuth before claiming a chargeable compute request.
  // A static, possibly expired bearer from Vercel must never authorize execution.
  const authorizedBearer=await oauthBearer();
  // Durable unique-key claim; duplicate requests fail closed across all Vercel replicas.
  requestId=randomUUID();
  await claim(requestId,key,hashPayload(expression),expression);
  created=true;
  await start(requestId);
  dispatched=true;
  // One external dispatch. NO automatic retries under any circumstances.
  const data=await mcpCall({jsonrpc:'2.0',id:requestId,method:'tools/call',
    params:{name:TOOL_NAME,arguments:{args:{expression}}}
  },authorizedBearer);
  const response=data?.result;
  if(!response||response.isError===true||response?.structuredContent?.authenticated===false)
   throw deny(502,'Axiom did not return a successful entitled operation.');
  const packed=response.structuredContent?.result;
  const result=packed?.ok===true?packed:packed?.result&&typeof packed.result==='object'?packed.result:{};
  if(result.ok!==true||typeof result.result!=='string')
   throw deny(502,'Axiom returned a response incompatible with its certified arithmetic contract.');
  const check=evaluate(expression,result.result);
  if(check.comparison?.match!==true)
   throw deny(502,'Axiom output disagreed with the independently computed rational result.');
  const payload={
   operation:OPERATION,expression,result:result.result,
   providerVerified:result.verified===true?true:result.verified===false?false:null,
   kernelVersion:typeof result.kernel_version==='string'?result.kernel_version:null,
   computeUnits:typeof result.axiom?.compute_units==='number'?result.axiom.compute_units:null
  };
  const receipt={
   status:'PROVIDER_EXECUTED',requestId,completedAt:new Date().toISOString(),
   origin:'Authenticated MUSITU Axiom MCP',
   output:{operation:OPERATION,expression,result:result.result,
    verified:payload.providerVerified,kernelVersion:payload.kernelVersion,computeUnits:payload.computeUnits},
   requestSha256:hashPayload(expression),
   resultSha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
   independentVerification:{matched:true,kernel:check.kernel,exact:check.exact,decimal:check.decimal,
     providerAgreement:check.comparison},
   evidenceType:'Real provider-returned result + independent exact-rational cross-check + durable local audit metadata. This is not third-party signed attestation.',
   retryPolicy:'Operation has an immutable idempotency key. Never resubmit on an uncertain outcome.'
  };
  await mark(requestId,'SUCCEEDED','VERIFIED',receipt);
  return respond(res,200,receipt);
 }catch(error){
   if(created&&dispatched&&requestId){
     try{await mark(requestId,'REVIEW_REQUIRED','REMOTE_RESULT_UNKNOWN_OR_INVALID',null);}
     catch{/* An already-terminal ledger status must never trigger another provider call. */}
     return respond(res,503,{error:'Axiom operation was dispatched but its outcome is uncertain or unverified. Do not retry; inspect durable status and account usage.',requestId,status:'REVIEW_REQUIRED'});
   }
   if(created&&requestId){
     try{await mark(requestId,'DENIED','DISPATCH_NOT_CONFIRMED',null);}catch{}
   }
   return fail(res,error);
 }
}
