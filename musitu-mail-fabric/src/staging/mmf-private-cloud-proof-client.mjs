/**
 * Wrangler local loopback-only caller for an existing remote private WorkerEntrypoint.
 * Never deployed. No public route or secrets. Only synthetic SQL probe methods.
 */
const denial=()=>new Response(JSON.stringify({error:'PRIVATE_PROOF_DISABLED'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||
      !env.MMF_PROOF_STAGE||!['GET','POST'].includes(request.method))return denial();
  try{
   if(url.pathname==='/health'&&request.method==='GET')return reply({ok:true,localOnly:true});
   if(url.pathname==='/read'&&request.method==='POST')return reply({digest:await env.MMF_PROOF_STAGE.read()});
   if(url.pathname==='/write'&&request.method==='POST'){
    if(Number(request.headers.get('content-length')||0)>180)return denial();
    const raw=await request.text();if(raw.length>130)return denial();
    const body=JSON.parse(raw);
    if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).length!==1||typeof body.digest!=='string')return denial();
    return reply(await env.MMF_PROOF_STAGE.write(body.digest));
   }
   if(url.pathname==='/clear'&&request.method==='POST')return reply(await env.MMF_PROOF_STAGE.clear());
   if(url.pathname==='/restart'&&request.method==='POST'){
    await env.MMF_PROOF_STAGE.restart(); // expected abrupt DO abort / error
    return denial();
   }
   return denial();
  }catch{return denial()}
 }
};