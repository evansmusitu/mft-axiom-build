import test from 'node:test';
import assert from 'node:assert/strict';
import {createHealthHandler} from '../src/staging/health.mjs';
import {GET} from '../app/api/health/route.js';

test('missing database returns 503 without configuration or credential disclosure',async()=>{
 const saved=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
 try{
  const r=await GET(new Request('https://app.invalid/api/health?ready=true',{headers:{'x-production-ready':'true'}}));
  assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.deepEqual(await r.json(),{status:'UNHEALTHY_PRIVATE_STAGING',phase1Complete:false,publicMessaging:false});
 }finally{if(saved===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=saved;}
});

test('healthy database lease is read-only, released, and never grants release readiness',async()=>{
 const queries=[],releases=[];
 const handler=createHealthHandler({getPool:()=>({connect:async()=>({query:async sql=>{queries.push(sql);return {rows:[{ok:1}]};},release:e=>releases.push(e)})})});
 const r=await handler();assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{status:'HEALTHY_PRIVATE_STAGING',phase1Complete:false,publicMessaging:false});
 assert.deepEqual(queries,['SELECT 1 AS ok']);assert.deepEqual(releases,[undefined]);
});

test('query failure discards once and does not leak provider errors',async()=>{
 const releases=[];
 const handler=createHealthHandler({getPool:()=>({connect:async()=>({query:async()=>{throw Error('private-user:private-password@private-host');},release:e=>releases.push(Boolean(e))})})});
 const r=await handler();assert.equal(r.status,503);assert.equal((await r.text()).includes('private-password'),false);assert.deepEqual(releases,[true]);
});

test('hung acquisition times out, concurrent requests share it, late lease is discarded',async()=>{
 let finish,connects=0,queries=0;const releases=[];
 const handler=createHealthHandler({timeoutMs:15,getPool:()=>({connect:()=>{connects++;return new Promise(resolve=>{finish=resolve;});}})});
 const results=await Promise.all([handler(),handler(),handler()]);
 assert.deepEqual(results.map(r=>r.status),[503,503,503]);
 assert.equal((await handler()).status,503);assert.equal(connects,1);
 finish({query:async()=>{queries++;},release:e=>releases.push(Boolean(e))});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(queries,0);assert.deepEqual(releases,[true]);
});

test('hung query discards its lease at deadline and coalesces until settlement',async()=>{
 let finish,connects=0;const releases=[];
 const handler=createHealthHandler({timeoutMs:15,getPool:()=>({connect:async()=>{connects++;return {query:()=>new Promise(resolve=>{finish=resolve;}),release:e=>releases.push(Boolean(e))};}})});
 assert.equal((await handler()).status,503);assert.deepEqual(releases,[true]);
 assert.equal((await handler()).status,503);assert.equal(connects,1);
 finish({rows:[{ok:1}]});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(releases,[true]);
});

test('invalid response cannot pass and a later independent probe can recover',async()=>{
 let attempts=0;
 const handler=createHealthHandler({getPool:()=>({connect:async()=>({query:async()=>({rows:[{ok:++attempts===1?'1':1}]}),release(){}})})});
 assert.equal((await handler()).status,503);assert.equal((await handler()).status,200);
 for(const timeoutMs of [0,-1,5001,NaN])assert.throws(()=>createHealthHandler({getPool(){},timeoutMs}),/HEALTH_CONFIG_REJECTED/);
});
