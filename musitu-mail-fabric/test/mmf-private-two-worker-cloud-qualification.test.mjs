import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateTwoWorkerLoopback} from '../src/staging/private-two-worker-loopback-bridge.mjs';
import {qualifyPrivateTwoWorker} from '../src/staging/qualify-private-two-worker.mjs';
import {generateKeyPairSync,createHash} from 'node:crypto';

const token='private-stage-operator-test-token-20261011';
const authorityToken='private-stage-authority-test-token-20261011';
const receiptToken='private-stage-receipt-test-token-20261011';
test('local-only two-Worker bridge forwards only fixed billing order and MMF authority receipt paths',async()=>{
 const called=[];
 const binding=(name)=>({fetch:async req=>{called.push({name,path:new URL(req.url).pathname,auth:req.headers.get('authorization')});return Response.json({target:name},{status:200})}});
 const worker=createPrivateTwoWorkerLoopback();
 const env={REMOTE_MMF_PRIVATE_BILLING:binding('billing'),REMOTE_MMF_PRIVATE_AUTHORITY:binding('authority')};
 for(const [route,method,target] of [['/v1/billing/stage/orders','POST','billing'],['/v1/billing/stage/orders/MMF-QUALIFYABCDEFGHIJKLMNOP','GET','billing'],['/internal/mmf/stage/receipt','POST','authority']]){
  const res=await worker.fetch(new Request('http://127.0.0.1:8794'+route,{method}),env);
  assert.equal(res.status,200);assert.equal((await res.json()).target,target);
 }
 assert.deepEqual(called.map(x=>x.name),['billing','billing','authority']);
 for(const [uri,method] of [['http://0.0.0.0:8794/v1/billing/stage/orders','POST'],['https://evil.example/v1/billing/stage/orders','POST'],['http://127.0.0.1:8794/v1/billing/stage/evidence','POST'],['http://127.0.0.1:8794/internal/mmf/stage/receipt?test=1','POST'],['http://127.0.0.1:8794/internal/mmf/stage/receipt','GET'],['http://127.0.0.1:8794/checkout','POST']]){
  const res=await worker.fetch(new Request(uri,{method}),env);assert.equal(res.status,404,uri);
 }
 assert.equal(called.length,3);
 assert.equal((await worker.fetch(new Request('http://127.0.0.1:8794/internal/mmf/stage/receipt',{method:'POST'}),{REMOTE_MMF_PRIVATE_BILLING:env.REMOTE_MMF_PRIVATE_BILLING})).status,404);
});
test('two-Worker synthetic verification refuses missing operator keys, signing key and nonlocal endpoints',async()=>{
 const {privateKey}=generateKeyPairSync('ed25519');
 for(const patch of [{origin:'https://example.com'},{operatorToken:'bad'},{callerToken:'bad'},{signingKey:'corrupt'},{orderReference:'OTHER-ORDER'}]){
  let calls=0;
  await assert.rejects(qualifyPrivateTwoWorker({origin:'http://127.0.0.1:8794',operatorToken:token,callerToken:authorityToken,receiptToken,signingKey:privateKey.export({type:'pkcs8',format:'pem'}),orderReference:'MMF-TWOWORKERQUALIFY012345',fetchFn:async()=>{calls++;throw Error('network must be blocked')},...patch}),/MMF_PRIVATE_TWO_WORKER_QUALIFICATION_DENIED/);
  assert.equal(calls,0);
 }
});
test('two-Worker qualification passes signed settlement, reversal and duplicate with real Worker interfaces',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
 const pem=publicKey.export({type:'spki',format:'pem'});
 const {createInMemoryPrivateBillingTestEnv}=await import('./helpers/mmf-two-worker-test-env.mjs');
 const {stage,authority,close}=createInMemoryPrivateBillingTestEnv({operatorToken:token,callerToken:authorityToken,receiptToken,pem,fingerprint});
 const bridge=createPrivateTwoWorkerLoopback();let billingCalls=0,authorityCalls=0;
 const env={REMOTE_MMF_PRIVATE_BILLING:{fetch:async req=>{billingCalls++;return stage.fetch(req)}},REMOTE_MMF_PRIVATE_AUTHORITY:{fetch:async req=>{authorityCalls++;return authority.fetch(req)}}};
 const fakeFetch=async(u,opts)=>bridge.fetch(new Request(u,opts),env);
 const result=await qualifyPrivateTwoWorker({origin:'http://127.0.0.1:8794',operatorToken:token,callerToken:authorityToken,receiptToken,signingKey:privateKey.export({type:'pkcs8',format:'pem'}),orderReference:'MMF-TWOWORKERQUALIFY012345',fetchFn:fakeFetch});
 assert.equal(result.status,'PASS');assert.equal(result.privateBillingState,'REVERSED_SANDBOX');assert.equal(result.realPaynowCalls,0);assert.equal(result.customerFunds,false);
 assert.ok(billingCalls>=3);assert.ok(authorityCalls>=4);close();
});
