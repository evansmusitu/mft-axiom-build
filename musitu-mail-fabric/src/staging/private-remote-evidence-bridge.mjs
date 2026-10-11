/** LOCAL-ONLY loopback qualification adapter. NEVER deploy as a route. */
const deny=()=>Response.json({error:'NOT_FOUND'},{status:404,headers:{'cache-control':'no-store'}});
export default {async fetch(req,env){
 let u;try{u=new URL(req.url)}catch{return deny()}
 const path=u.pathname, orderRoot='/v1/billing/stage/orders';
 const allowed=(path===orderRoot&&req.method==='POST')||
  (/^\/v1\/billing\/stage\/orders\/MMF-[A-Z0-9]{10,56}$/.test(path)&&req.method==='GET')||
  (path==='/v1/billing/stage/evidence'&&req.method==='POST');
 if(!['localhost','127.0.0.1'].includes(u.hostname)||u.search||!allowed||
   typeof env?.REMOTE_MMF_PRIVATE_BILLING?.fetch!=='function')return deny();
 try{return await env.REMOTE_MMF_PRIVATE_BILLING.fetch(req)}
 catch{return Response.json({error:'PRIVATE_STAGE_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}})}
}};
