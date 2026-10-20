import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import worker from './index.mjs';
import {SignJWT,generateKeyPair,exportJWK} from 'jose';

const E={ACCESS_ISSUER:'https://lifeline-test.cloudflareaccess.com/',ACCESS_AUD:'stage-audience',
  MODAL_ORIGIN:'https://lifeline-stage.modal.run/',MODAL_PROXY_KEY:'test-proxy-key',MODAL_PROXY_SECRET:'test-proxy-secret',
  EDGE_SHARED_SECRET:'test-edge-secret-more-than-32-characters!',
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
  const token=await new SignJWT({sub:'tenant-A'}).setProtectedHeader({alg:'RS256',kid:'kid-test'})
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
      assert.equal(opts.headers['x-lifeline-subject'],'tenant-A');
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
