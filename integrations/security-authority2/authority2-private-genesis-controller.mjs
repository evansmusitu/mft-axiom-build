/** TEMPORARY PRIVATE INITIALIZER CANDIDATE. Requires separate operator review.
 * HTTP ingress is always 404. No cron is configured in the review TOML.
 * Only an explicitly approved, short scheduled window can call the private DO.
 * Never deploy through builder CI; never retain this version after genesis.
 */
import {canonicalJson,exact,sha256Json,publicKey} from '../independent-ledger/protocol.mjs';
import {provisionAuthority2Genesis,genesisBarrierKey} from './authority2-genesis-candidate.mjs';

const H64=/^[a-f0-9]{64}$/;
const CONTROL_PATH='/__private_operator/genesis-once';
const HEADERS={'content-type':'application/json','cache-control':'no-store'};
const encoder=new TextEncoder();
class ControllerHold extends Error{constructor(code){super(code);this.code=code;}}
const hold=code=>{throw new ControllerHold(code);};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const notFound=()=>reply(404,{error:'AUTHORITY2_NO_HTTP_INITIALIZER',dispatch_allowed:false});
function safeCode(error){
  return typeof error?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?
    error.code:'A2_PRIVATE_GENESIS_UNCONFIRMED_HOLD';
}
function parse(value,code){
  if(typeof value!=='string'||encoder.encode(value).length>32768)hold(code);
  try{return JSON.parse(value);}catch{hold(code);}
}
function control(env,now=Date.now()){
  const value=parse(env.HW_GENESIS_CONTROL_JSON,'A2_GENESIS_CONTROL_CONFIG_HOLD');
  exact(value,['schema','approved_cron','not_before_ms','not_after_ms',
    'expected_commitment_sha256','anchor_pin','commitment','anchor_proof'],'GENESIS_CONTROL');
  if(value.schema!=='musitu.axiom.authority2.private-genesis-control.v1'||
     typeof value.approved_cron!=='string'||value.approved_cron.length>64||
     !/^[0-9*\/,\-]+(?: [0-9*\/,\-]+){4}$/.test(value.approved_cron)||
     !Number.isSafeInteger(value.not_before_ms)||!Number.isSafeInteger(value.not_after_ms)||
     value.not_before_ms<1||value.not_after_ms-value.not_before_ms<1||
     value.not_after_ms-value.not_before_ms>900000||
     now<value.not_before_ms||now>=value.not_after_ms||
     typeof value.expected_commitment_sha256!=='string'||!H64.test(value.expected_commitment_sha256))
    hold('A2_GENESIS_APPROVED_WINDOW_HOLD');
  return value;
}
function controlToken(env){
  if(typeof env.HW_GENESIS_CONTROL_TOKEN!=='string'||
     !/^[A-Za-z0-9_-]{32,200}$/.test(env.HW_GENESIS_CONTROL_TOKEN))
    hold('A2_GENESIS_PRIVATE_CONTROL_TOKEN_HOLD');
  return env.HW_GENESIS_CONTROL_TOKEN;
}
async function authenticate(request,env){
  const supplied=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  const expected=controlToken(env);
  if(!supplied)hold('A2_GENESIS_PRIVATE_CHANNEL_DENIED');
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256',encoder.encode(expected))]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let different=0;
  for(let i=0;i<aa.length;i++)different|=aa[i]^bb[i];
  if(different)hold('A2_GENESIS_PRIVATE_CHANNEL_DENIED');
}
async function verifySignerAndRoles(env){
  const pin=parse(env.HW_CONFIG_JSON,'A2_GENESIS_RUNTIME_PIN_HOLD');
  exact(pin,['account_id','ledger_id','namespace','key_id','public_key_jwk'],'GENESIS_RUNTIME_PIN');
  publicKey(pin.public_key_jwk);
  genesisBarrierKey(pin);
  const roles=parse(env.HW_ROLE_TOKEN_SHA256_JSON,'A2_GENESIS_RUNTIME_ROLES_HOLD');
  exact(roles,['read','write'],'GENESIS_RUNTIME_ROLES');
  if(typeof roles.read!=='string'||typeof roles.write!=='string'||
     !H64.test(roles.read)||!H64.test(roles.write)||roles.read===roles.write)
    hold('A2_GENESIS_RUNTIME_ROLES_HOLD');
  const jwk=parse(env.HW_SIGNING_JWK,'A2_GENESIS_SIGNER_UNAVAILABLE_HOLD');
  if(jwk?.kty!=='OKP'||jwk?.crv!=='Ed25519'||jwk.x!==pin.public_key_jwk.x||
     typeof jwk.d!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(jwk.d))
    hold('A2_GENESIS_SIGNER_PIN_HOLD');
  try{
    const key=await crypto.subtle.importKey('jwk',{kty:'OKP',crv:'Ed25519',x:jwk.x,d:jwk.d},
      'Ed25519',false,['sign']);
    const publicPart=await crypto.subtle.importKey('jwk',pin.public_key_jwk,'Ed25519',false,['verify']);
    const challenge=encoder.encode('AXIOM_AUTHORITY2_PRIVATE_GENESIS_SIGNER_CHECK_V1');
    const signature=await crypto.subtle.sign('Ed25519',key,challenge);
    if(!await crypto.subtle.verify('Ed25519',publicPart,signature,challenge))
      hold('A2_GENESIS_SIGNER_PIN_HOLD');
  }catch{hold('A2_GENESIS_SIGNER_UNAVAILABLE_HOLD');}
  return pin;
}
async function privateBody(request){
  if(request.headers.get('origin')||request.headers.get('cookie')||request.headers.get('sec-fetch-site')||
     request.headers.get('content-type')!=='application/json')hold('A2_GENESIS_PRIVATE_CHANNEL_DENIED');
  const reader=request.body?.getReader();if(!reader)hold('A2_GENESIS_PRIVATE_REQUEST_HOLD');
  let timer,text='',size=0;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ControllerHold(
    'A2_GENESIS_PRIVATE_REQUEST_TIMEOUT_HOLD')),2000);});
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const next=await Promise.race([reader.read(),timeout]);if(next.done)break;
    size+=next.value.byteLength;if(size>256)hold('A2_GENESIS_PRIVATE_REQUEST_SIZE_HOLD');
    text+=decoder.decode(next.value,{stream:true});}
    text+=decoder.decode();
    const body=JSON.parse(text);exact(body,['commitment_sha256'],'GENESIS_PRIVATE_REQUEST');
    if(text!==canonicalJson(body))hold('A2_GENESIS_PRIVATE_REQUEST_HOLD');
    return body;
  }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
}

export class Authority2Highwater {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(request){
    if(request.method!=='POST'||new URL(request.url).pathname!==CONTROL_PATH)return notFound();
    try{
      await authenticate(request,this.env);
      const input=await privateBody(request),approved=control(this.env);
      if(input.commitment_sha256!==approved.expected_commitment_sha256)
        hold('A2_GENESIS_PRIVATE_COMMITMENT_HOLD');
      const pin=await verifySignerAndRoles(this.env);
      const result=await provisionAuthority2Genesis({storage:this.ctx.storage,
        bucket:this.env.HIGHWATER_WORM,pin,
        anchor_pin:approved.anchor_pin,commitment:approved.commitment,
        anchor_proof:approved.anchor_proof,
        expected_commitment_sha256:approved.expected_commitment_sha256,
        deadline_ms:approved.not_after_ms,anchor_read_token:this.env.HW_GENESIS_GITHUB_READ_TOKEN});
      return reply(200,result);
    }catch(error){return reply(503,{error:safeCode(error),dispatch_allowed:false});}
  }
}

export async function executePrivateGenesisSchedule(controller,env){
  if(typeof controller?.noRetry!=='function')hold('A2_GENESIS_SCHEDULE_CONTEXT_HOLD');
  controller.noRetry();
  const approved=control(env),token=controlToken(env);
  if(controller.cron!==approved.approved_cron||
     !Number.isFinite(controller.scheduledTime)||
     controller.scheduledTime<approved.not_before_ms||controller.scheduledTime>=approved.not_after_ms)
    hold('A2_GENESIS_SCHEDULE_CONTEXT_HOLD');
  const pin=await verifySignerAndRoles(env);
  if(await sha256Json(approved.commitment)!==approved.expected_commitment_sha256)
    hold('A2_GENESIS_APPROVED_HASH_MISMATCH_HOLD');
  const stub=env.HIGHWATER_STATE.get(env.HIGHWATER_STATE.idFromName(
    'highwater/'+pin.ledger_id+'/'+pin.namespace));
  const response=await stub.fetch(new Request('https://authority2-private.invalid'+CONTROL_PATH,{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:canonicalJson({commitment_sha256:approved.expected_commitment_sha256})}));
  if(response.status!==200)hold('A2_GENESIS_PRIVATE_EXECUTION_HOLD');
  const result=await response.json();
  exact(result,['schema','status','commitment_sha256','barrier_key','initial_sequence',
    'dispatch_allowed','release_status'],'GENESIS_PRIVATE_RESULT');
  if(result.schema!=='musitu.axiom.authority2.genesis-candidate-result.v1'||
     result.initial_sequence!==-1||result.barrier_key!==genesisBarrierKey(pin)||
     result.status!=='PREGENESIS_COMMITTED_CANDIDATE_ONLY'||result.dispatch_allowed!==false||
     result.release_status!=='NOT_RELEASE'||result.commitment_sha256!==approved.expected_commitment_sha256)
    hold('A2_GENESIS_PRIVATE_RESULT_HOLD');
  return result;
}

export default {
  fetch(){return notFound();},
  async scheduled(controller,env){
    try{await executePrivateGenesisSchedule(controller,env);}
    catch(error){throw new ControllerHold(safeCode(error));}
  }
};
