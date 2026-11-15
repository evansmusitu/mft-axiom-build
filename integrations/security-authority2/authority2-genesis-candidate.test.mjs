/** Synthetic boundaries, not provider, operator or independent-review evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {Authority2Highwater} from './authority2-highwater-worker.mjs';
import {externalHighwaterFence} from './external-highwater-fence.mjs';
import {wormKey} from './authority2-r2-worm.mjs';
import {canonicalJson,sha256Json} from '../independent-ledger/protocol.mjs';
import {publishGithubCheckpoint} from '../independent-ledger/github-anchor.mjs';
import {githubFixture} from '../../qualification/whole-system-20261029/github-anchor-fixture.mjs';
import {provisionAuthority2Genesis,genesisBarrierKey} from './authority2-genesis-candidate.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hash=x=>createHash('sha256').update(x).digest('hex');
const BUNDLE='d1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210';

async function fixture(){
  const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
  const pin={account_id:'67469478aa9349fa0a57fe3a72da200a',
    ledger_id:'synthetic-genesis-ledger',namespace:'ax-synthetic-genesis',
    key_id:'synthetic-test-key',public_key_jwk:{kty:'OKP',crv:'Ed25519',x:privateJwk.x}};
  const commitment={schema:'musitu.axiom.authority2.pre-genesis-commitment.v1',
    ledger_sequence:0,kind:'AUTHORITY2_PREGENESIS',...pin,
    reviewed_bundle_sha256:BUNDLE,genesis_nonce:'a'.repeat(64),
    initial_sequence:-1,initial_head:'0'.repeat(64)};
  const github=githubFixture('ax-genesis-anchor-synthetic');
  const proof=await publishGithubCheckpoint({pin:github.pin,token:github.token,
    payload:commitment,fetchImpl:github.fetchImpl});
  let values=new Map(),alarm=null,queue=Promise.resolve();
  const counters={syncs:0,puts:0,transactions:0};
  const storage={
    sql:{exec(){throw Error('synthetic SQL not executed');}},
    get:async key=>structuredClone(values.get(key)),
    put:async(key,value)=>{values.set(key,structuredClone(value));},
    delete:async key=>values.delete(key),getAlarm:async()=>alarm,
    list:async({limit})=>new Map([...values].sort().slice(0,limit)),
    sync:async()=>{counters.syncs++;},
    transaction:async fn=>{
      let release;const next=new Promise(r=>release=r),previous=queue;queue=next;
      await previous;counters.transactions++;
      const staged=structuredClone(values);
      // The real transaction handle has no getAlarm method.
      const txn={get:async k=>structuredClone(staged.get(k)),
        put:async(k,v)=>{staged.set(k,structuredClone(v));},
        delete:async k=>staged.delete(k),
        list:async({limit})=>new Map([...staged].sort().slice(0,limit))};
      try{const result=await fn(txn);values=staged;return result;}
      finally{release();}
    }
  };
  const objects=new Map();
  const bucket={
    list:async({prefix,limit})=>{
      const keys=[...objects.keys()].filter(k=>k.startsWith(prefix)).sort();
      return {objects:keys.slice(0,limit).map(key=>({key})),truncated:keys.length>limit};
    },
    head:async key=>objects.has(key)?{key}:null,
    get:async key=>objects.has(key)?{size:Buffer.byteLength(objects.get(key)),
      text:async()=>objects.get(key)}:null,
    put:async(key,body,options)=>{
      counters.puts++;
      assert.equal(options.onlyIf.get('if-none-match'),'*');
      assert.ok(await storage.get('highwater/pending'),'DO pending persists before R2');
      assert.equal(await storage.get('highwater/tip'),undefined);
      assert.equal(counters.syncs,1,'pending is synced before irreversible write');
      if(objects.has(key))return null;
      objects.set(key,body);return {key};
    }
  };
  const getCalls=[];
  const options={storage,bucket,pin,anchor_pin:github.pin,commitment,
    anchor_proof:proof,expected_commitment_sha256:await sha256Json(commitment),
    anchor_read_token:github.readToken,
    fetchImpl:async(url,init)=>{getCalls.push(init.method);return github.fetchImpl(url,init);}};
  const run=changes=>provisionAuthority2Genesis({...options,...changes});
  return {options,run,pin,commitment,proof,github,storage,bucket,counters,objects,getCalls,
    privateJwk,setAlarm:value=>{alarm=value;},wipeDO:()=>{values=new Map();}};
}

test('candidate creates one externally bound pre-genesis, then serving runtime appends real sequence zero',async()=>{
  const f=await fixture(),result=await f.run();
  assert.equal(result.dispatch_allowed,false);assert.equal(result.release_status,'NOT_RELEASE');
  assert.equal(f.counters.puts,1);assert.equal(f.counters.syncs,2);
  assert.equal(await f.storage.get('highwater/pending'),undefined);
  assert.equal((await f.storage.get('highwater/tip')).sequence,-1);
  assert.deepEqual(new Set(f.getCalls),new Set(['GET']),'genesis never publishes GitHub state');
  const config={...f.pin};
  const env={HW_CONFIG_JSON:JSON.stringify(config),HIGHWATER_WORM:f.bucket,
    HW_SIGNING_JWK:JSON.stringify(f.privateJwk),
    HW_ROLE_TOKEN_SHA256_JSON:JSON.stringify({read:hash('r'.repeat(40)),write:hash('w'.repeat(40))})};
  // Ordinary appends have their own syncs and tip. Retain the actual
  // conditional-write semantics while discarding genesis-only assertions.
  f.bucket.put=async(key,body,opts)=>{
    assert.equal(opts.onlyIf.get('if-none-match'),'*');
    if(f.objects.has(key))return null;f.objects.set(key,body);return {key};};
  const server=new Authority2Highwater({storage:f.storage},env);
  const receipt=await externalHighwaterFence({pin:{...f.pin,origin:'https://synthetic.invalid'},
    event:{ledger_id:f.pin.ledger_id,namespace:f.pin.namespace,sequence:0,
      previous_sequence:-1,previous_head:'0'.repeat(64),head:'b'.repeat(64),
      event_digest:'c'.repeat(64),artifact_sha256:'d'.repeat(64),action_sha256:'e'.repeat(64)},
    write_token:'w'.repeat(40),read_token:'r'.repeat(40),
    fetchImpl:(url,init)=>server.fetch(new Request(url,init))});
  assert.equal(receipt.sequence,0);
  assert.equal((await f.storage.get('highwater/tip')).sequence,0);
});

test('candidate rejects modified commitment, hash, key, runtime or identity before storage writes',async t=>{
  for(const label of ['approved-hash','nonce','private-key','bundle','account','namespace','extra-field']){
    await t.test(label,async()=>{
      const f=await fixture(),options={...f.options,commitment:structuredClone(f.commitment)};
      if(label==='approved-hash')options.expected_commitment_sha256='f'.repeat(64);
      if(label==='nonce')options.commitment.genesis_nonce='1'.repeat(64);
      if(label==='private-key')options.commitment.public_key_jwk.d=f.privateJwk.d;
      if(label==='bundle')options.commitment.reviewed_bundle_sha256='f'.repeat(64);
      if(label==='account')options.commitment.account_id='f'.repeat(32);
      if(label==='namespace')options.commitment.namespace='ax-swapped';
      if(label==='extra-field')options.commitment.reset=true;
      if(label!=='approved-hash'&&label!=='nonce')options.expected_commitment_sha256=await sha256Json(options.commitment);
      await assert.rejects(provisionAuthority2Genesis(options));
      assert.equal(f.counters.transactions,0);assert.equal(f.counters.puts,0);
    });
  }
});

test('candidate requires live immutable proof, original private repo and valid read credential',async t=>{
  for(const label of ['mutable','deleted','recreated','wrong-target','wrong-proof','missing-token']){
    await t.test(label,async()=>{
      const f=await fixture(),options={...f.options};
      if(label==='mutable')f.github.releases.get(f.proof.release_id).immutable=false;
      if(label==='deleted')f.github.simulateAdminReleaseDeletion();
      if(label==='recreated')f.github.simulateRepositoryResurrection();
      if(label==='wrong-target')f.github.tags.set(f.proof.tag,'c'.repeat(40));
      if(label==='wrong-proof')options.anchor_proof={...f.proof,asset_digest:'sha256:'+'f'.repeat(64)};
      if(label==='missing-token')options.anchor_read_token=undefined;
      await assert.rejects(provisionAuthority2Genesis(options));
      assert.equal(f.counters.transactions,0);assert.equal(f.counters.puts,0);
    });
  }
});

test('candidate refuses any prior DO state or alarm instead of resetting it',async t=>{
  for(const label of ['tip','pending','unknown','alarm'])await t.test(label,async()=>{
    const f=await fixture();
    if(label==='alarm')f.setAlarm(Date.now()+60000);
    else await f.storage.put(label==='unknown'?'other/key':'highwater/'+label,{sentinel:true});
    await assert.rejects(f.run(),/EXISTING_DO_STATE_HOLD/);
    assert.equal(f.counters.puts,0);assert.equal(f.counters.syncs,0);
  });
});

test('candidate refuses any existing R2 namespace history and keeps pending',async t=>{
  for(const label of ['barrier','sequence-zero','orphan-later','other'])await t.test(label,async()=>{
    const f=await fixture();
    const key=label==='barrier'?genesisBarrierKey(f.pin):label==='sequence-zero'?wormKey(f.pin,0):
      label==='orphan-later'?wormKey(f.pin,7):genesisBarrierKey(f.pin).replace('genesis.json','unknown');
    f.objects.set(key,'retained');
    await assert.rejects(f.run(),/EXISTING_R2_HISTORY_HOLD/);
    assert.equal(f.counters.puts,0);assert.ok(await f.storage.get('highwater/pending'));
    assert.equal(await f.storage.get('highwater/tip'),undefined);
  });
});

test('candidate serializes twelve concurrent initializers into exactly one conditional write',async()=>{
  const f=await fixture(),outcomes=await Promise.allSettled(Array.from({length:12},()=>f.run()));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.counters.puts,1);assert.equal(f.objects.size,1);
});

test('candidate rejects second invocation and restored empty DO when R2 barrier survives',async()=>{
  const f=await fixture();await f.run();
  await assert.rejects(f.run(),/EXISTING_DO_STATE_HOLD/);
  f.wipeDO();await assert.rejects(f.run(),/EXISTING_R2_HISTORY_HOLD/);
  assert.equal(f.counters.puts,1);assert.equal(await f.storage.get('highwater/tip'),undefined);
});

test('candidate retains pending forever after lost R2 acknowledgement, even with readable barrier',async()=>{
  const f=await fixture(),put=f.bucket.put;
  f.bucket.put=async(...args)=>{await put(...args);throw Error('synthetic lost ACK');};
  await assert.rejects(f.run(),/lost ACK/);assert.equal(f.objects.size,1);
  await assert.rejects(f.run(),/EXISTING_DO_STATE_HOLD/);
  assert.equal(f.counters.puts,1);assert.ok(await f.storage.get('highwater/pending'));
  assert.equal(await f.storage.get('highwater/tip'),undefined);
});

test('candidate times out ambiguous PUT and late completion cannot promote DO state',{timeout:7000},async()=>{
  const f=await fixture(),put=f.bucket.put;let complete;
  f.bucket.put=(...args)=>new Promise(resolve=>{complete=async()=>resolve(await put(...args));});
  await assert.rejects(f.run(),/R2_AMBIGUOUS_HOLD/);
  assert.ok(await f.storage.get('highwater/pending'));
  await complete();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.objects.size,1);assert.equal(await f.storage.get('highwater/tip'),undefined);
  await assert.rejects(f.run(),/EXISTING_DO_STATE_HOLD/);assert.equal(f.counters.puts,1);
});

test('candidate holds on unconfirmed or changed R2 readback and new history',async t=>{
  for(const label of ['unconfirmed','readback','new-history','truncated'])await t.test(label,async()=>{
    const f=await fixture(),put=f.bucket.put;
    if(label==='unconfirmed')f.bucket.put=async(...args)=>{await put(...args);return null;};
    if(label==='readback')f.bucket.get=async()=>({size:1,text:async()=>'?'});
    if(label==='new-history')f.bucket.put=async(...args)=>{const r=await put(...args);f.objects.set(wormKey(f.pin,0),'unexpected');return r;};
    if(label==='truncated')f.bucket.list=async()=>({objects:[],truncated:true});
    await assert.rejects(f.run());
    assert.ok(await f.storage.get('highwater/pending'));assert.equal(await f.storage.get('highwater/tip'),undefined);
  });
});

test('candidate rechecks immutable provider identity after R2 commit before promoting tip',async()=>{
  const f=await fixture(),put=f.bucket.put;
  f.bucket.put=async(...args)=>{const r=await put(...args);f.github.simulateRepositoryResurrection();return r;};
  await assert.rejects(f.run(),/ANCHOR_REPOSITORY_IDENTITY_CHANGED_HOLD/);
  assert.equal(f.objects.size,1);assert.ok(await f.storage.get('highwater/pending'));
  assert.equal(await f.storage.get('highwater/tip'),undefined);
});

test('candidate does not write R2 if durable pending synchronization fails',async()=>{
  const f=await fixture();f.storage.sync=async()=>{throw Error('synthetic sync failure');};
  await assert.rejects(f.run(),/sync failure/);
  assert.equal(f.counters.puts,0);assert.ok(await f.storage.get('highwater/pending'));
});

test('candidate detects modified pending before promotion and never retries R2',async()=>{
  const f=await fixture(),put=f.bucket.put;
  f.bucket.put=async(...args)=>{const r=await put(...args);await f.storage.put('other/key','raced');return r;};
  await assert.rejects(f.run(),/PENDING_CHANGED_HOLD/);
  assert.equal(f.counters.puts,1);assert.equal(await f.storage.get('highwater/tip'),undefined);
});

test('serving Worker still exposes neither genesis nor reset routes',async()=>{
  const f=await fixture(),env={HW_CONFIG_JSON:JSON.stringify(f.pin),HIGHWATER_WORM:f.bucket};
  const server=new Authority2Highwater({storage:f.storage},env);
  for(const path of ['/v1/highwater/genesis','/v1/highwater/reset','/v1/operator/bootstrap']){
    const r=await server.fetch(new Request('https://synthetic.invalid'+path,{method:'POST'}));
    assert.equal(r.status,404);
  }
  assert.equal(f.counters.transactions,0);assert.equal(f.counters.puts,0);
});

test('negative candidate: restoring BOTH DO and R2 can re-provision; global custody veto remains necessary',async()=>{
  const f=await fixture();await f.run();f.wipeDO();f.objects.clear();
  // A test-only all-administrator reset, not an operator instruction.
  const first=f.counters.syncs;f.counters.syncs=0;
  const result=await f.run();
  assert.equal(result.dispatch_allowed,false);assert.equal(first,2);
  assert.equal(f.counters.puts,2,'candidate alone does not establish global nonrollback');
});
