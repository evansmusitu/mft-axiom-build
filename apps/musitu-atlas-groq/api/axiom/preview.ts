import {parseBody,parseExpression,hashPayload,respond,fail,OPERATION,authConfigured} from './_contract.js';
export default function handler(req:any,res:any){
 if(req.method!=='POST')return respond(res,405,{error:'Method not allowed.'});
 try{
  const data=parseBody(req);
  const expression=parseExpression(data.expression);
  return respond(res,200,{
   previewVersion:'axiom-atlas-v1',operation:OPERATION,
   args:{expression},digest:hashPayload(expression),
   status:'READY_FOR_REVIEW_NOT_EXECUTED',
   sideEffects:'One account-metered Axiom compute operation if submitted.',
   executionConfigured:authConfigured(),
   requiresOperatorConsent:true,requiresPrivateAccessCode:true,
   source:'Certified Axiom capability; actual computation not performed during preview',
   expiryPolicy:'Preview does not reserve capacity or authorize a later execution.',
   note:'A matching preview digest, private access code, and explicit consent are required before execution.'
  });
 }catch(error){return fail(res,error);}
}
