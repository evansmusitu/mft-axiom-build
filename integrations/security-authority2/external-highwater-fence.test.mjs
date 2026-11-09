import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {externalHighwaterFence,HighwaterHold} from './external-highwater-fence.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const encoder=new TextEncoder();
const canon=x=>JSON.stringify(x,Object.keys(x).sort());
function canonical(obj){if(Array.isArray(obj))return '['+obj.map(canonical).join(',')+']';if(obj&&typeof obj==='object')return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+canonical(obj[k])).join(',')+'}';return JSON.stringify(obj);}
const tok=ch=>ch.repeat(40);
const sha=i=>i.repeat(64);
async function scenario(){
 const kp=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',kp.publicKey);
 const pin={account_id:'67469478aa9349fa0a57fe3a72da200a',ledger_id:'ledger',namespace:'ax-authority2',key_id:'authority2-key',origin:'https://custody.example.com',public_key_jwk:{kty:'OKP',crv:'Ed25519',x:jwk.x}};
 const event={ledger_id:'ledger',namespace:'ax-authority2',sequence:1,previous_sequence:0,previous_head:sha('0'),head:sha('1'),event_digest:sha('2'),artifact_sha256:sha('3'),action_sha256:sha('4')};
 let state={sequence:0,head:sha('0')};let calls=0;let mutate=e=>e;
 async function signed(payload){const sig=await crypto.subtle.sign('Ed25519',kp.privateKey,encoder.encode(canonical(payload)));return {payload,signature:Buffer.from(sig).toString('base64url')};}
 const fetchImpl=async(url,opts)=>{
    calls++;const body=JSON.parse(opts.body);const common={schema:'musitu.axiom.external-highwater.v1',account_id:pin.account_id,ledger_id:pin.ledger_id,namespace:pin.namespace,key_id:pin.key_id,challenge:body.challenge};
    let envelope;
    if(url.endsWith('/append')){
      if(body.previous_sequence!==state.sequence||body.previous_head!==state.head||body.sequence!==state.sequence+1)return {status:409,text:async()=>JSON.stringify({error:'CAS_DENIED'})};
      state={sequence:body.sequence,head:body.head};
      envelope=await signed({...common,kind:'commit',decision:'ALLOW_ONCE',...event});
    }else if(url.endsWith('/readback'))envelope=await signed({...common,kind:'readback',...state});
    else throw Error('not expected');
    envelope=mutate(envelope,url);return {status:200,text:async()=>JSON.stringify(envelope)};
 };
 const args={pin,event,write_token:tok('w'),read_token:tok('r'),fetchImpl};
 return {args,peek:()=>state,reset:s=>state=s,mutate:f=>mutate=f,calls:()=>calls};
}
test('serialized external commit + fresh independent readback',async()=>{const x=await scenario();const p=await externalHighwaterFence(x.args);assert.equal(p.sequence,1);assert.equal(x.calls(),2)});
test('restored local authority cannot replay an already consumed event',async()=>{const x=await scenario();await externalHighwaterFence(x.args);await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_REMOTE_DENIAL_HOLD/);assert.equal(x.peek().sequence,1)});
test('future sequence skips are rejected before remote dispatch',async()=>{const x=await scenario();await assert.rejects(externalHighwaterFence({...x.args,event:{...x.args.event,sequence:3,previous_sequence:0}}),/HIGHWATER_EVENT_SEQUENCE_DENIED_HOLD/)});
test('tampered signed proof is denied',async()=>{const x=await scenario();x.mutate(e=>({...e,payload:{...e.payload,head:sha('f')}}));await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_SIGNATURE_INVALID_HOLD/)});
test('incorrect signer or administrator account pin denies',async()=>{const x=await scenario();await assert.rejects(externalHighwaterFence({...x.args,pin:{...x.args.pin,account_id:'e'.repeat(32)}}),/HIGHWATER_TRUST_BINDING_DENIED_HOLD/)});
test('independent readback mismatched tip denies permit',async()=>{const x=await scenario();x.mutate((e,url)=>url.endsWith('readback')?{...e,payload:{...e.payload,head:sha('c')}}:e);await assert.rejects(externalHighwaterFence(x.args),/HIGHWATER_SIGNATURE_INVALID_HOLD/)});
test('network/timeout ambiguity never issues a permit',async()=>{const x=await scenario();await assert.rejects(externalHighwaterFence({...x.args,fetchImpl:async()=>{throw Error('disconnect')}}),/HIGHWATER_TRANSPORT_AMBIGUOUS_HOLD/)});
test('shared read-write credential is rejected',async()=>{const x=await scenario();await assert.rejects(externalHighwaterFence({...x.args,read_token:x.args.write_token}),/HIGHWATER_READ_WRITE_ROLES_NOT_SEPARATED_HOLD/)});
test('concurrent duplicate admissions allow at most one',async()=>{const x=await scenario();const rs=await Promise.allSettled(Array.from({length:8},()=>externalHighwaterFence(x.args)));assert.equal(rs.filter(r=>r.status==='fulfilled').length,1)});
test('negative counterexample: if independently held witness is also reset, an old admission can be reissued',async()=>{
  const x=await scenario();
  await externalHighwaterFence(x.args);
  x.reset({sequence:0,head:sha('0')});
  const replay=await externalHighwaterFence(x.args);
  assert.equal(replay.sequence,1,'REPRODUCED: restorable witness cannot satisfy global nonrollback');
});