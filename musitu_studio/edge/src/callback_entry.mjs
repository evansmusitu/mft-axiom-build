import studio from './r2_entry.mjs';

// Dedicated machine-to-machine callback receiver. No HTML/UI/API surface.
// Signed Access identity is enforced on the separate interactive Worker.
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/internal/callback'){
    return new Response(JSON.stringify({ok:false,error:'NOT_FOUND'}),{
      status:404,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  return studio.fetch(request,env);
}};
