import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {Authority2Highwater} from './authority2-highwater-worker.mjs';
import {wormKey} from './authority2-r2-worm.mjs';
import {externalHighwaterFence,verifyExternalHighwaterReceipt} from './external-highwater-fence.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const PIN={account_id:'67469478aa9349fa0a57fe3a72da200a',ledger_id:'test-ledger',namespace:'ax-security-authority2',key_id:'operator-key'};
const sha=c=>c.repeat(64);
async function setup(){const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']), jwk=await crypto.subtle.exportKey('jwk',keys.privateKey),publicJwk={kty:'OKP',crv:'Ed25519',x:jwk.x};
  let values=new Map();let queue=Promise.resolve();const storage={get:k=>Promise.resolve(values.get(k)),put:(k,v)=>{values.set(k,v);return Promise.resolve();},delete:k=>{values.delete(k);return Promise.resolve();},sync:async()=>{},transaction:async fn=>{let release;const next=new Promise(res=>release=res);const prev=queue;queue=next;await prev;try{return await fn(storage)}finally{release()}}};
  let r2objects=new Map();let failAck=false;
  const r2={
    get:async key=>r2objects.has(key)?{size:Buffer.byteLength(r2objects.get(key)),text:async()=>r2objects.get(key)}:null,
    head:async key=>r2objects.has(key)?{key}:null,
    put:async(key,body,options)=>{if(!options?.onlyIf?.get('if-none-match')||options.onlyIf.get('if-none-match')!=='*')throw Error('conditional R2 PUT required');if(r2objects.has(key))return null;r2objects.set(key,body);if(failAck){failAck=false;throw Error('lost provider ACK')}return {key};},
    snapshot:()=>new Map(r2objects),restore:snapshot=>{r2objects=new Map(snapshot)},
    loseNextAck:()=>{failAck=true},
    seedZero:()=>{const record={schema:'musitu.axiom.external-highwater.v1',...PIN,sequence:0,head:sha('0')};r2objects.set(wormKey(PIN,0),canonical(record));},
  };
  const env={HW_CONFIG_JSON:JSON.stringify(PIN),HW_SIGNING_JWK:JSON.stringify(jwk),HW_ROLE_TOKEN_SHA256_JSON:JSON.stringify({read:hash('r'.repeat(40)),write:hash('w'.repeat(40))}),HIGHWATER_WORM:r2};
  const server=new Authority2Highwater({storage},env),root='https://custody.example.com';
  const fetchImpl=(url,init)=>server.fetch(new Request(url,init));
  const pin={...PIN,origin:root,public_key_jwk:publicJwk};
  const event={ledger_id:PIN.ledger_id,namespace:PIN.namespace,sequence:1,previous_sequence:0,previous_head:sha('0'),head:sha('1'),event_digest:sha('2'),artifact_sha256:sha('3'),action_sha256:sha('4')};
  const args={pin,event,write_token:'w'.repeat(40),read_token:'r'.repeat(40),fetchImpl};
  const seed=async()=>{await storage.put('highwater/tip',{...PIN,sequence:0,head:sha('0')});r2.seedZero()};
  return {args,storage,seed,server,values,reset:()=>{values=new Map()},restore:snapshot=>{values=new Map(snapshot)},snapshot:()=>new Map(values),r2,root};
}
test('service denies unauthenticated and unprovisioned authority',async()=>{const x=await setup();const noauth=await x.server.fetch(new Request(x.root+'/v1/highwater/readback',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));assert.equal(noauth.status,401);await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_REMOTE_DENIAL_HOLD/);});
test('valid independent seeded CAS issues single signed receipt',async()=>{const x=await setup();await x.seed();const p=await externalHighwaterFence(x.args);assert.equal(p.sequence,1);assert.equal((await x.storage.get('highwater/tip')).sequence,1);});
test('replay after builder-only restore denied while authority retains tip',async()=>{const x=await setup();await x.seed();await externalHighwaterFence(x.args);await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_REMOTE_DENIAL_HOLD/);});
test('different caller role not accepted for write',async()=>{const x=await setup();await x.seed();await assert.rejects(externalHighwaterFence({...x.args,write_token:'z'.repeat(40)}),/HIGHWATER_REMOTE_DENIAL_HOLD/);});
test('eight simultaneous writers obtain exactly one CAS',async()=>{const x=await setup();await x.seed();const rs=await Promise.allSettled(Array.from({length:8},()=>externalHighwaterFence(x.args)));assert.equal(rs.filter(q=>q.status==='fulfilled').length,1);});
test('missing state after deletion holds without self-reinitializing',async()=>{const x=await setup();await x.seed();await externalHighwaterFence(x.args);x.reset();await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_REMOTE_DENIAL_HOLD/);});
test('R2 continuity survives witness DO snapshot restore and blocks reissue',async()=>{const x=await setup();await x.seed();const snapshot=x.snapshot();await externalHighwaterFence(x.args);x.restore(snapshot);await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_REMOTE_DENIAL_HOLD/);});

test('sequence-zero external genesis commitment requires explicitly preseeded -1 tip',async()=>{
  const x=await setup();
  await x.storage.put('highwater/tip',{...PIN,sequence:-1,head:sha('0')});
  const p=await externalHighwaterFence({...x.args,event:{...x.args.event,sequence:0,previous_sequence:-1}});
  assert.equal(p.sequence,0);
});

test('customer client independently checks witness signature, ledger digest and FRESH readback',async()=>{
  const x=await setup();await x.seed();
  const base={schema:'synthetic-ledger',ledger_sequence:1,chain_sha256:sha('1'),anchor:{tag:'synthetic-only'}};
  const event={...x.args.event,event_digest:hash(canonical(base))};
  const witness=await externalHighwaterFence({...x.args,event});
  const ledger={...base,highwater:witness};
  assert.equal(await verifyExternalHighwaterReceipt({pin:x.args.pin,ledger_payload:ledger,expected_artifact_sha256:x.args.event.artifact_sha256,read_token:x.args.read_token,fetchImpl:x.args.fetchImpl}),true);
  await assert.rejects(
    verifyExternalHighwaterReceipt({pin:x.args.pin,ledger_payload:ledger,
      expected_artifact_sha256:'f'.repeat(64),read_token:x.args.read_token,
      fetchImpl:x.args.fetchImpl}),
    /HIGHWATER_COMMIT_ARTIFACT_MISMATCH_HOLD/);

  await assert.rejects(verifyExternalHighwaterReceipt({pin:x.args.pin,ledger_payload:{...ledger,anchor:{tag:'swapped'}},expected_artifact_sha256:x.args.event.artifact_sha256,read_token:x.args.read_token,fetchImpl:x.args.fetchImpl}),/HIGHWATER_COMMIT_LEDGER_DIGEST_MISMATCH_HOLD/);
});

test('negative B27: restoring DO, independent R2 checkpoints AND controls reissues a permit',async()=>{
  const x=await setup();await x.seed();const doSnapshot=x.snapshot(),r2Snapshot=x.r2.snapshot();
  await externalHighwaterFence(x.args);x.restore(doSnapshot);x.r2.restore(r2Snapshot);
  const replay=await externalHighwaterFence(x.args);assert.equal(replay.sequence,1,'R2 lock deletion + all-state rollback is still an attack');
});
test('lost R2 acknowledgement holds pending transaction permanently; no retry',async()=>{
  const x=await setup();await x.seed();x.r2.loseNextAck();
  await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_REMOTE_DENIAL_HOLD/);
  await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_REMOTE_DENIAL_HOLD/);
});

test('B27: highwater authority rejects unbounded streaming body without Content-Length',async()=>{
  const x=await setup();await x.seed();
  let cancelled=false;
  const stream=new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(5000).fill(65));},
    cancel(){cancelled=true;}
  });
  const req=new Request(x.root+'/v1/highwater/readback',{
    method:'POST',duplex:'half',
    headers:{authorization:'Bearer '+'r'.repeat(40),'content-type':'application/json'},
    body:stream
  });
  assert.equal(req.headers.get('content-length'),null);
  const outcome=await Promise.race([
    x.server.fetch(req).then(r=>({status:r.status})),
    new Promise(resolve=>setTimeout(()=>resolve({status:'UNBOUNDED_READ'}),850))
  ]);
  assert.equal(outcome.status,413,'stream must be rejected at 4096 bytes, not awaited');
  assert.equal(cancelled,true,'request stream must be cancelled on input overflow');
});


test('B27: incomplete authenticated stream times out with explicit HOLD',async()=>{
  const x=await setup();await x.seed();
  let cancelled=false;
  const stream=new ReadableStream({
    start(controller){controller.enqueue(new TextEncoder().encode('{"schema":'));},
    cancel(){cancelled=true;}
  });
  const req=new Request(x.root+'/v1/highwater/readback',{
    method:'POST',duplex:'half',
    headers:{authorization:'Bearer '+'r'.repeat(40),'content-type':'application/json'},body:stream
  });
  const outcome=await Promise.race([
    x.server.fetch(req).then(async r=>({status:r.status,payload:await r.json()})),
    new Promise(resolve=>setTimeout(()=>resolve({status:'UNBOUNDED_BODY'}),2950))
  ]);
  assert.equal(outcome.status,503,'incomplete stream must HOLD before consumer timeout');
  assert.equal(outcome.payload.error,'HIGHWATER_BODY_TIMEOUT_HOLD');
  assert.equal(outcome.payload.dispatch_allowed,false);
  assert.equal(cancelled,true,'timed-out input must be cancelled');
});


test('B27: unresponsive R2 append must HOLD with pending, never retry or sign',async()=>{
  const x=await setup();await x.seed();
  x.r2.put=async()=>new Promise(()=>{}); // provider never acknowledges conditional write
  const event={...x.args.event,schema:'musitu.axiom.external-highwater.v1',
    account_id:PIN.account_id,key_id:PIN.key_id,challenge:sha('c')};
  const request=()=>new Request(x.root+'/v1/highwater/append',{
    method:'POST',headers:{authorization:'Bearer '+'w'.repeat(40),
      'content-type':'application/json'},body:canonical(event)
  });
  const result=await Promise.race([
    x.server.fetch(request()).then(async r=>({status:r.status,data:await r.json()})),
    new Promise(resolve=>setTimeout(()=>resolve({status:'R2_UNBOUNDED'}),4100))
  ]);
  assert.equal(result.status,503,'unacknowledged R2 append must reach finite HOLD');
  assert.equal(result.data.error,'HIGHWATER_WORM_TIMEOUT_HOLD');
  assert.ok(await x.storage.get('highwater/pending'),'uncertain append must remain pending');
  const next=await x.server.fetch(request());
  assert.equal(next.status,503,'second attempt must not retry pending R2 PUT');
  assert.equal((await next.json()).error,'HIGHWATER_PENDING_RECONCILIATION_HOLD');
});
