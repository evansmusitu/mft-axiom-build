import {createHash,timingSafeEqual} from 'node:crypto';
import {parseBody,parseExpression,hashPayload,respond,fail,deny} from './_contract.js';
import {evaluate} from './_rational.js';
export default function handler(req:any,res:any){
 if(req.method!=='POST')return respond(res,405,{error:'Method not allowed'});
 try{
  const body=parseBody(req);
  if(body.action==='replay')return replayHandler(req,res);
  if(body.action!==undefined)throw deny(400,'Invalid proof operation.');
  const expression=parseExpression(body.expression);
  const optionalProvider=body.providerResult;
  if(optionalProvider!==undefined&&typeof optionalProvider!=='string')
   return respond(res,400,{error:'providerResult must be a finite decimal string.'});
  const proof=evaluate(expression,optionalProvider);
  const evidence=JSON.stringify({version:'atlas-proof-v1',requestSha256:hashPayload(expression),proof});
  return respond(res,200,{
   status:'INDEPENDENT_ATLAS_COMPUTATION',
   source:'ATLAS exact rational kernel, not Axiom MCP',
   operation:'arithmetic.evaluate',
   proof,
   requestSha256:hashPayload(expression),
   evidenceSha256:createHash('sha256').update(evidence).digest('hex'),
   evidenceFingerprintMeaning:'Integrity hash of this proof record; not a server signature, independently anchored audit, or proof of external Axiom execution.',
   chargedComputeUnits:0,
   providerWasCalled:false,
   modelWasCalled:false,
   completedAt:new Date().toISOString()
  });
 }catch(e){return fail(res,e);}
}

function sameDigest(expected:string,provided:string){
 if(!/^[0-9a-f]{64}$/.test(provided))return false;
 return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(provided,'hex'));
}
function replayHandler(req:any,res:any){
 if(req.method!=='POST')return respond(res,405,{error:'Method not allowed'});
 try{
  const data=parseBody(req);
  const receipt=data.receipt as any;
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))
   throw deny(400,'Supply an exported ATLAS independent proof JSON receipt.');
  if(JSON.stringify(receipt).length>13000)throw deny(413,'Proof file exceeds the replay size limit.');
  if(receipt.status!=='INDEPENDENT_ATLAS_COMPUTATION'||
     receipt.source!=='ATLAS exact rational kernel, not Axiom MCP'||
     receipt.providerWasCalled!==false||receipt.modelWasCalled!==false||receipt.chargedComputeUnits!==0)
     throw deny(409,'Receipt provenance is not a supported local proof.');
  if(!receipt.proof||typeof receipt.proof!=='object')throw deny(400,'Proof object missing.');
  const expression=parseExpression(receipt.proof.expression);
  const comparison=receipt.proof.comparison;
  const provider=typeof comparison?.providerDecimal==='string'?comparison.providerDecimal:undefined;
  const recomputed=evaluate(expression,provider);
  const expectedRequest=hashPayload(expression);
  const expectedEvidence=createHash('sha256')
    .update(JSON.stringify({version:'atlas-proof-v1',requestSha256:expectedRequest,proof:recomputed}))
    .digest('hex');
  // Reject a tampered numeric result, bogus kernel, modified proof comparison or fake digest.
  if(!sameDigest(expectedRequest,receipt.requestSha256)||
     !sameDigest(expectedEvidence,receipt.evidenceSha256)||
     JSON.stringify(recomputed)!==JSON.stringify(receipt.proof))
    throw deny(409,'Proof replay failed: supplied result or evidence fingerprint differs from exact recomputation.');
  return respond(res,200,{
   status:'PROOF_REPLAY_CONSISTENT',
   checkedAt:new Date().toISOString(),
   kernel:recomputed.kernel,
   recomputedExact:recomputed.exact,
   digestMatches:true,
   resultMatches:true,
   source:'Independent ATLAS recomputation only',
   note:'This proves internal calculation and hash consistency, NOT the identity of the original issuer, the receipt timestamp, external Axiom execution or independent anchoring.'
  });
 }catch(error){return fail(res,error);}
}
