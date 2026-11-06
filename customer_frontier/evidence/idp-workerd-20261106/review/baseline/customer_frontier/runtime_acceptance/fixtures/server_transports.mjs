// LOCAL TEST WORKER ONLY. Never deploy this diagnostic ingress or its fixture grants.
import {qualifiedLoginRedirect} from '../../customer_control_plane/login_broker.mjs';
import {getLiveBillingTruth} from '../../customer_control_plane/live_billing_truth.mjs';
import {verifiedEvent} from '../../customer_control_plane/worker.mjs';
export default {async fetch(request,env){
 try{
  const path=new URL(request.url).pathname;
  if(path==='/login')return Response.json({authorization_url:await qualifiedLoginRedirect(env)});
  if(path==='/billing')return Response.json(await getLiveBillingTruth(env));
  if(path==='/reconcile')return Response.json(await verifiedEvent(request,env));
  return new Response('Not found',{status:404});
 }catch(e){return Response.json({error:String(e.message)},{status:503});}
}};
