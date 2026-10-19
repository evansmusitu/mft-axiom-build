import {identityAction} from '../../../src/staging/identity.mjs';
import {identityFailureDiagnostic} from '../../../src/staging/identity-diagnostics.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req,{params}){
 let stage='REQUEST',action;
 try{
  action=(await params).action;
  return await identityAction(req,action,{onStage:value=>{stage=value;}});
 }catch(error){
  console.warn(JSON.stringify(identityFailureDiagnostic(stage,error)));
  const headers={'cache-control':'no-store','referrer-policy':'no-referrer'};
  // Leave the callback URL without forwarding its query or retrying sign-in.
  // Authentication failures still deny access; this only changes browser recovery.
  if(req.method==='GET'&&action==='callback'&&(req.headers.get('accept')||'').includes('text/html'))
   return new Response(null,{status:303,headers:{...headers,location:'/sign-in-help'}});
  return Response.json({error:'IDENTITY_UNAVAILABLE_OR_DENIED'},{status:503,headers});
 }
}
export {handle as GET,handle as POST};
