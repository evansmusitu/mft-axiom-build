import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import worker from './index.mjs';
import {SignJWT,generateKeyPair,exportJWK} from 'jose';

const E={ACCESS_ISSUER:'https://lifeline-test.cloudflareaccess.com/',ACCESS_AUD:'stage-audience',
  MODAL_ORIGIN:'https://lifeline-stage.modal.run/',MODAL_PROXY_KEY:'test-proxy-key',MODAL_PROXY_SECRET:'test-proxy-secret',
  EDGE_SHARED_SECRET:'test-edge-secret-more-than-32-characters!',
  LIFELINE_PRIVATE_BACKEND_CUTOVER:'AUTHORIZED',
  ACCESS_OPERATOR_SUB:'cf-user-approved-123',
  AGENT_ID:'agent-A',AGENT_TENANT:'tenant-A',AGENT_HMAC_KEY:'test-agent-key-much-longer-than-32-characters'};
const json=(body)=>JSON.stringify(body);
const message=(path,body,headers={})=>new Request('https://lifeline.example'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:json(body)});
function signedHeaders(body, timestamp=Math.floor(Date.now()/1000)){
  const nonce='abcdefghijklmnopqrstuvwxyz012345';
  const bodyHash=createHash('sha256').update(json(body)).digest('hex');
  const signed=['agent-A','tenant-A',timestamp,nonce,bodyHash].join('\n');
  const signature=createHmac('sha256',E.AGENT_HMAC_KEY).update(signed).digest('hex');
  return {'x-lifeline-agent-id':'agent-A','x-lifeline-tenant':'tenant-A','x-lifeline-time':String(timestamp),
          'x-lifeline-nonce':nonce,'x-lifeline-signature':signature};
}

test('cannot run without private configuration',async()=>{
  const r=await worker.fetch(message('/mcp',{}),{});
  assert.equal(r.status,503);
});
test('anonymous access to MCP is rejected',async()=>{
  const r=await worker.fetch(message('/mcp',{'jsonrpc':'2.0',method:'tools/list',id:1}),E);
  assert.equal(r.status,401);
});
test('agent requests missing signature never reach Modal',async()=>{
  const r=await worker.fetch(message('/agent/pull',{request:'next',tenant:'tenant-A'}),E);
  assert.equal(r.status,401);
});
test('agent has no arbitrary route',async()=>{
  const r=await worker.fetch(message('/agent/trade',{}),E);
  assert.equal(r.status,404);
});
test('valid agent HMAC forwards securely to Modal',async()=>{
  const original=globalThis.fetch;
  let count=0;
  try{
    globalThis.fetch=async(url,opts)=>{
      count++;
      assert.equal(url,'https://lifeline-stage.modal.run/agent/pull');
      assert.equal(opts.headers['modal-secret'],E.MODAL_PROXY_SECRET);
      assert.equal(opts.headers['x-lifeline-edge-secret'],E.EDGE_SHARED_SECRET);
      assert.equal(opts.headers['x-lifeline-agent-id'],'agent-A');
      return new Response(json({schema:'lifeline.bridge.v1',job:null}),{status:200,headers:{'content-type':'application/json'}});
    };
    const body={request:'next',tenant:'tenant-A'};
    const r=await worker.fetch(message('/agent/pull',body,signedHeaders(body)),E);
    assert.equal(r.status,200);
    assert.equal(count,1);
    assert.equal((await r.json()).job,null);
  }finally{globalThis.fetch=original;}
});
test('expired agent requests cannot invoke compute',async()=>{
  const body={request:'next',tenant:'tenant-A'};
  const r=await worker.fetch(message('/agent/pull',body,signedHeaders(body,1)),E);
  assert.equal(r.status,401);
});
test('tampering with authenticated body is rejected',async()=>{
  const original={request:'next',tenant:'tenant-A'};
  const tampered={request:'unexpected',tenant:'tenant-A'};
  const r=await worker.fetch(message('/agent/pull',tampered,signedHeaders(original)),E);
  assert.equal(r.status,401);
});
test('Access JWT permits status but not trade commands',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='kid-test';jwk.use='sig';jwk.alg='RS256';
  const token=await new SignJWT({sub:'cf-user-approved-123'}).setProtectedHeader({alg:'RS256',kid:'kid-test'})
    .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD).setIssuedAt()
    .setExpirationTime('5m').sign(privateKey);
  const original=globalThis.fetch;
  let modalCalls=0;
  try{
    globalThis.fetch=async(url,opts)=>{
      if(String(url).includes('/cdn-cgi/access/certs'))
        return new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      modalCalls++;
      assert.equal(url,'https://lifeline-stage.modal.run/operator/status');
      assert.equal(opts.headers['x-lifeline-subject'],E.AGENT_TENANT);
      assert.notEqual(opts.headers['x-lifeline-subject'],E.ACCESS_OPERATOR_SUB);
      return new Response(JSON.stringify({schema:'lifeline.bridge.v1',jobs:{},trade_execution:false}),{status:200,headers:{'content-type':'application/json'}});
    };
    const allowed=await worker.fetch(message('/operator/status',{}, {'cf-access-jwt-assertion':token}),E);
    assert.equal(allowed.status,200);
    const forbidden=await worker.fetch(message('/mcp', {jsonrpc:'2.0',method:'tools/call',params:{name:'order_send'},id:1},
      {'cf-access-jwt-assertion':token}),E);
    assert.equal(forbidden.status,403);
    assert.equal(modalCalls,1);
  }finally{globalThis.fetch=original;}
});
test('malformed upstream redirects fail closed',async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response('',{status:302,headers:{Location:'https://example.net'}});
    const b={request:'next',tenant:'tenant-A'};
    const r=await worker.fetch(message('/agent/pull',b,signedHeaders(b)),E);
    assert.equal(r.status,502);
  }finally{globalThis.fetch=old;}
});


test('verified Access JWT of a different user cannot operate the tenant',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='kid-other';jwk.use='sig';jwk.alg='RS256';
  const original=globalThis.fetch;
  let upstreamCalls=0;
  try{
    globalThis.fetch=async(url,opts)=>{
      if(String(url).includes('/cdn-cgi/access/certs'))
        return new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      upstreamCalls++;return new Response('unexpected');
    };
    const token=await new SignJWT({sub:'cf-different-user'})
      .setProtectedHeader({alg:'RS256',kid:'kid-other'})
      .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
      .setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const result=await worker.fetch(message('/operator/status',{}, {'cf-access-jwt-assertion':token}),E);
    assert.equal(result.status,401);
    assert.equal(upstreamCalls,0);
  }finally{globalThis.fetch=original;}
});

test('missing owner pin fails closed before cryptographic validation',async()=>{
  const {ACCESS_OPERATOR_SUB,...missing}=E;
  assert.equal((await worker.fetch(message('/operator/status',{}),missing)).status,503);
  assert.equal((await worker.fetch(message('/agent/pull',{request:'next',tenant:'tenant-A'}),missing)).status,503);
});

test('Access JWT cannot smuggle caller-selected tenant into trusted backend headers',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='kid-tenant';jwk.use='sig';jwk.alg='RS256';
  const jwt=await new SignJWT({sub:E.ACCESS_OPERATOR_SUB})
    .setProtectedHeader({alg:'RS256',kid:'kid-tenant'})
    .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(url,opts)=>{
      if(String(url).includes('/cdn-cgi/access/certs'))
        return new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      calls++;
      assert.equal(opts.headers['x-lifeline-subject'],E.AGENT_TENANT);
      assert.notEqual(opts.headers['x-lifeline-subject'],E.ACCESS_OPERATOR_SUB);
      return new Response(json({schema:'lifeline.bridge.v1',jobs:{},trade_execution:false}),{status:200,headers:{'content-type':'application/json'}});
    };
    const h={'cf-access-jwt-assertion':jwt,'x-lifeline-subject':'evil-tenant',
              'x-lifeline-tenant':'evil-tenant'};
    const resp=await worker.fetch(message('/operator/status',{},h),E);
    assert.equal(resp.status,200);assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});

test('expired owner JWT and wrong audience both fail before Modal',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='kid-negative';jwk.use='sig';jwk.alg='RS256';
  const original=globalThis.fetch;
  let calls=0;
  try{
    globalThis.fetch=async(url)=>{
      if(String(url).includes('/cdn-cgi/access/certs'))
        return new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      calls++;throw Error('unexpected authenticated upstream');
    };
    for(const claims of [
      {aud:'incorrect-audience',expires:'5m'},
      {aud:E.ACCESS_AUD,expires:-120}
    ]){
      const token=await new SignJWT({sub:E.ACCESS_OPERATOR_SUB})
        .setProtectedHeader({alg:'RS256',kid:'kid-negative'})
        .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(claims.aud)
        .setIssuedAt().setExpirationTime(claims.expires).sign(privateKey);
      const result=await worker.fetch(message('/operator/status',{}, {'cf-access-jwt-assertion':token}),E);
      assert.equal(result.status,401);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('owner-only signed Access token can qualify without any private backend bindings',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);
  jwk.kid='owner-kid';jwk.alg='RS256';jwk.use='sig';
  const token=await new SignJWT({sub:E.ACCESS_OPERATOR_SUB})
    .setProtectedHeader({alg:'RS256',kid:'owner-kid'})
    .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const partial={ACCESS_ISSUER:E.ACCESS_ISSUER,ACCESS_AUD:E.ACCESS_AUD,
                 ACCESS_OPERATOR_SUB:E.ACCESS_OPERATOR_SUB};
  const original=globalThis.fetch;let jwkFetches=0;let backendFetches=0;
  try {
    globalThis.fetch=async url=>{
      if(String(url).includes('/cdn-cgi/access/certs')){
        jwkFetches++;
        return new Response(json({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      }
      backendFetches++;
      throw Error('never call Modal from owner verification');
    };
    const allowed=await worker.fetch(new Request('https://lifeline.example/owner/verify',
      {headers:{'cf-access-jwt-assertion':token}}),partial);
    assert.equal(allowed.status,200);
    const result=await allowed.json();
    assert.equal(result.owner_access_token_signature_verified,true);
    assert.equal(result.private_backend_connected,false);
    assert.equal(result.trading_enabled,false);
    assert.equal(jwkFetches,1);assert.equal(backendFetches,0);
    const unavailable=await worker.fetch(message('/operator/status',{},{
      'cf-access-jwt-assertion':token}),partial);
    assert.equal(unavailable.status,503);
  }finally{globalThis.fetch=original;}
});

test('owner identity verification denies missing token and mismatched users',async()=>{
  const partial={ACCESS_ISSUER:E.ACCESS_ISSUER,ACCESS_AUD:E.ACCESS_AUD,
                 ACCESS_OPERATOR_SUB:E.ACCESS_OPERATOR_SUB};
  const missing=await worker.fetch(new Request('https://lifeline.example/owner/verify'),partial);
  assert.equal(missing.status,401);
  const unconfigured=await worker.fetch(new Request('https://lifeline.example/owner/verify'),
     {ACCESS_AUD:E.ACCESS_AUD,ACCESS_OPERATOR_SUB:E.ACCESS_OPERATOR_SUB});
  assert.equal(unconfigured.status,503);
  const method=await worker.fetch(message('/owner/verify',{},{}),partial);
  assert.equal(method.status,405);
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='owner-wrong';jwk.alg='RS256';jwk.use='sig';
  const token=await new SignJWT({sub:'not-approved-owner'})
      .setProtectedHeader({alg:'RS256',kid:'owner-wrong'})
      .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
      .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const original=globalThis.fetch;let backend=0;
  try{
    globalThis.fetch=async url=>{
      if(String(url).includes('/cdn-cgi/access/certs'))
        return new Response(json({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      backend++;throw Error('untrusted backend');
    };
    const rejected=await worker.fetch(new Request('https://lifeline.example/owner/verify',{
      headers:{'cf-access-jwt-assertion':token}}),partial);
    assert.equal(rejected.status,401);assert.equal(backend,0);
  }finally{globalThis.fetch=original;}
});

test('signed owner cannot pass status arguments or extra RPC parameters to Modal',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='kid-no-extra-params';jwk.use='sig';jwk.alg='RS256';
  const token=await new SignJWT({sub:E.ACCESS_OPERATOR_SUB})
    .setProtectedHeader({alg:'RS256',kid:'kid-no-extra-params'})
    .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const original=globalThis.fetch;
  let calls=0;
  try{
    globalThis.fetch=async(url)=>{
      if(String(url).includes('/cdn-cgi/access/certs'))
        return new Response(json({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      calls++;
      return new Response(json({result:{content:[{type:'text',text:'only status'}]}}),{status:200,headers:{'content-type':'application/json'}});
    };
    const headers={'cf-access-jwt-assertion':token};
    const invalid=[
      {name:'lifeline_status',arguments:{place_order:true}},
      {name:'lifeline_status',arguments:['anything']},
      {name:'lifeline_status',arguments:null},
      {name:'lifeline_status',other:'unknown'},
      [],null,'lifeline_status',
    ];
    for(const params of invalid){
      const r=await worker.fetch(message('/mcp',{jsonrpc:'2.0',method:'tools/call',params,id:1},headers),E);
      assert.equal(r.status,403);
    }
    assert.equal(calls,0,'disallowed calls must never reach Modal');
    const valid=await worker.fetch(message('/mcp',{jsonrpc:'2.0',method:'tools/call',
      params:{name:'lifeline_status',arguments:{}},id:2},headers),E);
    assert.equal(valid.status,200);
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});

test('authenticated owner sees binding names but no secrets or backend requests',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='readiness-owner';jwk.alg='RS256';jwk.use='sig';
  const token=await new SignJWT({sub:E.ACCESS_OPERATOR_SUB})
    .setProtectedHeader({alg:'RS256',kid:'readiness-owner'})
    .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const redactionMarker='never-reflect-this-secret-value-0123456789';
  const partial={ACCESS_ISSUER:E.ACCESS_ISSUER,ACCESS_AUD:E.ACCESS_AUD,
    ACCESS_OPERATOR_SUB:E.ACCESS_OPERATOR_SUB,MODAL_PROXY_KEY:redactionMarker};
  const old=globalThis.fetch;let jwks=0,backend=0;
  try{
    globalThis.fetch=async url=>{
      if(String(url).includes('/cdn-cgi/access/certs')){
        jwks++;
        return new Response(json({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      }
      backend++;throw Error('readiness must never reach private backend');
    };
    const make=(suffix='',headers={})=>new Request('https://lifeline.example/owner/readiness'+suffix,{headers});
    const unauthenticated=await worker.fetch(make(),partial);
    assert.equal(unauthenticated.status,401);
    const allowed=await worker.fetch(make('',{'cf-access-jwt-assertion':token}),partial);
    assert.equal(allowed.status,200);
    assert.equal(allowed.headers.get('cache-control'),'no-store');
    const response=await allowed.text();
    assert.equal(response.includes(redactionMarker),false);
    const status=JSON.parse(response);
    assert.equal(status.configured_bindings,1);
    assert.equal(status.required_bindings,7);
    assert.equal(status.backend_connected,false);
    assert.equal(status.native_windows_connected,false);
    assert.equal(status.trading_enabled,false);
    assert.equal(status.missing_bindings.includes('MODAL_PROXY_SECRET'),true);
    const withQuery=await worker.fetch(make('?client=ignored',{'cf-access-jwt-assertion':token}),partial);
    assert.equal(withQuery.status,400);
    const post=await worker.fetch(message('/owner/readiness',{}, {'cf-access-jwt-assertion':token}),partial);
    assert.equal(post.status,405);
    assert.equal(jwks,1);
    assert.equal(backend,0);
  }finally{globalThis.fetch=old;}
});

test('unconfigured owner identity cannot read binding inventory',async()=>{
  const response=await worker.fetch(new Request('https://lifeline.example/owner/readiness'),
    {MODAL_PROXY_KEY:'top-secret-but-owner-auth-unavailable'});
  assert.equal(response.status,503);
  assert.equal(JSON.stringify(await response.json()).includes('top-secret'),false);
});


test('private Modal invalid content-type cannot masquerade as a successful JSON result',async()=>{
  const old=globalThis.fetch;
  const b={request:'next',tenant:'tenant-A'};
  try {
    globalThis.fetch=async()=>new Response('<html>internal application error</html>',{
      status:200,headers:{'content-type':'text/html'}});
    const r=await worker.fetch(message('/agent/pull',b,signedHeaders(b)),E);
    assert.equal(r.status,502);
    assert.equal((await r.json()).error,'invalid_private_backend_response');
  } finally {globalThis.fetch=old;}
});

test('private Modal HTTP errors must never reflect internal secrets or stack traces',async()=>{
  const old=globalThis.fetch;
  const b={request:'next',tenant:'tenant-A'};
  try {
    globalThis.fetch=async()=>new Response('private stack: '+E.MODAL_PROXY_SECRET,{
      status:500,headers:{'content-type':'text/plain'}});
    const r=await worker.fetch(message('/agent/pull',b,signedHeaders(b)),E);
    assert.equal(r.status,502);
    const t=await r.text();
    assert.equal(t.includes(E.MODAL_PROXY_SECRET),false);
    assert.equal(t.includes('private stack'),false);
  } finally {globalThis.fetch=old;}
});

test('oversized declared upstream body fails closed without reading a single byte',async()=>{
  const old=globalThis.fetch;
  const b={request:'next',tenant:'tenant-A'};
  let reads=0;
  try {
    globalThis.fetch=async()=>new Response(new ReadableStream({
      pull(controller){reads++;controller.enqueue(new TextEncoder().encode('secret'));controller.close();}
    },{highWaterMark:0}),{status:200,headers:{'content-type':'application/json','content-length':'1000000'}});
    const r=await worker.fetch(message('/agent/pull',b,signedHeaders(b)),E);
    assert.equal(r.status,502);
    assert.equal(reads,0);
  } finally {globalThis.fetch=old;}
});


test('owner-authenticated MCP refuses extra envelope fields and malformed request IDs before Modal',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='kid-envelope';jwk.use='sig';jwk.alg='RS256';
  const token=await new SignJWT({sub:E.ACCESS_OPERATOR_SUB}).setProtectedHeader({alg:'RS256',kid:'kid-envelope'})
    .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const prior=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async url=>{
      if(String(url).includes('/cdn-cgi/access/certs'))
        return new Response(json({keys:[jwk]}),{headers:{'content-type':'application/json'}});
      calls++;throw Error('malformed RPC reached Modal');
    };
    const h={'cf-access-jwt-assertion':token};
    const invalid=[
      {jsonrpc:'2.0',method:'tools/list',id:1,extra:'unsafe'},
      {jsonrpc:'2.0',method:'tools/list',id:true},
      {jsonrpc:'2.0',method:'tools/list',id:null},
      {jsonrpc:'2.0',method:'tools/list',id:1.5},
      {jsonrpc:'2.0',method:'tools/list'},
      {jsonrpc:'2.0',method:'tools/list',id:'x'.repeat(200)},
      {jsonrpc:'2.0',method:'tools/list',id:1,params:{request:'order_send'}},
      {jsonrpc:'2.0',method:'ping',id:2,params:['unexpected']},
      {jsonrpc:'2.0',method:'initialize',id:3,params:'unsafe'},
    ];
    for(const payload of invalid){
      const response=await worker.fetch(message('/mcp',payload,h),E);
      assert.equal(response.status,403,JSON.stringify(payload));
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=prior;}
});

test('complete backend credentials cannot auto-activate before explicit private cutover',async()=>{
  const allButCutover={...E};
  delete allButCutover.LIFELINE_PRIVATE_BACKEND_CUTOVER;
  const body={request:'next',tenant:'tenant-A'};
  const original=globalThis.fetch;
  let upstream=0;
  try{
    globalThis.fetch=async()=>{upstream++;return new Response(json({schema:'lifeline.bridge.v1',job:null}),{status:200});};
    const r=await worker.fetch(message('/agent/pull',body,signedHeaders(body)),allButCutover);
    assert.equal(r.status,503,'a full set of secrets must not be permission to activate routes');
    assert.equal(upstream,0);
    for(const bad of ['','true','approved',true,'AUTHORISED']){
      const result=await worker.fetch(message('/agent/pull',body,signedHeaders(body)),
         {...E,LIFELINE_PRIVATE_BACKEND_CUTOVER:bad});
      assert.equal(result.status,503);
    }
    assert.equal(upstream,0);
  }finally{globalThis.fetch=original;}
});

test('legacy MCP initialized notification is allowed only for pinned owner, with 202 empty body',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='kid-initialized';jwk.use='sig';jwk.alg='RS256';
  const jwt=await new SignJWT({sub:E.ACCESS_OPERATOR_SUB})
    .setProtectedHeader({alg:'RS256',kid:'kid-initialized'})
    .setIssuer(E.ACCESS_ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const previous=globalThis.fetch;let routed=0;
  try{
    globalThis.fetch=async(url,opts)=>{
      if(String(url).includes('/cdn-cgi/access/certs'))
        return new Response(JSON.stringify({keys:[jwk]}),
          {headers:{'content-type':'application/json'}});
      routed++;
      assert.equal(url,'https://lifeline-stage.modal.run/mcp');
      assert.equal(opts.headers['x-lifeline-subject'],E.AGENT_TENANT);
      assert.deepEqual(JSON.parse(opts.body),{jsonrpc:'2.0',method:'notifications/initialized'});
      return new Response(null,{status:202});
    };
    const event={jsonrpc:'2.0',method:'notifications/initialized'};
    assert.equal((await worker.fetch(message('/mcp',event),E)).status,401);
    const authenticated=await worker.fetch(message('/mcp',event,{'cf-access-jwt-assertion':jwt}),E);
    assert.equal(authenticated.status,202);
    assert.equal(await authenticated.text(),'');
    const h={'cf-access-jwt-assertion':jwt};
    const invalid=[
      {...event,id:7},
      {...event,params:{trade:true}},
      {...event,unexpected:'shell'},
      {...event,params:[]},
    ];
    for(const malformed of invalid)
      assert.equal((await worker.fetch(message('/mcp',malformed,h),E)).status,403);
    assert.equal(routed,1);
  }finally{globalThis.fetch=previous;}
});
