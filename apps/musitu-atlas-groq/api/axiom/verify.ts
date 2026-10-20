import {createHash} from 'node:crypto';
import {parseBody,parseExpression,hashPayload,respond,fail} from './_contract.js';
import {evaluate} from './_rational.js';
export default function handler(req:any,res:any){
 if(req.method!=='POST')return respond(res,405,{error:'Method not allowed'});
 try{
  const body=parseBody(req);
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
