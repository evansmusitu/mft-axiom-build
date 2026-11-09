/** External high-water proof client for Security Authority 2.
 * DRAFT ONLY. Source control / a Cloudflare DO alone do not make a witness
 * non-rollbackable. No runtime may dispatch without successful result.
 */
const SCHEMA = 'musitu.axiom.external-highwater.v1';
const H64 = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,179}$/;
const encoder = new TextEncoder();
export class HighwaterHold extends Error {constructor(reason) {super(reason);this.name='HighwaterHold';this.reason=reason;}}
const hold = reason => {throw new HighwaterHold(reason);};
function sameKeys(obj, keys) {
  if (!obj || typeof obj!=='object' || Array.isArray(obj) ||
      Object.keys(obj).length!==keys.length ||
      !keys.every(x=>Object.hasOwn(obj,x))) hold('HIGHWATER_INVALID_FIELDS_HOLD');
}
function canonical(obj){
  if (Array.isArray(obj)) return '['+obj.map(canonical).join(',')+']';
  if (obj && typeof obj==='object') return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+canonical(obj[k])).join(',')+'}';
  return JSON.stringify(obj);
}
function checkHex(x){if(typeof x!=='string'||!H64.test(x))hold('HIGHWATER_INVALID_HASH_HOLD');}
function base64url(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
function decodeB64(s){if(typeof s!=='string'||!(/^[A-Za-z0-9_-]{86}$/).test(s))hold('HIGHWATER_INVALID_SIGNATURE_HOLD');try {return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));}catch{hold('HIGHWATER_INVALID_SIGNATURE_HOLD');}}
export function highwaterPin(v){
  sameKeys(v,['account_id','ledger_id','namespace','key_id','origin','public_key_jwk']);
  if(!/^[0-9a-f]{32}$/.test(v.account_id)||!ID.test(v.ledger_id)||!ID.test(v.key_id)||!/^ax-[a-z0-9-]{1,60}$/.test(v.namespace))hold('HIGHWATER_TRUST_PIN_INVALID_HOLD');
  let u;try {u=new URL(v.origin);}catch{hold('HIGHWATER_ORIGIN_INVALID_HOLD');}
  if(u.protocol!=='https:'||u.origin!==v.origin||u.username||u.password||u.hostname==='localhost'||u.hostname.endsWith('.local')||!u.hostname.includes('.'))hold('HIGHWATER_ORIGIN_INVALID_HOLD');
  const jwk=v.public_key_jwk;sameKeys(jwk,['kty','crv','x']);
  if(jwk.kty!=='OKP'||jwk.crv!=='Ed25519'||typeof jwk.x!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(jwk.x))hold('HIGHWATER_SIGNING_KEY_INVALID_HOLD');
  return Object.freeze(structuredClone(v));
}
function eventFields(e,p){
  sameKeys(e,['ledger_id','namespace','sequence','previous_sequence','previous_head','head','event_digest','artifact_sha256','action_sha256']);
  if(e.ledger_id!==p.ledger_id||e.namespace!==p.namespace||!Number.isSafeInteger(e.sequence)||e.sequence<0||e.sequence>1000000||e.previous_sequence!==e.sequence-1)hold('HIGHWATER_EVENT_SEQUENCE_DENIED_HOLD');
  for(const k of ['previous_head','head','event_digest','artifact_sha256','action_sha256'])checkHex(e[k]);
}
async function envelope(p,signature,key){
  const ok=await crypto.subtle.verify('Ed25519',key,decodeB64(signature),encoder.encode(canonical(p))).catch(()=>false);
  if(!ok)hold('HIGHWATER_SIGNATURE_INVALID_HOLD');
}
async function request(fetchImpl,origin,path,body,token,timeoutMs){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const r=await fetchImpl(origin+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','cache-control':'no-store'},body:canonical(body),redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal});
    if(r.status!==200)hold('HIGHWATER_REMOTE_DENIAL_HOLD');
    const raw=await r.text();if(raw.length>16384)hold('HIGHWATER_RESPONSE_OVERSIZE_HOLD');
    try{return JSON.parse(raw);}catch{hold('HIGHWATER_RESPONSE_INVALID_HOLD');}
  }catch(e){if(e instanceof HighwaterHold)throw e;hold('HIGHWATER_TRANSPORT_AMBIGUOUS_HOLD');}
  finally{clearTimeout(timer);}
}
async function signedPayload(e,pin,key,kind,challenge){
  sameKeys(e,['payload','signature']);const value=e.payload;
  if(!value||value.schema!==SCHEMA||value.kind!==kind||value.challenge!==challenge||value.ledger_id!==pin.ledger_id||value.namespace!==pin.namespace||value.account_id!==pin.account_id||value.key_id!==pin.key_id)hold('HIGHWATER_TRUST_BINDING_DENIED_HOLD');
  await envelope(value,e.signature,key);return value;
}
export async function externalHighwaterFence({pin,write_token,read_token,event,fetchImpl=fetch,timeoutMs=5000,nonce=()=>crypto.randomUUID()}={}){
  pin=highwaterPin(pin);eventFields(event,pin);
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)hold('HIGHWATER_TIMEOUT_POLICY_HOLD');
  for(const token of [write_token,read_token])if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(token))hold('HIGHWATER_DISTINCT_CREDENTIAL_MISSING_HOLD');
  if(write_token===read_token)hold('HIGHWATER_READ_WRITE_ROLES_NOT_SEPARATED_HOLD');
  const key=await crypto.subtle.importKey('jwk',pin.public_key_jwk,{name:'Ed25519'},false,['verify']);
  const challenge=await crypto.subtle.digest('SHA-256',encoder.encode(nonce()));
  const challengeHex=[...new Uint8Array(challenge)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const commit=await signedPayload(await request(fetchImpl,pin.origin,'/v1/highwater/append',{schema:SCHEMA,account_id:pin.account_id,key_id:pin.key_id,...event,challenge:challengeHex},write_token,timeoutMs),pin,key,'commit',challengeHex);
  if(commit.decision!=='ALLOW_ONCE'||Object.keys(event).some(k=>commit[k]!==event[k]))hold('HIGHWATER_COMMIT_MISMATCH_HOLD');
  const nextChallenge=await crypto.subtle.digest('SHA-256',encoder.encode(nonce()));
  const nextHex=[...new Uint8Array(nextChallenge)].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(nextHex===challengeHex)hold('HIGHWATER_CHALLENGE_COLLISION_HOLD');
  const tip=await signedPayload(await request(fetchImpl,pin.origin,'/v1/highwater/readback',{schema:SCHEMA,account_id:pin.account_id,ledger_id:pin.ledger_id,namespace:pin.namespace,key_id:pin.key_id,challenge:nextHex},read_token,timeoutMs),pin,key,'readback',nextHex);
  if(tip.sequence!==event.sequence||tip.head!==event.head)hold('HIGHWATER_POST_COMMIT_READBACK_MISMATCH_HOLD');
  return Object.freeze({status:'EXTERNAL_CAS_COMMITTED_AND_INDEPENDENTLY_READ_BACK',account_id:pin.account_id,namespace:pin.namespace,sequence:event.sequence,head:event.head,commit_envelope:commit});
}