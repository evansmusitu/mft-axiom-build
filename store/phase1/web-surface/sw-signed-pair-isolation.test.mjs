import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';

import worker from './worker.mjs';

async function runtime(){
  const res=await worker.fetch(new Request('https://payments.mftintelligence.com/store/sw.js'),{},{});
  assert.equal(res.status,200);
  const listeners=new Map(),calls=[];
  const env={
    self:{location:{origin:'https://payments.mftintelligence.com'},addEventListener:(event,fn)=>listeners.set(event,fn),skipWaiting:()=>{},clients:{claim:()=>{}}},
    caches:{open:async()=>({addAll:async(paths)=>{calls.push({kind:'precache',paths});},put:async(req)=>calls.push({kind:'put',path:req.url})}),
      keys:async()=>[],match:async()=>undefined},
    fetch:async()=>new Response('{}',{status:200}),
    URL,Response,Request,Promise
  };
  runInNewContext(await res.text(),env,{timeout:5000});
  return {listeners,calls};
}
test('service worker never pre-caches detached catalog and signature independently',async()=>{
  const {listeners,calls}=await runtime();
  await new Promise((resolve,reject)=>listeners.get('install')({waitUntil:p=>Promise.resolve(p).then(resolve,reject)}));
  assert.equal(calls.length,1);
  const paths=[...calls[0].paths];
  assert.ok(paths.includes('/store'),'offline shell must remain available');
  for(const p of ['/store/catalog.json','/store/catalog.sig'])
    assert.equal(paths.includes(p),false,'signed catalog pair must not be independently pinned in offline cache: '+p);
});
test('service worker never intercepts or caches either detached signed catalog endpoint',async()=>{
  const {listeners,calls}=await runtime();
  const fetchEvent=listeners.get('fetch');
  for(const pathname of ['/store/catalog.json','/store/catalog.sig']){
    let intercepted=false;
    fetchEvent({request:new Request('https://payments.mftintelligence.com'+pathname),
      respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false,'network catalog requests must bypass old unverified caches: '+pathname);
  }
  assert.deepEqual(calls,[]);
});
test('offline page makes the unavailability of a trusted signed catalog explicit',async()=>{
  const r=await worker.fetch(new Request('https://payments.mftintelligence.com/store/offline'),{},{});
  const body=await r.text();
  assert.match(body,/catalog.*(not available offline|network.*required)/is);
  assert.match(body,/signature/i);
});
