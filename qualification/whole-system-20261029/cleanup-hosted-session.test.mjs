import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupHostedSession} from './cleanup-hosted-session.mjs';

test('lost DELETE acknowledgment with actual deletion is reconciled without another DELETE',async()=>{
  const calls=[];let absent=false;
  const report=await cleanupHostedSession({sessionId:'sess_fixture',apiKey:'secret-fixture',fetchImpl:async(url,init)=>{
    calls.push(init.method);assert.equal(init.redirect,'error');
    if(init.method==='DELETE'){absent=true;throw new Error('secret-fixture must never appear');}
    return new Response(null,{status:absent?404:200});
  }});
  assert.deepEqual(calls,['GET','DELETE','GET']);assert.equal(report.status,'VERIFIED_ABSENT');assert.equal(report.delete_acknowledged,false);
  assert.equal(JSON.stringify(report).includes('secret-fixture'),false);
});
test('already-absent sessions require no DELETE and denied read cannot mutate',async()=>{
  for(const status of [404,401,403,500]){
    const calls=[];const report=await cleanupHostedSession({sessionId:'sess_fixture',apiKey:'fixture',fetchImpl:async(url,init)=>{calls.push(init.method);return new Response(null,{status});}});
    assert.deepEqual(calls,['GET']);assert.equal(report.status,status===404?'VERIFIED_ABSENT':'CLEANUP_UNCERTAIN');
  }
});
test('confirmed failed deletion stays uncertain after at most three attempts',async()=>{
  let deletes=0;const report=await cleanupHostedSession({sessionId:'sess_fixture',apiKey:'fixture',fetchImpl:async(url,init)=>{if(init.method==='DELETE')deletes++;return new Response(null,{status:init.method==='GET'?200:500});}});
  assert.equal(deletes,3);assert.equal(report.status,'CLEANUP_UNCERTAIN');assert.equal(report.new_sessions,0);assert.equal(report.input_events,0);
});
