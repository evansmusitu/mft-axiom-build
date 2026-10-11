import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qualifyPrivateRemoteOrder} from '../src/staging/qualify-private-remote-order.mjs';
import probe from '../src/staging/private-remote-local-bridge.mjs';
const token='MMF-SCOPE-REMOTE-CLOUD-QUALIFICATION-TEST-CREDENTIAL';
function fakeRemote(){
 const orders=new Map();let requests=0;
 return {get requests(){return requests},async fetch(req){requests++;
  const {pathname}=new URL(req.url),body=req.method==='POST'?await req.json():null;
  if(req.headers.get('authorization')!==`Bearer ${token}`)return Response.json({error:'UNAUTHORIZED'},{status:401});
  if(req.method==='GET'&&/^\/v1\/billing\/stage\/orders\/MMF-/.test(pathname)){
   const ref=pathname.split('/').at(-1);return orders.has(ref)?Response.json({orderReference:ref,status:'PENDING',canAcceptCustomerFunds:false,grantsMailSending:false,realProviderSettlementVerified:false}):Response.json({error:'NOT_FOUND'},{status:404});
  }
  if(req.method==='POST'&&pathname==='/v1/billing/stage/orders'){
   if(Object.keys(body).length!==3)return Response.json({error:'INVALID_ORDER_REQUEST'},{status:422});
   const old=orders.has(body.orderReference);orders.set(body.orderReference,body);
   return Response.json({orderReference:body.orderReference,status:'PENDING',idempotent:old,grantsMailSending:false,realProviderSettlementVerified:false,canAcceptCustomerFunds:false},{status:old?200:201});
  }
  return Response.json({error:'NOT_FOUND'},{status:404});
 }};
}
test('remote binding probe exposes no public route and only narrowly forwards private billing paths',async()=>{
 const remote=fakeRemote(),env={REMOTE_MMF_PRIVATE_BILLING:remote};
 const denied=await probe.fetch(new Request('http://localhost:8789/v1/billing/checkout',{method:'GET'}),env);
 assert.equal(denied.status,404);assert.equal(remote.requests,0);
 const ok=await probe.fetch(new Request('http://localhost:8789/v1/billing/stage/orders/MMF-FAKEFAKEFAKE',{headers:{authorization:`Bearer ${token}`}}),env);
 assert.equal(ok.status,404);assert.equal(remote.requests,1);
 assert.equal((await probe.fetch(new Request('http://localhost:8789/v1/billing/stage/orders',{method:'DELETE'}),env)).status,404);
});
test('remote qualification proves real interface contract without payment, email or public checkout',async()=>{
 const remote=fakeRemote(),env={REMOTE_MMF_PRIVATE_BILLING:remote};
 const fetchFn=async(url,init)=>probe.fetch(new Request(url,init),env);
 const result=await qualifyPrivateRemoteOrder({origin:'http://127.0.0.1:8789',operatorToken:token,fetchFn,orderReference:'MMF-REMOTEQUALIFICATION000001'});
 assert.equal(result.gate,'MMF_PRIVATE_REMOTE_ORDER_STAGE');assert.equal(result.status,'PASS');
 assert.equal(result.orderCreated,true);assert.equal(result.readVerified,true);assert.equal(result.idempotentRetryVerified,true);
 assert.equal(result.unauthorizedDenied,true);assert.equal(result.clientPriceRejected,true);assert.equal(result.missingOrderDenied,true);
 assert.equal(result.customerFunds,false);assert.equal(result.customerEmail,false);assert.equal(result.providerSettlementVerified,false);
 assert.ok(!JSON.stringify(result).includes(token));
});
test('remote qualification refuses weak token and non-loopback origin',async()=>{
 await assert.rejects(qualifyPrivateRemoteOrder({origin:'https://staging.example.org',operatorToken:token,orderReference:'MMF-REMOTEQUALIFICATION000001'}),/MMF_PRIVATE_REMOTE_QUALIFICATION_DENIED/);
 await assert.rejects(qualifyPrivateRemoteOrder({origin:'http://127.0.0.1:8789',operatorToken:'bad',orderReference:'MMF-REMOTEQUALIFICATION000001'}),/MMF_PRIVATE_REMOTE_QUALIFICATION_DENIED/);
});
test('qualification probe config declares remote PRIVATE service binding and does not publish probe',()=>{
 const cfg=JSON.parse(readFileSync(new URL('../wrangler.mmf.billing-private-remote-local-probe.jsonc',import.meta.url),'utf8'));
 assert.equal(cfg.name,'mmf-billing-qualification-local-only-20261011');
 assert.equal(cfg.main,'src/staging/private-remote-local-bridge.mjs');
 assert.equal(cfg.workers_dev,false);assert.equal(cfg.preview_urls,false);assert.deepEqual(cfg.routes,[]);
 assert.deepEqual(cfg.services,[{binding:'REMOTE_MMF_PRIVATE_BILLING',service:'musitu-mail-fabric-payment-private-stage-20261011',remote:true}]);
 assert.equal(cfg.durable_objects,undefined);assert.equal(cfg.vars,undefined);assert.equal(cfg.triggers,undefined);
});
test('qualification workflow must restrict code changes to isolated branch, never create a public route or retain credential',()=>{
 const data=readFileSync(new URL('../../.github/workflows/mmf-billing-private-remote-order-qualification-20261011.yml',import.meta.url),'utf8');
 assert.match(data,/github\.event\.before == 'dea00e70f57d27338c6b238a25b3df6bb3d34110'/);
 assert.match(data,/product\/musitu-mail-fabric-isolated-20261009/);
 assert.match(data,/remote.*true|remote: true/);
 assert.match(data,/Rotate.*operator.*credential/i);
 assert.match(data,/127\.0\.0\.1:8789/);
 assert.doesNotMatch(data,/--remote\b/);
 assert.doesNotMatch(data,/workers_dev:\s*true/);
});
