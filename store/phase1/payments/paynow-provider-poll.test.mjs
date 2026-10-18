import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pollAndRecordPaynowReviewEvent} from './paynow-provider-poll.mjs';

const key='disposable-paynow-CI-merchant-key-not-real';
const url='https://www.paynow.co.zw/Interface/CheckPayment/?guid=ad1a986c-3434-44a4-8f5b-111111111111';
const order={reference:'ORDER-POLL-103',amount:'12.34',pollurl:url};
function signed(changes={}){
  const data={reference:order.reference,paynowreference:'PAYNOW-REAL-LOOKING-FIXTURE',
    amount:order.amount,status:'Paid',pollurl:url,...changes};
  const entries=Object.entries(data);
  const hash=createHash('sha512').update(entries.map(([,v])=>v).join('')+key).digest('hex').toUpperCase();
  return entries.map(([k,v])=>k+'='+encodeURIComponent(v)).join('&')+'&hash='+hash;
}
function fixture(t){
 const base=mkdtempSync(join(tmpdir(),'paynow-poll-transport-'));
 const ledgerDirectory=join(base,'journal');
 mkdirSync(ledgerDirectory,{mode:0o700});
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 return {ledgerDirectory};
}
function fakeProvider({status=200,response=signed(),mime='text/plain; charset=utf-8',timeout=false,chunks=null}={}){
 const calls=[];
 function requestImpl(target,options,callback){
   const record={url:String(target),method:options.method,headers:options.headers,
     rejectUnauthorized:options.rejectUnauthorized,servername:options.servername,timeoutMs:0,body:''};
   calls.push(record);
   const req=new EventEmitter();
   let timeoutFn;
   req.setTimeout=(ms,fn)=>{record.timeoutMs=ms;timeoutFn=fn;return req;};
   req.destroy=(error)=>{if(error)queueMicrotask(()=>req.emit('error',error));};
   req.write=(x)=>{record.body+=String(x);};
   req.end=()=>queueMicrotask(()=>{
     if(timeout){timeoutFn();return;}
     const res=new PassThrough();
     res.statusCode=status;
     res.headers={'content-type':mime};
     callback(res);
     for(const c of chunks??[response])res.write(c);
     res.end();
   });
   return req;
 }
 return {requestImpl,calls};
}
function execute(t,provider,options={}){
 const d=fixture(t);
 const result=pollAndRecordPaynowReviewEvent({ledgerDirectory:d.ledgerDirectory,
   callbackBody:signed(),integrationKey:key,order,requestImpl:provider.requestImpl,...options});
 return {result,d};
}
test('an independent HTTPS empty POST with bounded response can record review only',async t=>{
 const provider=fakeProvider();const {result,d}=execute(t,provider);
 const review=await result;
 assert.equal(provider.calls.length,1);
 assert.equal(provider.calls[0].url,url);
 assert.equal(provider.calls[0].method,'POST');
 assert.equal(provider.calls[0].body,'');
 assert.equal(provider.calls[0].rejectUnauthorized,true);
 assert.ok(provider.calls[0].timeoutMs>0&&provider.calls[0].timeoutMs<=10000);
 assert.equal(review.state,'REVIEW_RECORDED_PRIVATE_ONLY');
 assert.equal(review.entitlementGranted,false);
 assert.equal(review.publisherSettlementAuthorized,false);
 assert.equal(review.refundFinalized,false);
 assert.equal(readdirSync(d.ledgerDirectory).filter(n=>n.endsWith('.json')&&!n.startsWith('provider-')).length,1,
   'exactly one review journal, independent of immutable provider claim');
 assert.equal(readdirSync(d.ledgerDirectory).filter(n=>n.startsWith('provider-')&&n.endsWith('.json')).length,1,
   'exactly one globally unique transaction ownership claim');
});
test('bad signed callback rejects before any HTTP transport',async t=>{
 const provider=fakeProvider();const {result,d}=execute(t,provider,
   {callbackBody:signed().replace('Paid','Refunded')});
 await assert.rejects(result,/signature|hash/i);
 assert.equal(provider.calls.length,0);assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
});
test('not even signed callback may redirect the poll to another host',async t=>{
 const provider=fakeProvider();const {result,d}=execute(t,provider,{
   order:{...order,pollurl:'https://attacker.example/Interface/CheckPayment/?guid=ad1a986c-3434-44a4-8f5b-111111111111'}
 });
 await assert.rejects(result,/poll|host/i);
 assert.equal(provider.calls.length,0);assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
});
test('failed or redirected independent provider HTTP reply cannot commit review',async t=>{
 for(const status of [301,302,307,308,401,429,500]){
   const provider=fakeProvider({status}),{result,d}=execute(t,provider);
   await assert.rejects(result,/provider|HTTP|status|redirect/i);
   assert.equal(provider.calls.length,1);assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
 }
});
test('bad provider MIME and oversized response are rejected without writes',async t=>{
 for(const provider of [fakeProvider({mime:'text/html'}),fakeProvider({chunks:['x'.repeat(13000)]})]){
   const {result,d}=execute(t,provider);
   await assert.rejects(result,/provider|content.type|size|large/i);
   assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
 }
});
test('provider timeout rejects with no durable positive review',async t=>{
 const provider=fakeProvider({timeout:true}),{result,d}=execute(t,provider);
 await assert.rejects(result,/timeout|provider/i);
 assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
});
test('malformed or mismatched signed independently polled status rejects',async t=>{
 for(const response of [signed({amount:'12.35'}),signed({paynowreference:'OTHER-PAYNOW'}),signed().replace('Paid','Refunded')]){
   const provider=fakeProvider({response}),{result,d}=execute(t,provider);
   await assert.rejects(result,/amount|provider|signature|hash/i);
   assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
 }
});
test('real polled Refunded status locks review permanently, never pays out',async t=>{
 const p=fakeProvider({response:signed({status:'Refunded'})}),{result,d}=execute(t,p);
 const review=await result;
 assert.equal(review.manualReviewLocked,true);
 assert.equal(review.entitlementGranted,false);
 assert.equal(review.publisherSettlementAuthorized,false);
 assert.equal(readdirSync(d.ledgerDirectory).filter(n=>n.endsWith('.json')&&!n.startsWith('provider-')).length,1,
   'exactly one review journal, independent of immutable provider claim');
 assert.equal(readdirSync(d.ledgerDirectory).filter(n=>n.startsWith('provider-')&&n.endsWith('.json')).length,1,
   'exactly one globally unique transaction ownership claim');
});
test('the full independent poll may only be mocked on explicitly isolated CI',async t=>{
 const p=fakeProvider();
 const before=process.env.CI;
 process.env.CI='false';
 try{
   const {result}=execute(t,p);
   await assert.rejects(result,/CI|mock|production/i);
   assert.equal(p.calls.length,0);
 }finally{if(before===undefined)delete process.env.CI;else process.env.CI=before;}
});


function abruptlyClosedProvider(phase){
  const calls=[];
  const requestImpl=(target,options,onResponse)=>{
    calls.push({target:String(target),options});
    const req=new EventEmitter();
    req.setTimeout=()=>req;
    req.destroy=()=>{};
    req.end=()=>queueMicrotask(()=>{
      if(phase==='request'){
        req.emit('close');
        return;
      }
      const res=new PassThrough();
      res.statusCode=200;
      res.headers={'content-type':'text/plain'};
      onResponse(res);
      res.write('reference=ORDER-POLL-103&paynowreference=PARTIAL');
      // A real socket may close prematurely without an 'error' or 'aborted'
      // event. Such a response never becomes a signed provider confirmation.
      res.destroy();
    });
    return req;
  };
  return {requestImpl,calls};
}
function deadlineGuard(promise){
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('TEST_HUNG_UNHANDLED_PROVIDER_CONNECTION')),600);
  });
  return Promise.race([promise,deadline]).finally(()=>clearTimeout(timer));
}
test('early TLS response close without end rejects promptly and never journals partial payment',async t=>{
  const provider=abruptlyClosedProvider('response');
  const {result,d}=execute(t,provider);
  await assert.rejects(deadlineGuard(result),/^Error: private Paynow provider poll: provider response closed before completion$/i);
  assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
});
test('TLS request close before receiving HTTP headers rejects promptly without writing payment history',async t=>{
  const provider=abruptlyClosedProvider('request');
  const {result,d}=execute(t,provider);
  await assert.rejects(deadlineGuard(result),/^Error: private Paynow provider poll: provider request closed before completion$/i);
  assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
});
