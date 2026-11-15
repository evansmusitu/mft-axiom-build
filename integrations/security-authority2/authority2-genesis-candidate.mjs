/** Review-only one-shot pre-genesis protocol. NOT imported by the serving Worker.
 * No HTTP handler, reset, retry, signer creation, GitHub publication or deployment.
 * A separately reviewed operator controller must supply the actual DO storage,
 * R2 binding and independently approved public commitment. This is not custody
 * evidence and cannot prevent an administrator restoring every authority.
 */
import {canonicalJson,sha256Json,exact,publicKey} from '../independent-ledger/protocol.mjs';
import {anchorPin,verifyGithubCheckpoint} from '../independent-ledger/github-anchor.mjs';
import {wormKey} from './authority2-r2-worm.mjs';

const ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
const BUNDLE='d1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210';
const SCHEMA='musitu.axiom.authority2.pre-genesis-commitment.v1';
const H64=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/;
const PIN_KEYS=['account_id','ledger_id','namespace','key_id','public_key_jwk'];
const COMMITMENT_KEYS=['schema','ledger_sequence','kind',...PIN_KEYS,
  'reviewed_bundle_sha256','genesis_nonce','initial_sequence','initial_head'];
const encoder=new TextEncoder();

export class GenesisHold extends Error {
  constructor(code){super(code);this.name='GenesisHold';this.code=code;}
}
const hold=code=>{throw new GenesisHold(code);};
function validatedPin(value){
  exact(value,PIN_KEYS,'GENESIS_PIN');
  publicKey(value.public_key_jwk);
  if(value.account_id!==ACCOUNT||typeof value.ledger_id!=='string'||
     typeof value.key_id!=='string'||typeof value.namespace!=='string'||
     !ID.test(value.ledger_id)||!ID.test(value.key_id)||
     !/^ax-[a-z0-9-]{1,60}$/.test(value.namespace))hold('A2_GENESIS_IDENTITY_HOLD');
  // Validate the same deterministic R2 namespace as the serving runtime.
  wormKey(value,0);
  return value;
}
function requireStorage(storage){
  if(!storage||typeof storage.sql?.exec!=='function'||
     ['get','put','delete','list','getAlarm','transaction','sync'].some(
    name=>typeof storage[name]!=='function'))hold('A2_GENESIS_STORAGE_BINDING_HOLD');
}
function requireBucket(bucket){
  if(!bucket||['get','head','put','list'].some(
    name=>typeof bucket[name]!=='function'))hold('A2_GENESIS_R2_BINDING_HOLD');
}
async function boundedR2(operation){
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(
    ()=>reject(new GenesisHold('A2_GENESIS_R2_AMBIGUOUS_HOLD')),3000);});
  try{return await Promise.race([operation(),deadline]);}
  finally{clearTimeout(timer);}
}
async function emptyStorage(storage,alarmStorage){
  const values=await storage.list({limit:1});
  if(!(values instanceof Map)||values.size!==0||await alarmStorage.getAlarm()!==null)
    hold('A2_GENESIS_EXISTING_DO_STATE_HOLD');
}
function prefixFor(pin){return wormKey(pin,0).replace(/000000000000\.json$/,'');}
export function genesisBarrierKey(pin){return prefixFor(validatedPin(pin))+'genesis.json';}

/** The hash pin is approved out of band, not derived from untrusted input here.
 * Rejected or ambiguous attempts retain highwater/pending forever. Recovery is
 * a separate reviewed protocol; invoking this function again never clears it.
 * Sequence -1 is a pre-genesis tip. The existing ledger must still append its
 * genuine immutable sequence-zero bootstrap through the normal signed fence.
 */
export async function provisionAuthority2Genesis({storage,bucket,pin,
  anchor_pin,commitment,anchor_proof,expected_commitment_sha256,
  anchor_read_token,fetchImpl=fetch}){
  requireStorage(storage);requireBucket(bucket);
  // Detach all public objects before the first await; caller mutation must not
  // change a commitment after the independently supplied hash was checked.
  const c=validatedPin(structuredClone(pin));
  const a=anchorPin(structuredClone(anchor_pin));
  const p=structuredClone(commitment),proof=structuredClone(anchor_proof);
  exact(p,COMMITMENT_KEYS,'GENESIS_COMMITMENT');
  if(typeof expected_commitment_sha256!=='string'||!H64.test(expected_commitment_sha256)||
     await sha256Json(p)!==expected_commitment_sha256)
    hold('A2_GENESIS_APPROVED_HASH_MISMATCH_HOLD');
  if(p.schema!==SCHEMA||p.ledger_sequence!==0||p.kind!=='AUTHORITY2_PREGENESIS'||
     p.initial_sequence!==-1||p.initial_head!=='0'.repeat(64)||
     p.reviewed_bundle_sha256!==BUNDLE||typeof p.genesis_nonce!=='string'||!H64.test(p.genesis_nonce)||
     a.namespace===c.namespace||PIN_KEYS.some(k=>canonicalJson(p[k])!==canonicalJson(c[k])))
    hold('A2_GENESIS_COMMITMENT_BINDING_HOLD');
  const anchored={...p,anchor:proof};
  await verifyGithubCheckpoint({pin:a,token:anchor_read_token,
    payload:anchored,fetchImpl});
  const barrierKey=genesisBarrierKey(c),prefix=prefixFor(c);
  const barrier=canonicalJson({schema:'musitu.axiom.authority2.genesis-barrier.v1',
    commitment:p,commitment_sha256:expected_commitment_sha256,
    anchor_pin:a,anchor:proof});
  if(encoder.encode(barrier).length>8192)hold('A2_GENESIS_BARRIER_SIZE_HOLD');
  const pending={kind:'AUTHORITY2_GENESIS_PENDING',
    commitment_sha256:expected_commitment_sha256,barrier_key:barrierKey};

  // This transaction alone arbitrates concurrent initializers. It is the
  // only write before R2, and the serving Worker already refuses this key.
  // No network operation is ever performed inside a retryable transaction.
  await storage.transaction(async s=>{
    // getAlarm is a storage API, not a DurableObjectTransaction method. In
    // SQLite its access through the storage handle joins this transaction.
    await emptyStorage(s,storage);
    await s.put('highwater/pending',pending);
  });
  await storage.sync();

  await boundedR2(async()=>{
    const before=await bucket.list({prefix,limit:1});
    if(!before||!Array.isArray(before.objects)||before.objects.length||before.truncated!==false)
      hold('A2_GENESIS_EXISTING_R2_HISTORY_HOLD');
    // Exactly one conditional PUT. A lost ACK is not retried or reconciled
    // into a success, even when a later read can observe the object.
    const result=await bucket.put(barrierKey,barrier,{
      onlyIf:new Headers({'if-none-match':'*'}),
      httpMetadata:{contentType:'application/json'}});
    if(!result)hold('A2_GENESIS_R2_BARRIER_UNCONFIRMED_HOLD');
    const read=await bucket.get(barrierKey);
    if(!read||read.size!==encoder.encode(barrier).length||await read.text()!==barrier)
      hold('A2_GENESIS_R2_BARRIER_READBACK_HOLD');
    const after=await bucket.list({prefix,limit:2});
    if(!after||!Array.isArray(after.objects)||after.truncated!==false||
       after.objects.length!==1||after.objects[0].key!==barrierKey||
       await bucket.head(wormKey(c,0)))hold('A2_GENESIS_R2_NAMESPACE_CHANGED_HOLD');
  });
  // Observe the immutable proof and original repository identity again after
  // the irreversible R2 operation, before promoting the pre-genesis tip.
  await verifyGithubCheckpoint({pin:a,token:anchor_read_token,
    payload:anchored,fetchImpl});
  const {public_key_jwk:_publicKey,...identity}=c;
  await storage.transaction(async s=>{
    const values=await s.list({limit:2});
    if(!(values instanceof Map)||values.size!==1||
       canonicalJson(values.get('highwater/pending')??null)!==canonicalJson(pending)||
       await storage.getAlarm()!==null)hold('A2_GENESIS_PENDING_CHANGED_HOLD');
    await s.put('highwater/genesis',{commitment_sha256:expected_commitment_sha256,
      barrier_key:barrierKey,anchor_pin:a,anchor:proof});
    await s.put('highwater/tip',{...identity,sequence:-1,head:'0'.repeat(64)});
    await s.delete('highwater/pending');
  });
  await storage.sync();
  return {schema:'musitu.axiom.authority2.genesis-candidate-result.v1',
    status:'PREGENESIS_COMMITTED_CANDIDATE_ONLY',
    commitment_sha256:expected_commitment_sha256,barrier_key:barrierKey,
    initial_sequence:-1,dispatch_allowed:false,release_status:'NOT_RELEASE'};
}
