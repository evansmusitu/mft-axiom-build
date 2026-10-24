/** Real cross-language offline acceptance:
 * Cloudflare Worker JS + signed Access JWT + HMAC + loopback FastAPI + durable
 * SQLite fixture. Synthetic probe ONLY; no real Modal/Neon/MT5, no paid calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import worker from './index.mjs';

const PORT=Number(process.env.LIFELINE_LOCAL_STACK_PORT||19234);
const HOST='http://127.0.0.1:'+PORT;
const TEST_AGENT_KEY='TEST_ONLY_HMAC_FOR_OFFLINE_INTEGRATION_DO_NOT_USE';
const TEST_EDGE_KEY='TEST_ONLY_EDGE_SECRET_FOR_OFFLINE_INTEGRATION';
const AGENT_ID='lifeline-offline-agent';
const TENANT='lifeline_offline_tenant';
const OWNER='lifeline-offline-owner';
const MODAL='https://lifeline-offline.modal.run/';
const ISSUER='https://lifeline-offline.cloudflareaccess.com/';
const E={
  ACCESS_ISSUER:ISSUER,ACCESS_AUD:'lifeline-offline-audience',ACCESS_OPERATOR_SUB:OWNER,
  MODAL_ORIGIN:MODAL,MODAL_PROXY_KEY:'FAKE_OFFLINE_PROXY_KEY',MODAL_PROXY_SECRET:'FAKE_OFFLINE_PROXY_SECRET',
  EDGE_SHARED_SECRET:TEST_EDGE_KEY,AGENT_ID,AGENT_TENANT:TENANT,AGENT_HMAC_KEY:TEST_AGENT_KEY,
  // NO production cutover: this only exists in this local test's in-memory env.
  LIFELINE_PRIVATE_BACKEND_CUTOVER:'AUTHORIZED'
};

function sorted(v){
  if(Array.isArray(v))return v.map(sorted);
  if(v&&typeof v==='object')
    return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,val])=>[key,sorted(val)]));
  return v;
}
const canon=o=>JSON.stringify(sorted(o));
const hmac=obj=>createHmac('sha256',TEST_AGENT_KEY).update(canon(obj)).digest('hex');
const authHeaders=body=>{
  const stamp=String(Math.floor(Date.now()/1000));
  const nonce=randomBytes(24).toString('base64url');
  const hash=createHash('sha256').update(canon(body)).digest('hex');
  const input=[AGENT_ID,TENANT,stamp,nonce,hash].join('\n');
  const signature=createHmac('sha256',TEST_AGENT_KEY).update(input).digest('hex');
  return {'x-lifeline-agent-id':AGENT_ID,'x-lifeline-tenant':TENANT,
    'x-lifeline-time':stamp,'x-lifeline-nonce':nonce,'x-lifeline-signature':signature};
};
const post=(path,body,headers={})=>new Request('https://lifeline-offline.invalid'+path,{
  method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)
});
const call=async(path,body,headers)=> {
  const r=await worker.fetch(post(path,body,headers),E);
  return {status:r.status,body:await r.json()};
};

test('full signed owner → edge → local Modal contract → queue → agent receipt; no trading',async()=>{
  const check=await fetch(HOST+'/__offline_ready');
  assert.equal(check.status,200);
  assert.deepEqual(await check.json(),{offline_only:true,trading_enabled:false,persistent_windows:false});

  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='offline-jwks-1';jwk.alg='RS256';jwk.use='sig';
  const token=await new SignJWT({sub:OWNER}).setProtectedHeader({alg:'RS256',kid:'offline-jwks-1'})
    .setIssuer(ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const differentOwner=await new SignJWT({sub:'lifeline-unapproved-user'})
    .setProtectedHeader({alg:'RS256',kid:'offline-jwks-1'})
    .setIssuer(ISSUER.slice(0,-1)).setAudience(E.ACCESS_AUD)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const original=globalThis.fetch;
  let backendCalls=0;
  globalThis.fetch=async(url,options)=>{
    const uri=String(url);
    if(uri===ISSUER.slice(0,-1)+'/cdn-cgi/access/certs')
      return new Response(JSON.stringify({keys:[jwk]}),
        {headers:{'content-type':'application/json'}});
    if(uri.startsWith(MODAL)){
      backendCalls++;
      assert.equal(options?.redirect,'manual');
      assert.equal(options?.headers?.['modal-key'],E.MODAL_PROXY_KEY);
      assert.equal(options?.headers?.['modal-secret'],E.MODAL_PROXY_SECRET);
      assert.equal(options?.headers?.['x-lifeline-edge-secret'],TEST_EDGE_KEY);
      const dest=new URL(uri).pathname;
      assert.ok(['/operator/probe','/operator/status','/agent/pull',
        '/agent/receipt','/mcp'].includes(dest),'only allowlisted offline routes');
      const forwardedHeaders={...options.headers};
      // Local fixture, not a Modal proxy token bearer verification.
      return original(HOST+dest,{method:'POST',headers:forwardedHeaders,body:options.body,redirect:'manual'});
    }
    throw new Error('unexpected external network access in offline fixture');
  };
  try{
    const owner={'cf-access-jwt-assertion':token};
    const anon=await call('/operator/status',{}, {});
    assert.equal(anon.status,401,'anonymous owner never reaches stage');
    const other=await call('/operator/status',{}, {'cf-access-jwt-assertion':differentOwner});
    assert.equal(other.status,401,'wrong user with valid signing key denied');
    assert.equal(backendCalls,0,'neither anonymous nor wrong user reached private bridge');
    const disabled=await worker.fetch(post('/operator/status',{},owner),
      {...E,LIFELINE_PRIVATE_BACKEND_CUTOVER:undefined});
    assert.equal(disabled.status,503,'real cutover remains independently gated');
    const before=await call('/operator/status',{},owner);
    assert.equal(before.status,200);
    assert.deepEqual(before.body.jobs,{});
    assert.equal(before.body.trade_execution,false);

    const trade=await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',
      params:{name:'order_send',arguments:{}}},owner);
    assert.equal(trade.status,403,'trade rejected by Cloudflare without calling stage');
    assert.equal(backendCalls,1,'trade denial occurred at edge, before any extra backend call');
    const list=await call('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},owner);
    assert.equal(list.status,200);
    assert.deepEqual(list.body.result.tools.map(x=>x.name),['lifeline_status']);

    const initialized=await worker.fetch(post('/mcp',
      {jsonrpc:'2.0',method:'notifications/initialized'},owner),E);
    assert.equal(initialized.status,202,'legacy client initialization requires HTTP 202');
    assert.equal(await initialized.text(),'');
    const task=await call('/operator/probe',{operation:'probe'},owner);
    assert.equal(task.status,200);
    assert.equal(task.body.state,'PENDING');
    assert.equal(task.body.trade_execution,false);

    const request={request:'next',tenant:TENANT};
    const headers=authHeaders(request);
    const rejectedHeaders={...authHeaders(request),'x-lifeline-signature':'0'.repeat(64)};
    const beforeBadAgent=backendCalls;
    assert.equal((await call('/agent/pull',request,rejectedHeaders)).status,401);
    assert.equal(backendCalls,beforeBadAgent,'invalid HMAC blocked at the edge');
    const pulled=await call('/agent/pull',request,headers);
    assert.equal(pulled.status,200);
    assert.equal(pulled.body.job.job_id,task.body.job_id);
    assert.equal(pulled.body.job.operation,'probe');
    const {signature,...unsigned}=pulled.body.job;
    assert.ok(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(hmac(unsigned),'hex')),
      'backend task must have the exact cross-language HMAC signature');
    const replay=await call('/agent/pull',request,headers);
    assert.equal(replay.status,502,'replayed request rejected by backend then masked at edge');
    assert.equal(replay.body.error,'private_runtime_rejected');

    const receipt={
      schema:'lifeline.agent.receipt.v1',job_id:task.body.job_id,tenant:TENANT,
      operation:'probe',outcome:'completed',
      result:{windows:false,metaeditor_available:false,terminal_available:false,live_trading:false},
      created_at:Math.floor(Date.now()/1000),trading_enabled:false
    };
    receipt.signature=hmac(receipt);
    const tampered={...receipt,operation:'backtest'};
    delete tampered.signature;
    tampered.signature=hmac(tampered);
    const invalidReceipt={receipt:tampered};
    const rejected=await call('/agent/receipt',invalidReceipt,authHeaders(invalidReceipt));
    assert.equal(rejected.status,502,'backend rejected mismatched signed receipt');
    assert.equal(rejected.body.error,'private_runtime_rejected','no sensitive backend error leaks');
    const payload={receipt};
    const acknowledged=await call('/agent/receipt',payload,authHeaders(payload));
    assert.equal(acknowledged.status,200);
    assert.equal(acknowledged.body.job_id,task.body.job_id);
    assert.equal(acknowledged.body.accepted,true);
    const second=await call('/agent/receipt',payload,authHeaders(payload));
    assert.equal(second.status,200,'same receipt may be acknowledged without re-execution');
    assert.equal(second.body.accepted,true);
    const idle=await call('/agent/pull',request,authHeaders(request));
    assert.equal(idle.status,200);
    assert.equal(idle.body.job,null,'completed job was not reissued for execution');
    const after=await call('/operator/status',{},owner);
    assert.equal(after.status,200);
    assert.equal(after.body.jobs.COMPLETED,1);
    assert.equal(after.body.trade_execution,false);
    assert.ok(backendCalls>=5);
  }finally{
    globalThis.fetch=original;
  }
});
