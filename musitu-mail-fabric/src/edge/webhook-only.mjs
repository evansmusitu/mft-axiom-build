/** Isolated webhook-only boundary. Implementation gated on security tests. */
const response=(body,status)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export default {
 async fetch(request){
   if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/webhooks/resend')
     return response({error:'NOT_FOUND'},404);
   return response({error:'SERVICE_UNAVAILABLE'},503);
 }
};
