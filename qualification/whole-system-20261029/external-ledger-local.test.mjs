/** Actual workerd SQLite Durable Objects; synthetic keys, no hosted authority claim. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture} from './external-ledger-fixture.mjs';
import {verifyEnvelope,bytes,b64} from '../../integrations/independent-ledger/protocol.mjs';
test('ledger holds before explicit bootstrap and keeps operator, read and consumer privileges separate',{timeout:30000},async t=>{
  const f=await fixture(t),c=await f.makeClient();
  const req=await f.prepare(c);await assert.rejects(()=>c.consume(req),e=>e.remote_code==='LEDGER_NOT_INITIALIZED_HOLD');
  const bootstrap={ledger_id:f.config.ledger_id,genesis_id:f.config.genesis_id,challenge:'0'.repeat(64)};
  assert.equal((await f.request('/v1/operator/bootstrap',bootstrap,{role:'consume'})).status,403);
  await f.bootstrap();await f.grant();
  for(const [path,input,role]of [['/v1/operator/grants',f.grantInput(),'consume'],['/v1/operator/revoke',{grant_id:'grant-one',tenant_id:'tenant-alpha',expected_epoch:1,challenge:'2'.repeat(64)},'consume'],['/v1/inspect',{grant_id:'grant-one',tenant_id:'tenant-alpha',action_id:null,challenge:'3'.repeat(64)},'consume']])assert.equal((await f.request(path,input,{role})).status,403);
  const fresh=await f.prepare(c);assert.equal((await f.request('/v1/consume',fresh,{role:'beta'})).status,403);
  assert.equal((await f.request('/v1/consume',fresh,{role:'grant'})).status,403);
  assert.equal((await f.request('/v1/inspect',{}, {method:'GET',role:'read'})).status,404);
});
test('concurrent clients receive at most one consume permit and readback cannot grant dispatch',{timeout:30000},async t=>{
  const f=await fixture(t);await f.bootstrap();await f.grant();
  const clients=await Promise.all(Array.from({length:8},()=>f.makeClient()));
  const requests=await Promise.all(clients.map(c=>f.prepare(c)));
  const results=await Promise.allSettled(clients.map((c,i)=>c.consume(requests[i])));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const winner=results.findIndex(x=>x.status==='fulfilled');assert.equal(await clients[winner].verifyStored(requests[winner],results[winner].value),true);
  const read=await clients[0].inspect({tenant_id:'tenant-alpha',action_id:requests[0].action_id});
  assert.equal(read.payload.grant.sequence,1);assert.equal(read.payload.grant.provider_calls,1);assert.equal(read.payload.dispatch_allowed,false);assert.equal(read.payload.consumed.grant_sequence,1);
  await assert.rejects(()=>verifyEnvelope(read,{jwk:f.publicJwk,reference:clients[0].reference,request:requests[0]}));
});
test('lost acknowledgement holds consumption and neither retry nor readback returns another permit',{timeout:30000},async t=>{
  const f=await fixture(t);await f.bootstrap();await f.grant();let sends=0;
  const c=await f.makeClient({fetchImpl:async(url,init)=>{sends++;const r=await f.fetchImpl(url,init);assert.equal(r.status,200);await r.body.cancel();throw new TypeError('lost response after commit');}});
  const request=await f.prepare(c);await assert.rejects(()=>c.consume(request),/AMBIGUOUS_HOLD/);assert.equal(sends,1);
  await assert.rejects(()=>c.consume(request),/FRESH_PREPARED_REQUEST_REQUIRED/);assert.equal(sends,1);
  const restored=await f.makeClient(),replay=await f.prepare(restored);
  await assert.rejects(()=>restored.consume(replay),e=>e.remote_code==='ALREADY_CONSUMED_HOLD');
  const read=await restored.inspect({tenant_id:'tenant-alpha',action_id:request.action_id});assert.equal(read.payload.grant.provider_calls,1);assert.equal(read.payload.dispatch_allowed,false);
});
test('authority restart and rebuilding the client preserve the independently stored consume fence',{timeout:30000},async t=>{
  const f=await fixture(t,{persist:true});await f.bootstrap();await f.grant();const old=await f.makeClient(),r=await f.prepare(old);await old.consume(r);
  await f.restart();const rebuilt=await f.makeClient(),again=await f.prepare(rebuilt);
  await assert.rejects(()=>rebuilt.consume(again),e=>e.remote_code==='ALREADY_CONSUMED_HOLD');
  assert.equal((await rebuilt.inspect({tenant_id:'tenant-alpha'})).payload.grant.sequence,1);
});
test('revocation and epoch changes deny new consumption and stale grants',{timeout:30000},async t=>{
  const f=await fixture(t);await f.bootstrap();await f.grant();const c=await f.makeClient();await c.consume(await f.prepare(c));
  const revoke=await f.request('/v1/operator/revoke',{grant_id:'grant-one',tenant_id:'tenant-alpha',expected_epoch:1,challenge:'4'.repeat(64)},{role:'revoke'});assert.equal(revoke.status,200);
  const afterRevoke=await f.prepare(c,{slot:1});await assert.rejects(()=>c.consume(afterRevoke),e=>e.remote_code==='GRANT_EXPIRED_OR_REVOKED');
  const epoch=await f.request('/v1/operator/epoch',{expected_epoch:1,challenge:'5'.repeat(64)},{role:'revoke'});assert.equal(epoch.status,200);
  assert.equal((await f.request('/v1/operator/grants',f.grantInput({grant_id:'old-epoch'}))).status,403);
  const read=await c.inspect({tenant_id:'tenant-alpha'});assert.equal(read.payload.current_epoch,2);assert.equal(read.payload.grant.state,'REVOKED');
});
test('immutable grant identity, first contract binding and independent call caps prevent rollback substitutions',{timeout:30000},async t=>{
  const f=await fixture(t);await f.bootstrap();await f.grant({max_actions:2,max_provider_calls:1});const c=await f.makeClient();await c.consume(await f.prepare(c));
  assert.equal((await f.request('/v1/operator/grants',f.grantInput())).status,409);
  const replacement=await f.request('/v1/operator/grants',f.grantInput({grant_id:'replacement-grant'}));assert.equal(replacement.status,409);assert.equal((await replacement.json()).error,'WORK_AUTHORITY_ALREADY_ASSIGNED_HOLD');
  const changed=await f.prepare(c,{slot:1,contract:{tenant_id:'tenant-alpha',work_id:'work-one',contract_sha256:'d'.repeat(64),policy:{external_ledger:c.reference}}});
  await assert.rejects(()=>c.consume(changed),e=>e.remote_code==='CONTRACT_REBIND_DENIED');
  const tooMany=await f.prepare(c,{slot:1});await assert.rejects(()=>c.consume(tooMany),e=>e.remote_code==='GRANT_CALL_BUDGET_EXHAUSTED');
  assert.equal((await c.inspect({tenant_id:'tenant-alpha'})).payload.grant.provider_calls,1);
});
test('missing authority storage and signing failure hold without automatically resetting consumed authority',{timeout:30000},async t=>{
  const f=await fixture(t,{persist:true});await f.bootstrap();await f.grant();const c=await f.makeClient();
  await f.restart({LEDGER_SIGNING_JWK:'{}'});
  await assert.rejects(async()=>c.consume(await f.prepare(c)),e=>e.remote_code==='SIGNER_UNAVAILABLE');
  await f.restart();const rebuilt=await f.makeClient();
  assert.equal((await rebuilt.inspect({tenant_id:'tenant-alpha'})).payload.grant.sequence,1);
  await assert.rejects(async()=>rebuilt.consume(await f.prepare(rebuilt)),e=>e.remote_code==='ALREADY_CONSUMED_HOLD');
  await f.loseStore();const fresh=await f.makeClient();
  await assert.rejects(async()=>fresh.consume(await f.prepare(fresh)),e=>e.remote_code==='LEDGER_NOT_INITIALIZED_HOLD');
});
test('freshness and pinned signatures are checked independently of stored-proof verification',{timeout:30000},async t=>{
  const f=await fixture(t);await f.bootstrap();await f.grant();const c=await f.makeClient(),request=await f.prepare(c),envelope=await c.consume(request);
  const changed=structuredClone(envelope);changed.payload.request_sha256='f'.repeat(64);await assert.rejects(()=>c.verifyStored(request,changed),/SIGNATURE_INVALID/);
  const stale=structuredClone(envelope);stale.payload.issued_at=new Date(Date.now()-60000).toISOString();stale.payload.valid_until=new Date(Date.parse(stale.payload.issued_at)+15000).toISOString();stale.signature=b64(await crypto.subtle.sign('Ed25519',f.keys.privateKey,bytes(stale.payload)));
  await assert.rejects(()=>verifyEnvelope(stale,{jwk:f.publicJwk,reference:c.reference,request}),/NOT_FRESH/);
  assert.equal(await c.verifyStored(request,stale),true,'historical readback is evidence, not a fresh dispatch permit');
});
test('private-key discovery, non-external endpoints and malformed bodies fail closed',{timeout:30000},async t=>{
  const f=await fixture(t);await f.bootstrap();await f.grant();
  for(const origin of ['http://custody.example','https://127.0.0.1','https://localhost','https://custody.example/path','https://user:password@custody.example'])await assert.rejects(()=>f.makeClient({origin}));
  await assert.rejects(()=>f.makeClient({public_key_jwk:{...f.publicJwk,d:'private'}}));
  const c=await f.makeClient(),request=await f.prepare(c);
  assert.equal((await f.request('/v1/consume',request,{role:'consume',raw:JSON.stringify(request,null,2)})).status,400);
  assert.equal((await f.request('/v1/consume',{...request,provider_calls:0},{role:'consume'})).status,400);
  assert.equal((await c.inspect({tenant_id:'tenant-alpha'})).payload.grant.sequence,0);
});
test('a network partition or stalled response body meets the deadline without retry or releasing another permit',{timeout:5000},async t=>{
  const f=await fixture(t);
  for(const transport of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}})]){
    let calls=0;const c=await f.makeClient({timeoutMs:100,fetchImpl:async(...args)=>{calls++;assert.equal(args[1].credentials,'omit');assert.equal(args[1].redirect,'manual');return transport(...args);}}),request=await f.prepare(c),start=Date.now();
    await assert.rejects(()=>c.consume(request),/TIMEOUT_AMBIGUOUS_HOLD/);assert.equal(calls,1);assert.ok(Date.now()-start<1000);
    await assert.rejects(()=>c.consume(request),/FRESH_PREPARED_REQUEST_REQUIRED/);assert.equal(calls,1);
  }
});
test('LIMITATION counterexample: authority-admin restore of its own older store re-enables replay without an external high-water anchor',{timeout:30000},async t=>{
  const f=await fixture(t,{persist:true});await f.bootstrap();await f.grant();await f.snapshotStore();
  let c=await f.makeClient(),request=await f.prepare(c);const first=await c.consume(request);assert.equal(first.payload.grant_sequence,1);
  await f.restoreStore();c=await f.makeClient();request=await f.prepare(c);const replay=await c.consume(request);
  assert.equal(replay.payload.dispatch_allowed,true,'this deliberately reproduced attack is NOT security acceptance');
  assert.equal(replay.payload.grant_sequence,1);assert.equal((await c.inspect({tenant_id:'tenant-alpha'})).payload.grant.sequence,1);
});
