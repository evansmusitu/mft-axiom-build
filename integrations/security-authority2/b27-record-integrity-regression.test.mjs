/** RED: original R2 head-only readback accepted a forged predecessor.
 * Keep the negative proof; current hash alone is not a continuity proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {wormReadback,wormKey} from './authority2-r2-worm.mjs';

const pin={account_id:'67469478aa9349fa0a57fe3a72da200a',
  ledger_id:'synthetic',namespace:'ax-security-authority2',key_id:'key-synthetic'};
const h=s=>s.repeat(64);
const records=new Map();
records.set(wormKey(pin,0),{schema:'musitu.axiom.external-highwater.v1',...pin,sequence:0,head:h('0')});
records.set(wormKey(pin,1),{schema:'musitu.axiom.external-highwater.v1',...pin,
  sequence:1,previous_sequence:0,previous_head:h('0'),head:h('1'),
  event_digest:h('a'),artifact_sha256:h('b'),action_sha256:h('c'),
  challenge:h('d'),decision:'ALLOW_ONCE'});
const bucket={
  head:async k=>records.has(k)?{key:k}:null,
  get:async k=>records.has(k)?{size:JSON.stringify(records.get(k)).length,
    text:async()=>JSON.stringify(records.get(k))}:null,
  put:async()=>{throw Error('read-only fixture')},
};
test('baseline legitimate predecessor link accepted',async()=>{
  assert.equal(await wormReadback(bucket,pin,{sequence:1,head:h('1')}),true);
});
test('B27 detects corrupted R2 predecessor hash even if current head matches',async()=>{
  const key=wormKey(pin,1),original=records.get(key);
  records.set(key,{...original,previous_head:h('f')});
  try{await assert.rejects(wormReadback(bucket,pin,{sequence:1,head:h('1')}),
    /HIGHWATER_WORM_PREDECESSOR_HASH_MISMATCH_HOLD/);}
  finally{records.set(key,original);}
});
test('B27 detects corrupted R2 predecessor sequence even if current head matches',async()=>{
  const key=wormKey(pin,1),original=records.get(key);
  records.set(key,{...original,previous_sequence:-1});
  try{await assert.rejects(wormReadback(bucket,pin,{sequence:1,head:h('1')}),
    /HIGHWATER_WORM_PREDECESSOR_SEQUENCE_MISMATCH_HOLD/);}
  finally{records.set(key,original);}
});
