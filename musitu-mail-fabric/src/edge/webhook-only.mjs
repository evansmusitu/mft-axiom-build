/** Dedicated, non-public-by-default webhook-only ingress.
 * Only the externally signed Resend event path is reachable through this
 * entrypoint. Outbound, customer APIs, diagnostics and operator changes are
 * NOT exposed. No public hostname or Resend subscription is provisioned here.
 */
import {createWorker} from './worker.mjs';
import {createDurableSqlAdapter} from './sqlite-do.mjs';
export {MmfStagingSqliteDO} from './sqlite-do.mjs';

const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const respond=(body,status)=>new Response(JSON.stringify(body),{status,headers:H});
const handler=createWorker();
export default {
 async fetch(request,env){
  if(request?.method!=='POST'||new URL(request.url).pathname!=='/v1/webhooks/resend')
    return respond({error:'NOT_FOUND'},404);
  // Reject rather than silently rewriting a drifted configuration.
  if(env?.MMF_API_ENABLED!=='false'||env?.MMF_REAL_SEND_ENABLED!=='false'||
     env?.MMF_WEBHOOK_ENABLED!=='true')
    return respond({error:'SERVICE_UNAVAILABLE'},503);
  let db=env.MMF_DB;
  if(!db?.prepare){
   try{db=createDurableSqlAdapter(env.MMF_RECEIPTS,env.MMF_STORAGE_RPC_SECRET);}
   catch{return respond({error:'SERVICE_UNAVAILABLE'},503);}
  }
  // The shared worker only receives a read/verify/persist-capable provider
  // façade; there is never a real provider send adapter in this code path.
  return handler.fetch(request,{...env,MMF_DB:db});
 }
};
