import assert from 'node:assert/strict';
import test from 'node:test';

import {createProtectedRuntimeBridge} from '../../ops/axiom_runtime_bridge.mjs';

function database(){
  const calls=[];
  return {
    calls,
    prepare(sql){
      return {
        bind(...args){
          calls.push({sql,args});
          return {
            run:async()=>({success:true}),
            first:async()=>sql.includes('usage_events')
              ? {request_id:args[0],operation:'arithmetic.evaluate',compute_units:1,http_status:200,result_sha256:'c'.repeat(64)}
              : null,
          };
        },
      };
    },
  };
}

function runtime({computeStatus=200}={}){
  const calls=[];
  return {
    calls,
    async fetch(input,init={}){
      const url=new URL(typeof input==='string'?input:input.url);
      calls.push({url:url.href,init});
      if(url.pathname==='/health')return Response.json({ok:true,build_id:'runtime-build',operation_count:74});
      if(url.pathname==='/v1/tools')return Response.json({build_id:'runtime-build',operation_count:74,tools:['arithmetic.evaluate',...Array.from({length:73},(_,index)=>`fixture.operation.${index}`)]});
      if(url.pathname==='/v1/compute')return Response.json(computeStatus===200?{result:{value:42},receipt:{signature:'sealed'}}:{error:'upstream_failed'},{status:computeStatus});
      return new Response('not found',{status:404});
    },
  };
}

test('bridge validates the complete 74-operation runtime before use',async()=>{
  const db=database(),service=runtime();
  const bridge=createProtectedRuntimeBridge({db,service,tokenFactory:()=> 'delegated_test_token_abcdefghijklmnopqrstuvwxyz0123456789'});
  const inspected=await bridge.inspect();
  assert.equal(inspected.ok,true);
  assert.equal(inspected.operation_count,74);
  assert.equal(inspected.tools.length,74);
  assert.equal(service.calls.length,2);
});

test('bridge mints a hash-only one-request credential, meters execution, and deletes it',async()=>{
  const db=database(),service=runtime();
  const token='delegated_test_token_abcdefghijklmnopqrstuvwxyz0123456789';
  const bridge=createProtectedRuntimeBridge({db,service,tokenFactory:()=>token,now:()=>new Date('2026-09-16T12:00:00.000Z'),idFactory:()=> 'runtime_credential_1'});
  const result=await bridge.execute({customer_id:'customer_1',operation:'arithmetic.evaluate',args:{expression:'40+2'},request_id:'MUSITU-UI-REQUEST-1'});

  const insert=db.calls.find(call=>/INSERT INTO api_keys/i.test(call.sql));
  const cleanup=db.calls.find(call=>/DELETE FROM api_keys/i.test(call.sql));
  assert.ok(insert,'delegated key hash was not inserted');
  assert.ok(cleanup,'delegated key was not removed');
  assert.equal(insert.args.includes(token),false,'raw delegated token reached D1');
  assert.match(insert.args.find(value=>/^[0-9a-f]{64}$/.test(String(value))),/^[0-9a-f]{64}$/);
  const compute=service.calls.find(call=>new URL(call.url).pathname==='/v1/compute');
  assert.equal(compute.init.headers.authorization,`Bearer ${token}`);
  assert.equal(result.receipt.compute_units,1);
  assert.equal(result.receipt.result_sha256,'c'.repeat(64));
  assert.doesNotMatch(JSON.stringify(result),new RegExp(token));
});

test('bridge deletes the delegated credential when protected compute fails',async()=>{
  const db=database(),service=runtime({computeStatus:502});
  const bridge=createProtectedRuntimeBridge({db,service,tokenFactory:()=> 'delegated_test_token_abcdefghijklmnopqrstuvwxyz0123456789',idFactory:()=> 'runtime_credential_1'});
  await assert.rejects(()=>bridge.execute({customer_id:'customer_1',operation:'arithmetic.evaluate',args:{expression:'40+2'},request_id:'MUSITU-UI-REQUEST-2'}),/protected runtime compute failed/i);
  assert.ok(db.calls.some(call=>/DELETE FROM api_keys/i.test(call.sql)));
});
