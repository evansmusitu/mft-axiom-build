import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import temporary,{Authority2Highwater,executePrivateGenesisSchedule} from './authority2-private-genesis-controller.mjs';
import {controllerFixture} from '../../qualification/whole-system-20261029/authority2-private-genesis-fixture.mjs';
const path='/__private_operator/genesis-once';
function fakeNamespace(f,result=f.result){
  const calls=[];
  f.env.HIGHWATER_STATE={idFromName(name){calls.push({name});return name;},
    get(id){calls.push({id});return {fetch:async request=>{calls.push({request});return Response.json(result);}};}};
  return calls;
}
test('temporary Worker rejects all public HTTP ingress even with correct operator credentials',async()=>{
  const f=await controllerFixture();const calls=fakeNamespace(f);
  for(const method of ['GET','POST','PUT','DELETE'])for(const p of ['/',path,'/v1/highwater/append']){
    const r=await temporary.fetch(new Request('https://private.invalid'+p,{
      method,headers:{authorization:'Bearer '+f.env.HW_GENESIS_CONTROL_TOKEN}}),f.env);
    assert.equal(r.status,404);assert.equal((await r.json()).dispatch_allowed,false);
  }
  assert.deepEqual(calls,[]);
});
test('private scheduled controller verifies actual signer and forwards one narrowly scoped internal request',async()=>{
  const f=await controllerFixture(),calls=fakeNamespace(f);
  const result=await executePrivateGenesisSchedule(f.controller,f.env);
  assert.equal(result.dispatch_allowed,false);assert.equal(f.noRetry,1);
  assert.equal(calls.length,3);assert.equal(calls[0].name,'highwater/'+f.pin.ledger_id+'/'+f.pin.namespace);
  const r=calls[2].request;assert.equal(new URL(r.url).pathname,path);assert.equal(r.method,'POST');
  assert.deepEqual(await r.json(),{commitment_sha256:f.approved.expected_commitment_sha256});
});
test('private controller rejects missing, expired, unapproved or oversized schedule window before DO access',async t=>{
  for(const label of ['expired','future','long-window','wrong-cron','old-event','missing-context','extra-field'])
    await t.test(label,async()=>{
      const f=await controllerFixture(),calls=fakeNamespace(f),a=structuredClone(f.approved),c={...f.controller};
      if(label==='expired'){a.not_before_ms=1;a.not_after_ms=2;}
      if(label==='future'){a.not_before_ms=Date.now()+100000;a.not_after_ms=a.not_before_ms+1000;}
      if(label==='long-window')a.not_after_ms=a.not_before_ms+900001;
      if(label==='wrong-cron')c.cron='0 0 * * *';
      if(label==='old-event')c.scheduledTime=1;
      if(label==='missing-context')delete c.noRetry;
      if(label==='extra-field')a.release_approved=true;
      f.env.HW_GENESIS_CONTROL_JSON=JSON.stringify(a);
      await assert.rejects(executePrivateGenesisSchedule(c,f.env));assert.deepEqual(calls,[]);
    });
});
test('private controller rejects unusable signing key, swapped key and shared roles before DO access',async t=>{
  for(const label of ['no-key','swapped-public','wrong-private','same-roles','no-control-token','wrong-account'])
    await t.test(label,async()=>{
      const f=await controllerFixture(),calls=fakeNamespace(f);
      if(label==='no-key')delete f.env.HW_SIGNING_JWK;
      if(label==='swapped-public')f.env.HW_SIGNING_JWK=JSON.stringify({...f.jwk,x:'a'.repeat(43)});
      if(label==='wrong-private')f.env.HW_SIGNING_JWK=JSON.stringify({...f.jwk,d:'a'.repeat(43)});
      if(label==='same-roles')f.env.HW_ROLE_TOKEN_SHA256_JSON=JSON.stringify({read:'a'.repeat(64),write:'a'.repeat(64)});
      if(label==='no-control-token')delete f.env.HW_GENESIS_CONTROL_TOKEN;
      if(label==='wrong-account')f.env.HW_CONFIG_JSON=JSON.stringify({...f.pin,account_id:'f'.repeat(32)});
      await assert.rejects(executePrivateGenesisSchedule(f.controller,f.env));assert.deepEqual(calls,[]);
    });
});
test('private DO denies unauthorized, browser, malformed and oversized input without touching storage',async t=>{
  for(const label of ['no-auth','wrong-token','origin','malformed','oversized','noncanonical','wrong-commitment'])
    await t.test(label,async()=>{
      const f=await controllerFixture();let writes=0;
      const server=new Authority2Highwater({storage:new Proxy({},{get(){writes++;throw Error('storage must not be reached');}})},f.env);
      const headers={authorization:'Bearer '+f.env.HW_GENESIS_CONTROL_TOKEN,'content-type':'application/json'};
      let body=JSON.stringify({commitment_sha256:f.approved.expected_commitment_sha256});
      if(label==='no-auth')delete headers.authorization;
      if(label==='wrong-token')headers.authorization='Bearer '+'x'.repeat(40);
      if(label==='origin')headers.origin='https://untrusted.invalid';
      if(label==='malformed')body='{';
      if(label==='oversized')body='a'.repeat(300);
      if(label==='noncanonical')body=' '+body;
      if(label==='wrong-commitment')body=JSON.stringify({commitment_sha256:'e'.repeat(64)});
      const r=await server.fetch(new Request('https://internal.invalid'+path,{method:'POST',headers,body}));
      assert.equal(r.status,503);assert.equal((await r.json()).dispatch_allowed,false);assert.equal(writes,0);
    });
});
test('private controller rejects a forged acknowledgement instead of issuing an approval',async t=>{
  for(const field of ['schema','status','initial_sequence','barrier_key','commitment_sha256','dispatch_allowed','release_status'])
    await t.test(field,async()=>{
      const f=await controllerFixture(),forged={...f.result,[field]:field==='dispatch_allowed'?true:'forged'};
      fakeNamespace(f,forged);await assert.rejects(executePrivateGenesisSchedule(f.controller,f.env));
    });
});
test('private controller review config pins the account/bucket and keeps public URLs and cron disabled',()=>{
  const config=readFileSync(new URL('./wrangler.private-genesis-review.toml',import.meta.url),'utf8');
  assert.match(config,/^workers_dev = false$/m);assert.match(config,/^preview_urls = false$/m);
  assert.match(config,/^crons = \[\]$/m);assert.doesNotMatch(config,/^\s*(?:route|routes)\s*=/m);
  assert.match(config,/67469478aa9349fa0a57fe3a72da200a/);assert.match(config,/musitu-axiom-b27-highwater-a2/);
});
