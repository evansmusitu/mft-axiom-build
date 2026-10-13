/**
 * Wrangler local loopback-only caller for an existing remote private WorkerEntrypoint.
 * Never deployed. No public route or secrets. Only synthetic SQL probe methods.
 */
const denial=(category)=>new Response(JSON.stringify(category?{error:'PRIVATE_PROOF_DISABLED',category}:{error:'PRIVATE_PROOF_DISABLED'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
function safeCategory(error){
 const message=String(error?.message||'');
 if(/MMF_PRIVATE_CONTROL_SEED_OCCUPANCY_FAILED/.test(message))return 'CONTROL_SEED_OCCUPANCY';
 if(/MMF_PRIVATE_CONTROL_SEED_FIRST_INSERT_FAILED/.test(message))return 'CONTROL_SEED_FIRST_INSERT';
 if(/MMF_PRIVATE_CONTROL_SEED_SECOND_INSERT_FAILED/.test(message))return 'CONTROL_SEED_SECOND_INSERT';
 if(/MMF_PRIVATE_SQLITE_PROOF_DENIED|MMF_PRIVATE_CONTROL_PROOF_DENIED|MMF_PRIVATE_COMMERCIAL_STAGE_DENIED/.test(message))return 'CLOSED_STAGE_VALIDATION_FAILED';
 if(/service.binding.*(?:unavailable|not connected)|remote.binding.*(?:unavailable|not connected)/i.test(message))return 'REMOTE_BINDING_UNAVAILABLE';
 if(/entrypoint.*(?:not found|not exported)|no such rpc method/i.test(message))return 'REMOTE_ENTRYPOINT_MISSING';
 if(/timed?\s*out|timeout|aborterror/i.test(message))return 'RPC_TIMED_OUT';
 return 'REMOTE_RPC_FAILED';
}
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
   if(url.pathname.startsWith('/control/')&&request.method==='POST'){
    if(Number(request.headers.get('content-length')||0)>900)return denial();
    const raw=await request.text();if(raw.length>900)return denial();
    const body=JSON.parse(raw);
    const contract={
     '/control/seed':['run','records','seedControl'],
     '/control/read':['run','records','readControl'],
     '/control/meter':['run','record','idem','meterControl'],
     '/control/revoke':['run','record','revokeControl'],
     '/control/access':['run','record','accessControl'],
     '/control/clear':['run','clearControl']
    }[url.pathname];
    if(!contract||!body||Object.getPrototypeOf(body)!==Object.prototype||
       Object.keys(body).length!==contract.length-1||contract.slice(0,-1).some(k=>!Object.hasOwn(body,k)))return denial();
    return reply(await env.MMF_PROOF_STAGE[contract.at(-1)](...contract.slice(0,-1).map(k=>body[k])));
   }
   if(url.pathname==='/clear'&&request.method==='POST')return reply(await env.MMF_PROOF_STAGE.clear());
   if(url.pathname==='/restart'&&request.method==='POST'){
    await env.MMF_PROOF_STAGE.restart(); // expected abrupt DO abort / error
    return denial();
   }
   return denial();
  }catch(error){return denial(safeCategory(error))}
 }
};