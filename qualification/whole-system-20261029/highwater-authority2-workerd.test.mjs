/** Actual Miniflare ledger workerd with independent synthetic witness; NOT provider or separate-host acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {fixture} from './external-ledger-fixture.mjs';
import {githubFixture} from './github-anchor-fixture.mjs';
import {Authority2Highwater} from '../../integrations/security-authority2/authority2-highwater-worker.mjs';

const hex=c=>c.repeat(64);
const hash=s=>createHash('sha256').update(s).digest('hex');
async function witnessFixture(){
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const priv=await crypto.subtle.exportKey('jwk',keys.privateKey);
  const pub=await crypto.subtle.exportKey('jwk',keys.publicKey);
  const cfg={account_id:'67469478aa9349fa0a57fe3a72da200a',ledger_id:'fixture-ledger',namespace:'ax-authority2-isolated',key_id:'authority2-fixture'};
  const writeToken='w'.repeat(40),readToken='r'.repeat(40);
  let db=new Map(),queue=Promise.resolve();
  const storage={
    get:key=>Promise.resolve(db.get(key)),
    put:(key,value)=>{db.set(key,structuredClone(value));return Promise.resolve();},
    sync:async()=>{},
    transaction:async fn=>{let release;const next=new Promise(r=>release=r);const previous=queue;queue=next;await previous;try{return await fn(storage);}finally{release();}},
  };
  const tip0={...cfg,sequence:-1,head:hex('0')};
  await storage.put('highwater/tip',tip0);
  const server=new Authority2Highwater({storage},{
    HW_CONFIG_JSON:JSON.stringify(cfg),
    HW_SIGNING_JWK:JSON.stringify(priv),
    HW_ROLE_TOKEN_SHA256_JSON:JSON.stringify({write:hash(writeToken),read:hash(readToken)}),
  });
  return {
    pin:{...cfg,origin:'https://custody.example.com',public_key_jwk:{kty:'OKP',crv:'Ed25519',x:pub.x}},
    writeToken,readToken,
    fetchImpl:(req,init)=>server.fetch(typeof req==='string'?new Request(req,init):req),
    tip:()=>structuredClone(db.get('highwater/tip')),
    snapshot:()=>new Map([...db].map(([k,v])=>[k,structuredClone(v)])),
    restore:snapshot=>{db=new Map([...snapshot].map(([k,v])=>[k,structuredClone(v)]));},
  };
}

test('workerd: witness survives builder authority and checkpoint total restore and denies replay',{timeout:90000},async t=>{
  const anchor=githubFixture('ax-authority2-destructive'),witness=await witnessFixture();
  const f=await fixture(t,{persist:true,anchor,highwater:witness});
  await f.bootstrap();await f.grant();await f.snapshotStore();
  const client=await f.makeClient(),input=await f.prepare(client),first=await client.consume(input);
  assert.equal(first.payload.dispatch_allowed,true);
  assert.equal(first.payload.highwater.account_id,witness.pin.account_id);
  assert.equal(await client.verifyStored(input,first),true);
  const tip=witness.tip();assert.equal(tip.sequence,2);
  await f.restoreStore();anchor.wipeSyntheticProvider();
  const rebuilt=await f.makeClient();
  await assert.rejects(async()=>rebuilt.consume(await f.prepare(rebuilt)));
  assert.equal(witness.tip().sequence,2,'independent witness high-water never moved backward');
});

test('negative B27 workerd: rolling back witness AND all other snapshots reissues permit',{timeout:90000},async t=>{
  const anchor=githubFixture('ax-authority2-negative'),witness=await witnessFixture();
  const f=await fixture(t,{persist:true,anchor,highwater:witness});
  await f.bootstrap();await f.grant();await f.snapshotStore();
  const snapshot=witness.snapshot();
  const firstClient=await f.makeClient(),initial=await f.prepare(firstClient);
  const first=await firstClient.consume(initial);assert.equal(first.payload.dispatch_allowed,true);
  await f.restoreStore();anchor.wipeSyntheticProvider();witness.restore(snapshot);
  const rebuilt=await f.makeClient(),replay=await rebuilt.consume(await f.prepare(rebuilt));
  assert.equal(replay.payload.dispatch_allowed,true,'UNRESOLVED VULNERABILITY: full witness reset permits reissue');
  assert.equal(witness.tip().sequence,2);
});
