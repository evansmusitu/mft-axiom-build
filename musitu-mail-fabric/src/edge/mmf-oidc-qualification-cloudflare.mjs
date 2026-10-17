import {DurableObject} from 'cloudflare:workers';
import {createMmfStageGate} from './mmf-access-stage-gateway.mjs';
import {MmfOidcQualificationFlow,routeMmfOidcQualification} from '../staging/mmf-oidc-qualification-flow.mjs';
// Populated only by the account-verified, API-public-key-pinned deployment.
const PINNED_QUALIFICATION_CONFIG=null;
export class MmfOidcQualificationDO extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.flow=new MmfOidcQualificationFlow(ctx.storage,PINNED_QUALIFICATION_CONFIG,env,{allowExpired:true,positiveExchangeOnly:true})}
 async fetch(){return new Response(null,{status:403})}
 begin(){return this.flow.begin()}
 callback(input){return this.flow.callback({...input,signal:AbortSignal.timeout(8000)})}
 status(){return this.flow.status()}
 alarm(){return this.flow.purge()}
}
export default {async fetch(req,env){
 try{
  const gate=createMmfStageGate(env);
  const response=await routeMmfOidcQualification(req,{
   async authorize(original){
    // The new callback query is strictly parsed by the boundary above. Reuse
    // the exact deployed signature/admin/expiry gate through its status route;
    // the old dashboard/status query restrictions remain unchanged.
    const probe=new Request('https://mail-stage.mftintelligence.com/private/gateway',
     {method:'GET',headers:original.headers});
    return (await gate.fetch(probe)).status===200;
   },
   getFlow(){
    const stub=env.MMF_OIDC_QUALIFICATION.getByName('mmf-oidc-qualification-20261017');
    return {begin:()=>stub.begin(),status:()=>stub.status(),
     callback:input=>stub.callback({state:input.state,code:input.code,cookieHeader:input.cookieHeader})};
   }
  });
  return response??gate.fetch(req);
 }catch{return new Response(JSON.stringify({error:'MMF_PRIVATE_ACCESS_DENIED'}),{status:403,headers:{'content-type':'application/json','cache-control':'no-store'}})}
}};
