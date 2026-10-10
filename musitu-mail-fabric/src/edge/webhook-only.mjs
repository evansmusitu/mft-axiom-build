/** Dedicated, non-public-by-default webhook-only ingress.
 * Only the externally signed Resend event path is reachable through this
 * entrypoint. Outbound, customer APIs, diagnostics and operator changes are
 * NOT exposed. No public hostname or Resend subscription is provisioned here.
 */
import {createWorker} from './worker.mjs';
import {createFeedbackSqlAdapter} from './feedback-rpc.mjs';
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
   // IMPORTANT: MMF_RECEIPTS is a separate isolated inbox, not the sender's
   // transaction ledger. It cannot safely correlate provider IDs on its own.
   // Never route authenticated feedback to that empty database and then
   // pretend receipt reconciliation is active.
   if(env?.MMF_OUTBOX_LINK_ENABLED!=='true'||!env.MMF_OUTBOX||
      env.MMF_OUTBOX===env.MMF_RECEIPTS)
    return respond({error:'SERVICE_UNAVAILABLE'},503);
   try{db=createFeedbackSqlAdapter(env.MMF_OUTBOX,env.MMF_OUTBOX_FEEDBACK_SECRET);}
   catch{return respond({error:'SERVICE_UNAVAILABLE'},503);}
  }
  // The shared worker only receives a read/verify/persist-capable provider
  // façade; there is never a real provider send adapter in this code path.
  return handler.fetch(request,{...env,MMF_DB:db});
 }
};
