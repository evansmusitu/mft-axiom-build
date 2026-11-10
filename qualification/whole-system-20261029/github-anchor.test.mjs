/** Real SQLite/workerd storage with a synthetic external API. Live evidence is separate. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture} from './external-ledger-fixture.mjs';
import {githubFixture} from './github-anchor-fixture.mjs';
import {bytes,b64} from '../../integrations/independent-ledger/protocol.mjs';
import {anchoredRestoreCase} from './anchored-restore-case.mjs';
import {anchorCredential,verifyGithubCheckpoint} from '../../integrations/independent-ledger/github-anchor.mjs';
import {forwardGithubRequest} from './github-anchor-forward.mjs';
import {createServer} from 'node:http';
const anchorFailure=e=>/ANCHOR_/.test(e.remote_code??e.code??e.message);
test('workerd-to-Node forwarding recomputes request framing and preserves the complete body',{timeout:5000},async t=>{
  const body=JSON.stringify({synthetic:true,challenge:'a'.repeat(64)}),server=createServer(async(req,res)=>{
    let received='';for await(const chunk of req)received+=chunk;res.setHeader('content-type','application/json');res.end(JSON.stringify({received,length:req.headers['content-length']}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request={url:'https://api.github.com/repos/fixture/qualification/releases',method:'POST',headers:new Headers({'content-length':'0','content-type':'application/json',connection:'close'}),text:async()=>body};
  const r=await forwardGithubRequest(request,{fetchImpl:(_url,init)=>fetch('http://127.0.0.1:'+server.address().port,init)}),reply=await r.response.json();
  assert.equal(reply.received,body);assert.equal(Number(reply.length),Buffer.byteLength(body));
});
test('opaque long installation bearer credentials are bounded without accepting header injection',()=>{
  assert.equal(anchorCredential('synthetic_'.repeat(120)).length,1200);
  for(const token of ['short','x'.repeat(8193),'x'.repeat(30)+'\r\nInjected: value','x'.repeat(30)+' space'])assert.throws(()=>anchorCredential(token),/ANCHOR_CREDENTIAL_REQUIRED/);
});
test('restoring BOTH real D1 and authority stores cannot call the runtime callback again',{timeout:30000},async t=>{
  const result=await anchoredRestoreCase(t,githubFixture());assert.equal(result.callbacks_after_restore,0);
});
test('external checkpoint survives destructive authority restore and holds all later transitions',{timeout:30000},async t=>{
  const anchor=githubFixture(),f=await fixture(t,{persist:true,anchor});await f.bootstrap();await f.grant();await f.snapshotStore();
  const client=await f.makeClient(),request=await f.prepare(client),first=await client.consume(request);assert.equal(first.payload.dispatch_allowed,true);assert.equal(await client.verifyStored(request,first),true);
  await f.restoreStore();const rebuilt=await f.makeClient();await assert.rejects(async()=>rebuilt.consume(await f.prepare(rebuilt)),anchorFailure);
  const calls=anchor.calls;
  await assert.rejects(()=>rebuilt.inspect({tenant_id:'tenant-alpha'}),e=>e.remote_code==='ANCHOR_PENDING_RECONCILIATION_HOLD');
  await f.restart();await assert.rejects(async()=>rebuilt.consume(await f.prepare(rebuilt,{slot:1})),e=>e.remote_code==='ANCHOR_PENDING_RECONCILIATION_HOLD');assert.equal(anchor.calls,calls);
});
for(const operation of ['revoke','epoch'])test('restoring before '+operation+' cannot resurrect authority',{timeout:30000},async t=>{
  const anchor=githubFixture(),f=await fixture(t,{persist:true,anchor});await f.bootstrap();await f.grant();await f.snapshotStore();
  const input=operation==='epoch'?{expected_epoch:1,challenge:'9'.repeat(64)}:{grant_id:'grant-one',tenant_id:'tenant-alpha',expected_epoch:1,challenge:'9'.repeat(64)};
  const response=await f.request('/v1/operator/'+operation,input,{role:'revoke'});assert.equal(response.status,200,await response.clone().text());
  await f.restoreStore();const client=await f.makeClient();await assert.rejects(async()=>client.consume(await f.prepare(client)),anchorFailure);
});
test('same anchor pin prevents genesis reset after total authority-store loss',{timeout:30000},async t=>{
  const anchor=githubFixture(),f=await fixture(t,{persist:true,anchor});await f.bootstrap();await f.grant();await f.loseStore();
  const r=await f.request('/v1/operator/bootstrap',{ledger_id:f.config.ledger_id,genesis_id:f.config.genesis_id,challenge:'a'.repeat(64)},{role:'bootstrap'});assert.equal(r.status,503);assert.equal((await r.json()).dispatch_allowed,false);
});
test('lost publication acknowledgement survives restart with no retry or dispatch',{timeout:30000},async t=>{
  const anchor=githubFixture(),f=await fixture(t,{persist:true,anchor});await f.bootstrap();await f.grant();anchor.dropNextPublish();
  const client=await f.makeClient();await assert.rejects(async()=>client.consume(await f.prepare(client)),anchorFailure);
  const used=[...anchor.releases.values()].filter(r=>r.immutable).length;assert.equal(used,3);
  const calls=anchor.calls;await f.restart();const rebuilt=await f.makeClient();await assert.rejects(async()=>rebuilt.consume(await f.prepare(rebuilt)),e=>e.remote_code==='ANCHOR_PENDING_RECONCILIATION_HOLD');assert.equal(anchor.calls,calls);
});
test('concurrent consumers produce exactly one independently verified checkpoint permit',{timeout:30000},async t=>{
  const anchor=githubFixture(),f=await fixture(t,{anchor});await f.bootstrap();await f.grant();
  const clients=await Promise.all(Array.from({length:6},()=>f.makeClient())),requests=await Promise.all(clients.map(c=>f.prepare(c)));
  const results=await Promise.allSettled(clients.map((c,i)=>c.consume(requests[i])));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal([...anchor.releases.values()].filter(r=>r.immutable).length,3);
});
test('pinned client refuses an authority downgrade even with a valid signature',{timeout:30000},async t=>{
  const anchor=githubFixture(),f=await fixture(t,{anchor});await f.bootstrap();await f.grant();
  const client=await f.makeClient({fetchImpl:async(url,init)=>{
    const response=await f.fetchImpl(url,init);if(response.status!==200)return response;const envelope=await response.json();delete envelope.payload.anchor;
    envelope.signature=b64(await crypto.subtle.sign('Ed25519',f.keys.privateKey,bytes(envelope.payload)));return new Response(JSON.stringify(envelope));
  }});
  await assert.rejects(async()=>client.consume(await f.prepare(client)),anchorFailure);
});
test('provider readback independently rejects substituted digest, mutable proof, target and partition',{timeout:30000},async t=>{
  const anchor=githubFixture(),f=await fixture(t,{anchor});await f.bootstrap();await f.grant();const client=await f.makeClient(),request=await f.prepare(client),envelope=await client.consume(request);
  const release=anchor.releases.get(envelope.payload.anchor.release_id),asset=release.assets[0],digest=asset.digest;
  asset.digest='sha256:'+'f'.repeat(64);await assert.rejects(()=>client.verifyStored(request,envelope),anchorFailure);asset.digest=digest;
  release.immutable=false;await assert.rejects(()=>client.verifyStored(request,envelope),anchorFailure);release.immutable=true;
  anchor.tags.set(release.tag_name,'f'.repeat(40));await assert.rejects(()=>client.verifyStored(request,envelope),anchorFailure);anchor.tags.set(release.tag_name,anchor.pin.target_commitish);
  anchor.partition();await assert.rejects(()=>client.verifyStored(request,envelope),anchorFailure);anchor.partition(false);
  assert.equal(await client.verifyStored(request,envelope),true);
});

test('repository identity cannot change between initial lookup and immutable checkpoint readback',{timeout:30000},async t=>{
  const anchor=githubFixture('ax-identity-rebind'),f=await fixture(t,{anchor});
  await f.bootstrap();await f.grant();
  const client=await f.makeClient(),request=await f.prepare(client),envelope=await client.consume(request);
  let identityReads=0;
  const fetchImpl=async(url,options)=>{
    if(new URL(url).pathname==='/repos/'+anchor.pin.repository && options?.method==='GET'){
      identityReads+=1;
      if(identityReads>1)return new Response(JSON.stringify({
        id:anchor.pin.repository_id+1,full_name:anchor.pin.repository,private:true,archived:false
      }),{status:200,headers:{'content-type':'application/json'}});
    }
    return anchor.fetchImpl(url,options);
  };
  await assert.rejects(
    verifyGithubCheckpoint({pin:anchor.pin,token:anchor.readToken,
      payload:envelope.payload,fetchImpl}),
    /ANCHOR_REPOSITORY_IDENTITY_CHANGED_HOLD/,
    'a replaced same-name repository must not be accepted after the first identity lookup');
  assert.equal(identityReads,2,'provider repo identity must be re-read after checkpoint proof');
});
