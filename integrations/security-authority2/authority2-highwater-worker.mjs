/** Candidate independent Security Authority 2 CAS service. No bootstrap/reset endpoint.
 * The provider cannot serve traffic without a separately provisioned genesis barrier.
 * This DO is RESTORABLE: independent nonrollbackable witness remains a RELEASE BLOCKER.
 */
import {wormReadback,wormAppend} from './authority2-r2-worm.mjs';
const SCHEMA='musitu.axiom.external-highwater.v1';
const H64=/^[a-f0-9]{64}$/;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,179}$/;
const enc=new TextEncoder();
const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(status,payload)=>new Response(JSON.stringify(payload),{status,headers});
function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
class Denied extends Error{constructor(code,status=403){super(code);this.code=code;this.status=status;}}
const deny=(code,status)=>{throw new Denied(code,status);};
function exact(x,keys){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==keys.length||!keys.every(k=>Object.hasOwn(x,k)))deny('HIGHWATER_INVALID_FIELDS_HOLD',400);}
function config(env){let c;try{c=JSON.parse(env.HW_CONFIG_JSON);}catch{deny('HIGHWATER_CONFIG_MISSING_HOLD',503);}
  exact(c,['account_id','ledger_id','namespace','key_id','public_key_jwk']);
  // Operator config must carry the same public Ed25519 key pinned by the
  // separately configured AXIOM consumer. This checks accidental/key-swap
  // mismatch before an irreversible external checkpoint is written.
  exact(c.public_key_jwk,['kty','crv','x']);
  if(c.public_key_jwk.kty!=='OKP'||c.public_key_jwk.crv!=='Ed25519'||
     typeof c.public_key_jwk.x!=='string'||
     !/^[A-Za-z0-9_-]{43}$/.test(c.public_key_jwk.x))
    deny('HIGHWATER_PUBLIC_SIGNER_PIN_INVALID_HOLD',503);
  if(c.account_id!=='67469478aa9349fa0a57fe3a72da200a'||!ID.test(c.ledger_id)||!ID.test(c.key_id)||!/^ax-[a-z0-9-]{1,60}$/.test(c.namespace))deny('HIGHWATER_ACCOUNT_PIN_MISMATCH_HOLD',503);
  return c;
}
async function principal(r,env,role){const value=r.headers.get('authorization')?.match(/^Bearer ([a-zA-Z0-9_-]{32,200})$/)?.[1];if(!value)deny('HIGHWATER_AUTH_REQUIRED',401);
  let registry;try{registry=JSON.parse(env.HW_ROLE_TOKEN_SHA256_JSON);}catch{deny('HIGHWATER_CREDENTIAL_CONFIG_HOLD',503);}
  exact(registry,['write','read']);if(!H64.test(registry[role])||registry.write===registry.read)deny('HIGHWATER_CREDENTIAL_CONFIG_HOLD',503);
  const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(h!==registry[role])deny('HIGHWATER_ROLE_DENIED',403);
}
async function body(req){
  if(req.headers.get('origin')||req.headers.get('cookie')||req.headers.get('sec-fetch-site'))
    deny('HIGHWATER_SERVER_CHANNEL_ONLY',403);
  if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    deny('HIGHWATER_JSON_REQUIRED',415);
  const length=req.headers.get('content-length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>4096))
    deny('HIGHWATER_BODY_TOO_LARGE',413);
  // Some clients omit Content-Length or stream indefinitely. Reading text()
  // first would buffer arbitrarily large requests and hang the serialized DO.
  if(!req.body||typeof req.body.getReader!=='function')deny('HIGHWATER_JSON_INVALID',400);
  const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let timer,text='',count=0,complete=false;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(
    ()=>reject(new Denied('HIGHWATER_BODY_TIMEOUT_HOLD',503)),2000);
  });
  try{
    for(;;){
      const chunk=await Promise.race([reader.read(),deadline]);
      if(chunk.done){complete=true;break;}
      if(!(chunk.value instanceof Uint8Array))deny('HIGHWATER_JSON_INVALID',400);
      count+=chunk.value.byteLength;
      if(count>4096)deny('HIGHWATER_BODY_TOO_LARGE',413);
      try{text+=decoder.decode(chunk.value,{stream:true});}
      catch{deny('HIGHWATER_JSON_INVALID',400);}
    }
    try{text+=decoder.decode();}catch{deny('HIGHWATER_JSON_INVALID',400);}
  }finally{
    clearTimeout(timer);
    if(!complete)try{void reader.cancel().catch(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
  }
  let x;try{x=JSON.parse(text);}catch{deny('HIGHWATER_JSON_INVALID',400);}
  if(canonical(x)!==text)deny('HIGHWATER_CANONICAL_REQUIRED',400);
  return x;
}
const base=['schema','account_id','ledger_id','namespace','key_id','challenge'];
const eventKeys=['sequence','previous_sequence','previous_head','head','event_digest','artifact_sha256','action_sha256'];
function common(v,c){if(v.schema!==SCHEMA||v.account_id!==c.account_id||v.ledger_id!==c.ledger_id||v.namespace!==c.namespace||v.key_id!==c.key_id||!H64.test(v.challenge))deny('HIGHWATER_TRUST_BINDING_DENIED_HOLD',403);}
function event(v){for(const k of ['previous_head','head','event_digest','artifact_sha256','action_sha256'])if(!H64.test(v[k]))deny('HIGHWATER_INVALID_HASH_HOLD',400);
  if(!Number.isSafeInteger(v.sequence)||v.sequence<0||v.sequence>1000000||v.previous_sequence!==v.sequence-1)deny('HIGHWATER_SEQUENCE_DENIED_HOLD',409);}
function base64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
async function prepareSigner(env){
  let jwk;try{jwk=JSON.parse(env.HW_SIGNING_JWK);}
  catch{deny('HIGHWATER_SIGNER_UNAVAILABLE_HOLD',503);}
  if(jwk?.kty!=='OKP'||jwk?.crv!=='Ed25519'||!jwk.d||!jwk.x)
    deny('HIGHWATER_SIGNER_UNAVAILABLE_HOLD',503);
  const approved=config(env).public_key_jwk;
  if(jwk.x!==approved.x)
    deny('HIGHWATER_SIGNER_PIN_MISMATCH_HOLD',503);
  try{
    const key=await crypto.subtle.importKey('jwk',
      {kty:'OKP',crv:'Ed25519',x:jwk.x,d:jwk.d},
      {name:'Ed25519'},false,['sign']);
    // Prove actual signing capability BEFORE persisting pending or writing R2.
    // This does not prove external custody or guarantee a future provider ACK.
    await crypto.subtle.sign('Ed25519',key,enc.encode('A2_SIGNER_PRECOMMIT_CHECK_V1'));
    return key;
  }catch{deny('HIGHWATER_SIGNER_UNAVAILABLE_HOLD',503);}
}
async function signed(env,payload,preparedKey){
  const key=preparedKey??await prepareSigner(env);
  try{
    return {payload,signature:base64(await crypto.subtle.sign('Ed25519',key,
      enc.encode(canonical(payload))))};
  }catch{deny('HIGHWATER_SIGNER_UNAVAILABLE_HOLD',503);}
}
// R2 provider calls have no guaranteed cancellation contract. A bounded
// observation window is essential because an ambiguous PUT may finish late.
// Caller has durably written highwater/pending BEFORE issuing the PUT. Timeout
// means HOLD forever, no resend or local tip commit.
async function boundedWorm(operation){
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Denied('HIGHWATER_WORM_TIMEOUT_HOLD',503)),3000);
  });
  try{return await Promise.race([operation(),deadline]);}
  finally{clearTimeout(timer);}
}
export class Authority2Highwater {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.pin=config(env);if(!env.HIGHWATER_WORM)deny('HIGHWATER_WORM_BINDING_REQUIRED_HOLD',503);this.worm=env.HIGHWATER_WORM;}
  async fetch(r){try{
    if(r.method!=='POST')return reply(404,{error:'HIGHWATER_ROUTE_NOT_FOUND_HOLD'});
    const path=new URL(r.url).pathname;if(!['/v1/highwater/append','/v1/highwater/readback'].includes(path))return reply(404,{error:'HIGHWATER_ROUTE_NOT_FOUND_HOLD'});
    await principal(r,this.env,path.endsWith('append')?'write':'read');const input=await body(r);const c=this.pin;
    exact(input,path.endsWith('append')?[...base,...eventKeys]:base);common(input,c);
    if(path.endsWith('append')){
      event(input);
      // Refuse an unusable signing key before consuming a one-time sequence,
      // writing checkpoint/pending, or attempting an external R2 PUT.
      const readySigner=await prepareSigner(this.env);
      const transition=await this.ctx.storage.transaction(async s=>{
        if(await s.get('highwater/pending'))deny('HIGHWATER_PENDING_RECONCILIATION_HOLD',503);
        const tip=await s.get('highwater/tip');
        // Never silently initialize or reinitialize a lost/restored authority.
        if(!tip||tip.ledger_id!==c.ledger_id||tip.namespace!==c.namespace||tip.account_id!==c.account_id||tip.key_id!==c.key_id)deny('HIGHWATER_GENESIS_OR_CONTINUITY_MISSING_HOLD',503);
        if(tip.sequence!==input.previous_sequence||tip.head!==input.previous_head||input.sequence!==tip.sequence+1)deny('HIGHWATER_CAS_REPLAY_DENIED_HOLD',409);
        const record={...input,decision:'ALLOW_ONCE'};
        await s.put('highwater/pending',{record,next:{...tip,sequence:input.sequence,head:input.head}});
        return record;
      });
      await this.ctx.storage.sync();
      // External R2 is never mutated inside a retryable DO transaction.
      // Failed or ambiguous put persists pending and stops all admissions.
      await boundedWorm(()=>wormAppend(this.worm,c,transition));
      await this.ctx.storage.transaction(async s=>{
        const pending=await s.get('highwater/pending');
        if(!pending||canonical(pending.record)!==canonical(transition))deny('HIGHWATER_PENDING_CHANGED_HOLD',503);
        await s.put('highwater/event/'+String(input.sequence).padStart(12,'0'),transition);
        await s.put('highwater/tip',pending.next);
        await s.delete('highwater/pending');
      });
      await this.ctx.storage.sync();
      return reply(200,await signed(this.env,{...transition,kind:'commit'},readySigner));
    }
    if(await this.ctx.storage.get('highwater/pending'))deny('HIGHWATER_PENDING_RECONCILIATION_HOLD',503);
    const tip=await this.ctx.storage.get('highwater/tip');
    if(!tip||tip.ledger_id!==c.ledger_id||tip.namespace!==c.namespace||tip.account_id!==c.account_id||tip.key_id!==c.key_id)deny('HIGHWATER_GENESIS_OR_CONTINUITY_MISSING_HOLD',503);
    await boundedWorm(()=>wormReadback(this.worm,c,tip));
    const {public_key_jwk: _operatorApprovedPublicKey,...binding}=c;
    return reply(200,await signed(this.env,{schema:SCHEMA,...binding,challenge:input.challenge,kind:'readback',sequence:tip.sequence,head:tip.head}));
  }catch(e){return reply(e instanceof Denied?e.status:503,{error:e instanceof Denied?e.code:'HIGHWATER_UNAVAILABLE_HOLD',dispatch_allowed:false});}}
}
export default {async fetch(r,env){try{const c=config(env);return await env.HIGHWATER_STATE.get(env.HIGHWATER_STATE.idFromName('highwater/'+c.ledger_id+'/'+c.namespace)).fetch(r);}catch{return reply(503,{error:'HIGHWATER_UNAVAILABLE_HOLD',dispatch_allowed:false});}}};