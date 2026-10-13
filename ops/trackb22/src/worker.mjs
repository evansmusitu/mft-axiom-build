/** B22 local S0 *synthetic* OpenHands model gateway. NOT DEPLOYABLE.
 * Test fixture keys are public; this worker does not broker real provider calls.
 * The quota B15/B16 and broker B17 remain sourced from parent refs verbatim.
 */
import {DurableObject} from 'cloudflare:workers';
import {DurableDispatchJournal,JournalDenied} from './journal.mjs';
import {localOnly} from './host_policy.mjs';
import {utcDay,canonicalName,requireCanonicalObject,ScopeDenied} from '../../trackb16/src/identity.mjs';
import {guardedDispatch,digestPayload} from '../../trackb17/dispatch_guard.mjs';
import {TEST_PRIVATE_JWK} from '../../trackb16/test/fixture_key.mjs';
import {WORKLOAD_TEST_PRIVATE_JWK} from '../../trackb16/test/fixture_workload_key.mjs';
export {AxiomB16QuotaLedger} from '../../trackb16/src/worker.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MODEL='b22-synthetic-gated';
const WORKERS=new Set(['agent-a','agent-b']);
const ORDINALS=new Set(['0','1','2']);
const IDENTITY_PREFIX='axiom.journal.b22.v1:';
const deny=(reason,status=403)=>reply({status:'DENIED',dispatch_allowed:false,reason},status);
const reply=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const b64=arr=>btoa(String.fromCharCode(...new Uint8Array(arr)));
async function sha(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
async function sign(jwk,doc){const key=await crypto.subtle.importKey('jwk',jwk,'Ed25519',false,['sign']);const p=encoder.encode(JSON.stringify(doc));return {payload_b64:b64(p),signature_b64:b64(await crypto.subtle.sign('Ed25519',key,p))};}
export function journalName(account,day){if(typeof account!=='string'||typeof day!=='string')throw Error('INVALID_JOURNAL_CONTEXT');return IDENTITY_PREFIX+canonicalName(account,day).slice('axiom.quota.b16.v1:'.length);}
export function routeJournal(env,now=Date.now()){
  if(!env?.AXIOM_JOURNAL_S0||typeof env.AXIOM_JOURNAL_S0.getByName!=='function')throw Error('MISSING_JOURNAL_BINDING');
  const name=journalName(env.AXIOM_ACCOUNT_ID,utcDay(now));
  const stub=env.AXIOM_JOURNAL_S0.getByName(name);
  if(!stub||stub.name!==name||(stub.id?.name!==undefined&&stub.id.name!==name)||typeof stub.begin!=='function'||typeof stub.complete!=='function'||typeof stub.uncertain!=='function')throw Error('JOURNAL_STUB_IDENTITY_DENIED');
  return stub;
}
export class AxiomB22DispatchJournal extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.rejected=null;this.journal=null;this.account=env.AXIOM_ACCOUNT_ID;this.day=utcDay();
    try {if(ctx.id.name!==journalName(this.account,this.day))throw new ScopeDenied('NONCANONICAL_JOURNAL_OBJECT');}
    catch(e){if(e instanceof ScopeDenied){this.rejected=e.code;return;}throw e;}
    this.journal=new DurableDispatchJournal(ctx.storage,{accountId:this.account,utcDay:this.day});
  }
  check(){if(this.rejected)return this.rejected;
    if(this.ctx.id.name!==journalName(this.account,utcDay()))return 'JOURNAL_UTC_DAY_DENIED';
    return null;
  }
  result(fn){const reason=this.check();if(reason)return {status:'DENIED',send_allowed:false,reason};
    try{return fn();}
    catch(e){if(e instanceof JournalDenied)return {status:'DENIED',send_allowed:false,reason:e.code};throw e;}
  }
  async begin(req){return this.result(()=>this.journal.begin(req));}
  async complete(req){return this.result(()=>this.journal.complete(req));}
  async uncertain(req){return this.result(()=>this.journal.uncertain(req));}
  async lookup(req){return this.result(()=>this.journal.lookup(req));}
}
function decodeInput(obj){
  if(!obj||Array.isArray(obj)||typeof obj!=='object'||Object.keys(obj).sort().join(',')!=='agent,ordinal,raw_b64' ||
    !WORKERS.has(obj.agent)||!ORDINALS.has(obj.ordinal)||typeof obj.raw_b64!=='string'||obj.raw_b64.length<20||obj.raw_b64.length>82000||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(obj.raw_b64))throw Error('BAD_SCHEMA');
  const bytes=Uint8Array.from(atob(obj.raw_b64),x=>x.charCodeAt(0));
  if(bytes.length>60000||b64(bytes)!==obj.raw_b64)throw Error('INVALID_BYTES');
  const raw=JSON.parse(decoder.decode(bytes));
  if(!raw||Array.isArray(raw)||typeof raw!=='object'||!['b12-synthetic','openai/b12-synthetic'].includes(raw.model)||raw.stream===true||
    !Array.isArray(raw.messages)||!Array.isArray(raw.tools)||raw.tools.length<2||
    !raw.tools.some(x=>x?.function?.name==='file_editor')||!raw.tools.some(x=>x?.function?.name==='finish'))throw Error('SDK_SCHEMA_DENIED');
  return {worker:obj.agent,ordinal:obj.ordinal,bytes};
}
export default {
  async fetch(req,env){
    // Fail CLOSED if accidentally exposed through a non-loopback HTTP origin.
    // This S0 transport restriction does not replace production authentication.
    if(!localOnly(req.url))return reply({status:'DISABLED_PUBLIC_ROUTING',dispatch_allowed:false},503);
    // Outward HTTP defaults to denial. This bearer is isolated disposable CI
    // only, not a real independently authenticated workload identity.
    if(!env.AXIOM_B22_TEST_SECRET || env.AXIOM_B22_TEST_SECRET.length<30 ||
      req.headers.get('X-Axiom-B21-Local-Secret')!==env.AXIOM_B22_TEST_SECRET)return deny('S0_AUTH_REQUIRED');
    const url=new URL(req.url);
    if(url.pathname==='/_internal_s0_health'&&req.method==='GET')return reply({stage:'B22_LOCAL_ONLY',ready:true});
    if(url.pathname!=='/_internal_s0_admit'||req.method!=='POST')return deny('PUBLIC_ROUTING_DISABLED',404);
    let op;try{if(Number(req.headers.get('content-length')||0)>93000)throw Error();op=decodeInput(await req.json());}
    catch{return deny('MALFORMED_REQUEST');}
    const worker=op.worker,now=Math.floor(Date.now()/1000),day=utcDay();
    const grantId='b22-local-'+worker;
    const grant=await sign(TEST_PRIVATE_JWK,{schema:'musitu.axiom.trackb15.s0.quota-grant.v1',account_id:env.AXIOM_ACCOUNT_ID,
      utc_day:day,tenant_id:'tenant-b22-synthetic',workload_id:worker,grant_id:grantId,
      issued_at:now-3,expires_at:now+90,max_calls:3,max_per_call_neurons:100,
      daily_capacity_neurons:600,provider_remaining_certified:true,production_authority:false});
    const originalSha=await sha(op.bytes);
    const payload={model:MODEL,messages:[{role:'user',content:worker+'|sdk-original-sha256:'+originalSha}],max_output_tokens:32};
    const bodySha=await digestPayload(payload);
    const requestId='b22-'+worker+'-'+op.ordinal;
    const grantSha=await sha(encoder.encode(grant.payload_b64+'.'+grant.signature_b64));
    const auth=await sign(WORKLOAD_TEST_PRIVATE_JWK,{schema:'axiom.trackb16.s0.workload-auth.v1',audience:'axiom.trackb16.s0.reserve',
      account_id:env.AXIOM_ACCOUNT_ID,utc_day:day,tenant_id:'tenant-b22-synthetic',workload_id:worker,
      request_id:requestId,request_sha:bodySha,neurons:100,grant_sha256:grantSha,
      issued_at:now-3,expires_at:now+60,production_authority:false});
    const reservation={signed:grant,auth,request_id:requestId,request_sha:bodySha,neurons:100,tenant_id:'tenant-b22-synthetic',workload_id:worker};
    let result;
    try{
      result=await guardedDispatch({trustedEnv:env,request:reservation,payload,allowedModels:[MODEL],maxOutputTokens:32,
        now:()=>Date.now(),sendProvider:async bytes=>{
          // This callback is executed by B17 only AFTER B15/B16 authorized one
          // fresh reservation. Journal must durably commit BEFORE any transport.
          const journal=routeJournal(env);
          const issued=await journal.begin({account_id:env.AXIOM_ACCOUNT_ID,utc_day:day,
            request_id:requestId,tenant_id:'tenant-b22-synthetic',workload_id:worker,
            body_sha:bodySha,quota_grant_id:grantId});
          if(issued?.state!=='ISSUED'||issued.send_allowed!==true)throw Error('DUPLICATE_TRANSPORT_DENIED');
          const resultHash=await sha(bytes); // S0: no provider call or private data
          const completed=await journal.complete({request_id:requestId,body_sha:bodySha,result_sha:resultHash});
          if(completed?.state!=='COMPLETED')throw Error('OUTCOME_COMMIT_UNCERTAIN');
          return {synthetic_transport:true,canonical_body_sha256:resultHash};
        }});
    }catch(e){return deny((typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(e.code))?e.code:'GATE_FAILED');}
    if(result.status!=='COMPLETED'||result.provider_result?.synthetic_transport!==true)
      return reply({status:result.status,dispatch_allowed:false,reason:result.reason??'NO_TRANSPORT'},409);
    return reply({status:'COMPLETED',synthetic:true,request_id:requestId,
      canonical_body_sha256:result.provider_result.canonical_body_sha256,dispatch_allowed:false});
  }
};
