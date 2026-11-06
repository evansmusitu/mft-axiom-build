// This worker MUST have no publicly accessible route, only a private service binding.
// It cannot self-certify PSP settlement. Provider verifier must perform an authentic
// server-side Paynow/PSP status read and independently verify settlement/refund state.
import {reconcileSettlement,reconcileRefund} from './ledger.mjs';
import {verifiedEvent} from './worker.mjs';
export default {
 async fetch(request,env){
  const send=(body,status)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  if(request.method!=='POST')return send({ok:false,error:'method_not_allowed'},405);
  try{
   const evidence=await verifiedEvent(request,env);
   if(!evidence||!['settlement','refund'].includes(evidence.kind))throw new Error('unsupported_evidence');
   const result=evidence.kind==='settlement'?await reconcileSettlement(env.CUSTOMER_DB,evidence):await reconcileRefund(env.CUSTOMER_DB,evidence);
   return send({ok:true,...result},200);
  }catch(e){return send({ok:false,error:'reconciliation_rejected'},409);}
 }
};
