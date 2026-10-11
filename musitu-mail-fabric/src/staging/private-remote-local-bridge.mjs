/** Local-only GitHub runner adapter. DO NOT DEPLOY. Its only purpose is to
 * reach the existing private, disabled-by-default Cloudflare billing Worker
 * through a remote service binding without opening an Internet route.
 */
const H={'content-type':'application/json','cache-control':'no-store'};
const deny=(code,error)=>new Response(JSON.stringify({error}),{status:code,headers:H});
const orderPath=/^\/v1\/billing\/stage\/orders(?:\/MMF-[A-Z0-9]{10,56})?$/;
export default {async fetch(request,env){
 let url;try{url=new URL(request.url)}catch{return deny(400,'INVALID_REQUEST')}
 if(!['127.0.0.1','localhost'].includes(url.hostname)||!orderPath.test(url.pathname)||url.search||
    !((url.pathname==='/v1/billing/stage/orders'&&request.method==='POST')||
      (url.pathname!=='/v1/billing/stage/orders'&&request.method==='GET')))
   return deny(404,'NOT_FOUND');
 if(typeof env?.REMOTE_MMF_PRIVATE_BILLING?.fetch!=='function')return deny(503,'REMOTE_SERVICE_BINDING_UNAVAILABLE');
 try{return await env.REMOTE_MMF_PRIVATE_BILLING.fetch(request)}
 catch{return deny(503,'REMOTE_SERVICE_BINDING_UNAVAILABLE')}
}};
