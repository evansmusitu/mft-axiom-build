// TEST ONLY: reconstruct external Origin after Miniflare's loopback guard.
export default {async fetch(request,env){
 const headers=new Headers(request.headers),target=headers.get('x-local-test-target'),origin=headers.get('x-local-test-origin');
 headers.delete('x-local-test-target');headers.delete('x-local-test-origin');if(origin!==null)headers.set('origin',origin);
 const binding={oauth:env.OAUTH,portal:env.PORTAL,identity:env.IDP,handoff:env.HANDOFF,mcp:env.MCP}[target];
 if(!binding)return new Response('Unknown test target',{status:404});return binding.fetch(new Request(request,{headers,redirect:'manual'}));
}};
