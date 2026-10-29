import assert from 'node:assert/strict';
import test from 'node:test';

import {runConnectedTask} from '../runtime_execution_client.mjs';

test('browser client uses only the same-origin HttpOnly session and consumes live phases',async()=>{
  const events=[];
  let captured;
  const fetchImpl=async(url,init)=>{
    captured={url:String(url),init};
    const stream=[
      'event: phase\ndata: {"phase":"ACCEPTED","task_id":"task_1"}\n\n',
      'event: phase\ndata: {"phase":"RUNTIME_CONNECTED","operation_count":74}\n\n',
      'event: complete\ndata: {"status":"COMPLETED","task_id":"task_1","artifact":{"title":"Done"}}\n\n',
    ].join('');
    return new Response(stream,{status:200,headers:{'content-type':'text/event-stream'}});
  };
  const result=await runConnectedTask('Calculate 40+2',{fetchImpl,baseURI:'https://axiom.example/vnext/index.html',onEvent:event=>events.push(event)});
  assert.equal(captured.url,'https://axiom.example/vnext/api/tasks');
  assert.equal(captured.init.credentials,'same-origin');
  assert.equal(captured.init.headers.authorization,undefined);
  assert.equal(JSON.parse(captured.init.body).objective,'Calculate 40+2');
  assert.deepEqual(events.map(event=>event.event),['phase','phase','complete']);
  assert.equal(result.task_id,'task_1');
});

test('client surfaces sign-in requirement without following an external redirect',async()=>{
  const fetchImpl=async()=>new Response(JSON.stringify({error:'authenticated_session_required',sign_in_path:'/auth/start'}),{status:401,headers:{'content-type':'application/json'}});
  await assert.rejects(()=>runConnectedTask('Calculate 40+2',{fetchImpl,baseURI:'https://axiom.example/vnext/index.html'}),error=>{
    assert.equal(error.code,'AUTHENTICATION_REQUIRED');
    assert.equal(error.signInHref,'https://axiom.example/auth/start');
    return true;
  });
});

test('client rejects non-event-stream success responses',async()=>{
  const fetchImpl=async()=>Response.json({status:'COMPLETED'});
  await assert.rejects(()=>runConnectedTask('Calculate 40+2',{fetchImpl,baseURI:'https://axiom.example/vnext/index.html'}),/event stream/i);
});
