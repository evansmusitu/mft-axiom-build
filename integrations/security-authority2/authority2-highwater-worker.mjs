/** Candidate independent Security Authority 2 CAS service. No bootstrap/reset endpoint.
 * The provider cannot serve traffic without a separately provisioned genesis barrier.
 * This DO is RESTORABLE: independent nonrollbackable witness remains a RELEASE BLOCKER.
 */
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
  exact(c,['account_id','ledger_id','namespace','key_id']);
  if(c.account_id!=='67469478aa9349fa0a57fe3a72da200a'||!ID.test(c.ledger_id)||!ID.test(c.key_id)||!/^ax-[a-z0-9-]{1,60}$/.test(c.namespace))deny('HIGHWATER_ACCOUNT_PIN_MISMATCH_HOLD',503);
  return c;
}
async function principal(r,env,role){const value=r.headers.get('authorization')?.match(/^Bearer ([a-zA-Z0-9_-]{32,200})$/)?.[1];if(!value)deny('HIGHWATER_AUTH_REQUIRED',401);
  let registry;try{registry=JSON.parse(env.HW_ROLE_TOKEN_SHA256_JSON);}catch{deny('HIGHWATER_CREDENTIAL_CONFIG_HOLD',503);}
  exact(registry,['write','read']);if(!H64.test(registry[role])||registry.write===registry.read)deny('HIGHWATER_CREDENTIAL_CONFIG_HOLD',503);
  const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(h!==registry[role])deny('HIGHWATER_ROLE_DENIED',403);
}
async function body(req){if(req.headers.get('origin')||req.headers.get('cookie')||req.headers.get('sec-fetch-site'))deny('HIGHWATER_SERVER_CHANNEL_ONLY',403);
  if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))deny('HIGHWATER_JSON_REQUIRED',415);
  if(Number(req.headers.get('content-length')||0)>4096)deny('HIGHWATER_BODY_TOO_LARGE',413);
  const text=await req.text();if(enc.encode(text).byteLength>4096)deny('HIGHWATER_BODY_TOO_LARGE',413);
  let x;try{x=JSON.parse(text);}catch{deny('HIGHWATER_JSON_INVALID',400);}
  if(canonical(x)!==text)deny('HIGHWATER_CANONICAL_REQUIRED',400);return x;
}
const base=['schema','account_id','ledger_id','namespace','key_id','challenge'];
const eventKeys=['sequence','previous_sequence','previous_head','head','event_digest','artifact_sha256','action_sha256'];
function common(v,c){if(v.schema!==SCHEMA||v.account_id!==c.account_id||v.ledger_id!==c.ledger_id||v.namespace!==c.namespace||v.key_id!==c.key_id||!H64.test(v.challenge))deny('HIGHWATER_TRUST_BINDING_DENIED_HOLD',403);}
function event(v){for(const k of ['previous_head','head','event_digest','artifact_sha256','action_sha256'])if(!H64.test(v[k]))deny('HIGHWATER_INVALID_HASH_HOLD',400);
  if(!Number.isSafeInteger(v.sequence)||v.sequence<0||v.sequence>1000000||v.previous_sequence!==v.sequence-1)deny('HIGHWATER_SEQUENCE_DENIED_HOLD',409);}
function base64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
async function signed(env,payload){let jwk;try{jwk=JSON.parse(env.HW_SIGNING_JWK);}catch{deny('HIGHWATER_SIGNER_UNAVAILABLE_HOLD',503);}
  if(jwk?.kty!=='OKP'||jwk?.crv!=='Ed25519'||!jwk.d||!jwk.x)deny('HIGHWATER_SIGNER_UNAVAILABLE_HOLD',503);
  const key=await crypto.subtle.importKey('jwk',{kty:'OKP',crv:'Ed25519',x:jwk.x,d:jwk.d},{name:'Ed25519'},false,['sign']);
  return {payload,signature:base64(await crypto.subtle.sign('Ed25519',key,enc.encode(canonical(payload))))};
}
export class Authority2Highwater {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.pin=config(env);}
  async fetch(r){try{
    if(r.method!=='POST')return reply(404,{error:'HIGHWATER_ROUTE_NOT_FOUND_HOLD'});
    const path=new URL(r.url).pathname;if(!['/v1/highwater/append','/v1/highwater/readback'].includes(path))return reply(404,{error:'HIGHWATER_ROUTE_NOT_FOUND_HOLD'});
    await principal(r,this.env,path.endsWith('append')?'write':'read');const input=await body(r);const c=this.pin;
    exact(input,path.endsWith('append')?[...base,...eventKeys]:base);common(input,c);
    if(path.endsWith('append')){
      event(input);
      const transition=await this.ctx.storage.transaction(async s=>{
        const tip=await s.get('highwater/tip');
        // Never silently initialize or reinitialize a lost/restored authority.
        if(!tip||tip.ledger_id!==c.ledger_id||tip.namespace!==c.namespace||tip.account_id!==c.account_id||tip.key_id!==c.key_id)deny('HIGHWATER_GENESIS_OR_CONTINUITY_MISSING_HOLD',503);
        if(tip.sequence!==input.previous_sequence||tip.head!==input.previous_head||input.sequence!==tip.sequence+1)deny('HIGHWATER_CAS_REPLAY_DENIED_HOLD',409);
        const record={...input,decision:'ALLOW_ONCE'};
        await s.put('highwater/event/'+String(input.sequence).padStart(12,'0'),record);
        await s.put('highwater/tip',{...tip,sequence:input.sequence,head:input.head});
        return record;
      });
      await this.ctx.storage.sync();
      return reply(200,await signed(this.env,{...transition,kind:'commit'}));
    }
    const tip=await this.ctx.storage.get('highwater/tip');
    if(!tip||tip.ledger_id!==c.ledger_id||tip.namespace!==c.namespace||tip.account_id!==c.account_id||tip.key_id!==c.key_id)deny('HIGHWATER_GENESIS_OR_CONTINUITY_MISSING_HOLD',503);
    return reply(200,await signed(this.env,{schema:SCHEMA,...c,challenge:input.challenge,kind:'readback',sequence:tip.sequence,head:tip.head}));
  }catch(e){return reply(e instanceof Denied?e.status:503,{error:e instanceof Denied?e.code:'HIGHWATER_UNAVAILABLE_HOLD',dispatch_allowed:false});}}
}
export default {async fetch(r,env){try{const c=config(env);return await env.HIGHWATER_STATE.get(env.HIGHWATER_STATE.idFromName('highwater/'+c.ledger_id+'/'+c.namespace)).fetch(r);}catch{return reply(503,{error:'HIGHWATER_UNAVAILABLE_HOLD',dispatch_allowed:false});}}};