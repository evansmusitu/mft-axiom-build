/** Loopback-only Wrangler local dev adapter. Never deploy this Worker or expose a public route.
 * Both Cloudflare service bindings are fixed at deploy time, and have no HTTP fallback.
 */
const notFound=()=>Response.json({error:'NOT_FOUND'},{status:404,headers:{'cache-control':'no-store'}});
export function createPrivateTwoWorkerLoopback(){return Object.freeze({async fetch(request,env){
 let url;try{url=new URL(request.url)}catch{return notFound()}
 const orders='/v1/billing/stage/orders',receipt='/internal/mmf/stage/receipt';
 const billing=(url.pathname===orders&&request.method==='POST')||
  (request.method==='GET'&&/^\/v1\/billing\/stage\/orders\/MMF-[A-Z0-9]{10,56}$/.test(url.pathname));
 const authority=url.pathname===receipt&&request.method==='POST';
 if(!['127.0.0.1','localhost'].includes(url.hostname)||!['http:'].includes(url.protocol)||url.search||url.hash||(!billing&&!authority))return notFound();
 const binding=billing?env?.REMOTE_MMF_PRIVATE_BILLING:env?.REMOTE_MMF_PRIVATE_AUTHORITY;
 if(typeof binding?.fetch!=='function')return notFound();
 try{return await binding.fetch(request)}catch{return Response.json({error:'PRIVATE_STAGE_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}})}
}})}
export default createPrivateTwoWorkerLoopback();
