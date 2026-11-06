// LOCAL TEST INGRESS ONLY. Never deploy. Miniflare's loopback CSRF guard rejects
// external Origin headers before product code; reconstruct them inside workerd
// so the product's exact-origin checks are exercised without disabling either guard.
export default {async fetch(request,env){
 const headers=new Headers(request.headers),target=headers.get('x-local-test-target'),origin=headers.get('x-local-test-origin');
 headers.delete('x-local-test-target');headers.delete('x-local-test-origin');
 if(origin!==null)headers.set('origin',origin);
 const binding={identity:env.IDP,customer:env.CUSTOMER,transports:env.TRANSPORTS}[target];
 if(!binding)return new Response('Unknown local fixture',{status:404});
 return binding.fetch(new Request(request,{headers,redirect:'manual'}));
}};
