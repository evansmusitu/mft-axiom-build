/** Actual Miniflare ledger workerd with independent synthetic witness; NOT provider or separate-host acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {fixture} from './external-ledger-fixture.mjs';
import {githubFixture} from './github-anchor-fixture.mjs';
import {Authority2Highwater} from '../../integrations/security-authority2/authority2-highwater-worker.mjs';
import {wormKey} from '../../integrations/security-authority2/authority2-r2-worm.mjs';

const hex=c=>c.repeat(64);
const hash=s=>createHash('sha256').update(s).digest('hex');
async function witnessFixture(){
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const priv=await crypto.subtle.exportKey('jwk',keys.privateKey);
  const pub=await crypto.subtle.exportKey('jwk',keys.publicKey);
  const cfg={account_id:'67469478aa9349fa0a57fe3a72da200a',ledger_id:'fixture-ledger',namespace:'ax-authority2-isolated',key_id:'authority2-fixture'};
  const writeToken='w'.repeat(40),readToken='r'.repeat(40);
  let witnessOffline=false;
  let db=new Map(),queue=Promise.resolve();
  const storage={
    get:key=>Promise.resolve(db.get(key)),
    put:(key,value)=>{db.set(key,structuredClone(value));return Promise.resolve();},
    delete:key=>{db.delete(key);return Promise.resolve();},
    sync:async()=>{},
    transaction:async fn=>{let release;const next=new Promise(r=>release=r);const previous=queue;queue=next;await previous;try{return await fn(storage);}finally{release();}},
  };
  const tip0={...cfg,sequence:-1,head:hex('0')};
  await storage.put('highwater/tip',tip0);
  let r2objects=new Map();
  const r2={
    get:async key=>r2objects.has(key)?{size:Buffer.byteLength(r2objects.get(key)),text:async()=>r2objects.get(key)}:null,
    head:async key=>r2objects.has(key)?{key}:null,
    put:async(key,data,options)=>{
      if(options?.onlyIf?.get('if-none-match')!=='*')throw Error('synthetic R2 requires If-None-Match:*');
      if(r2objects.has(key))return null;
      r2objects.set(key,data);return {key};
    },
    snapshot:()=>new Map(r2objects),
    restore:snapshot=>{r2objects=new Map(snapshot);},
  };
  const server=new Authority2Highwater({storage},{
    HW_CONFIG_JSON:JSON.stringify(cfg),
    HW_SIGNING_JWK:JSON.stringify(priv),
    HW_ROLE_TOKEN_SHA256_JSON:JSON.stringify({write:hash(writeToken),read:hash(readToken)}),
    HIGHWATER_WORM:r2,
  });
  return {
    pin:{...cfg,origin:'https://custody.example.com',public_key_jwk:{kty:'OKP',crv:'Ed25519',x:pub.x}},
    writeToken,readToken,
    fetchImpl:(req,init)=>witnessOffline?Promise.reject(Error('synthetic independent witness offline')):server.fetch(typeof req==='string'?new Request(req,init):req),
    offline:()=>{witnessOffline=true;},
    tip:()=>structuredClone(db.get('highwater/tip')),
    r2,
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

test('workerd: rollback of witness DO still holds when R2 append-only checkpoints survive',{timeout:90000},async t=>{
  const anchor=githubFixture('ax-authority2-negative'),witness=await witnessFixture();
  const f=await fixture(t,{persist:true,anchor,highwater:witness});
  await f.bootstrap();await f.grant();await f.snapshotStore();
  const snapshot=witness.snapshot();
  const firstClient=await f.makeClient(),initial=await f.prepare(firstClient);
  const first=await firstClient.consume(initial);assert.equal(first.payload.dispatch_allowed,true);
  await f.restoreStore();anchor.wipeSyntheticProvider();witness.restore(snapshot);
  const rebuilt=await f.makeClient();
  await assert.rejects(async()=>rebuilt.consume(await f.prepare(rebuilt)),'R2 checkpoint must reject replay after witness SQLite restore');
  assert.equal(witness.tip().sequence,1,'restored SQLite must not be promoted');
});

test('negative B27 workerd: only deleting R2 history TOO permits full global rollback',{timeout:90000},async t=>{
  const anchor=githubFixture('ax-authority2-r2-negative'),witness=await witnessFixture();
  const f=await fixture(t,{persist:true,anchor,highwater:witness});
  await f.bootstrap();await f.grant();await f.snapshotStore();
  const snapshot=witness.snapshot(),r2Snapshot=witness.r2.snapshot();
  const original=await f.makeClient(),first=await original.consume(await f.prepare(original));
  assert.equal(first.payload.dispatch_allowed,true);
  await f.restoreStore();anchor.wipeSyntheticProvider();witness.restore(snapshot);witness.r2.restore(r2Snapshot);
  const rebuilt=await f.makeClient(),reissued=await rebuilt.consume(await f.prepare(rebuilt));
  assert.equal(reissued.payload.dispatch_allowed,true,'NEGATIVE: reversible R2 retention is not a globally irreversible witness');
});

test('B27: failed external witness preserves pending and blocks all later admissions',{timeout:90000},async t=>{
  const anchor=githubFixture('ax-authority2-witness-failure'),witness=await witnessFixture();
  const f=await fixture(t,{persist:true,anchor,highwater:witness});
  await f.bootstrap(); // success gives known checkpoint and genesis
  witness.offline();  // provider fails AFTER immutable GitHub checkpoint is published
  const first=await f.request('/v1/operator/grants',f.grantInput());
  assert.equal(first.status,503,'witness outage must never produce an ALLOW response');
  const second=await f.request('/v1/operator/grants',f.grantInput());
  const body=await second.json();
  assert.equal(second.status,503,'unresolved external CAS must block the entire authority');
  assert.equal(body.error,'ANCHOR_PENDING_RECONCILIATION_HOLD',
    'pending must survive witness failure; ledger must not commit or clear it early');
});
