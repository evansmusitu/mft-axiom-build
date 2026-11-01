/** Deploy only under the accepted independent operator. No remote deployment is performed here. */
import {LEDGER_SCHEMA,LedgerDenied,deny,exact,id,digest,integer,bytes,b64,sha256Json,canonicalJson,validateConsume} from './protocol.mjs';
const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers});
const roles=['bootstrap','grant','consume','read','revoke'];
async function body(request){
  if(request.headers.get('origin')||request.headers.get('cookie')||request.headers.get('sec-fetch-site'))deny('SERVER_CHANNEL_REQUIRED');
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))deny('JSON_REQUIRED',415);
  if(Number(request.headers.get('content-length')||0)>16384)deny('BODY_TOO_LARGE',413);
  const reader=request.body?.getReader();if(!reader)deny('BODY_REQUIRED',400);
  const decoder=new TextDecoder();let text='',size=0,timer,done=false;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new LedgerDenied('BODY_TIMEOUT',408)),5000);});
  try{for(;;){const next=await Promise.race([reader.read(),timeout]);if(next.done){done=true;break;}size+=next.value.byteLength;if(size>16384)deny('BODY_TOO_LARGE',413);text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();const value=JSON.parse(text);if(canonicalJson(value)!==text)deny('CANONICAL_BODY_REQUIRED',400);return value;}
  catch(error){if(error instanceof LedgerDenied)throw error;deny('INVALID_JSON',400);}
  finally{clearTimeout(timer);if(!done)void reader.cancel().catch(()=>{});else reader.releaseLock();}
}
function config(env){
  const c=JSON.parse(env.LEDGER_CONFIG_JSON||'null');
  exact(c,['ledger_id','genesis_id','key_id','execution_artifact_sha256'],'CONFIG');
  for(const k of ['ledger_id','genesis_id','key_id'])id(c[k],k);digest(c.execution_artifact_sha256,'ARTIFACT');return c;
}
async function principal(request,env,role){
  const match=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/);if(!match)deny('AUTHENTICATION_REQUIRED',401);
  const registry=JSON.parse(env.LEDGER_PRINCIPALS_JSON||'null');if(!registry||typeof registry!=='object'||Array.isArray(registry))deny('PRINCIPAL_REGISTRY_UNAVAILABLE',503);
  const hash=await sha256Json(match[1]),p=Object.hasOwn(registry,hash)?registry[hash]:null;
  if(!p)deny('AUTHENTICATION_REQUIRED',401);
  exact(p,['subject','tenant_id','roles'],'PRINCIPAL');id(p.subject,'SUBJECT');if(p.tenant_id!==null)id(p.tenant_id,'TENANT');
  if(!Array.isArray(p.roles)||p.roles.length!==1||p.roles.some(x=>!roles.includes(x)))deny('PRINCIPAL_REGISTRY_INVALID',503);
  if(!p.roles.includes(role)||role==='consume'&&p.tenant_id===null)deny('ROLE_DENIED');return p;
}
function scope(p,input){if(p.tenant_id!==null&&p.tenant_id!==input.tenant_id)deny('TENANT_DENIED');}
async function append(txn,meta,event){
  const previous=meta.head_sha256,hash=await sha256Json({previous_sha256:previous,event});
  meta={...meta,sequence:meta.sequence+1,head_sha256:hash};
  await txn.put('event/'+String(meta.sequence).padStart(12,'0'),{...event,previous_sha256:previous,chain_sha256:hash});
  await txn.put('meta',meta);return meta;
}
export class MonotonicLedger{
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.config=config(env);}
  async signed(payload){
    const jwk=JSON.parse(this.env.LEDGER_SIGNING_JWK||'null');
    if(jwk?.kty!=='OKP'||jwk?.crv!=='Ed25519'||typeof jwk.d!=='string'||jwk.alg&&!['EdDSA','Ed25519'].includes(jwk.alg))deny('SIGNER_UNAVAILABLE',503);
    // Node and workerd currently export different optional JWK alg labels.
    // The curve/algorithm are pinned explicitly; import only the key material.
    const key=await crypto.subtle.importKey('jwk',{kty:jwk.kty,crv:jwk.crv,x:jwk.x,d:jwk.d},{name:'Ed25519'},false,['sign']);
    return {payload,signature:b64(await crypto.subtle.sign('Ed25519',key,bytes(payload)))};
  }
  async fetch(request){
    try{
      const path=new URL(request.url).pathname;
      const role={'/v1/operator/bootstrap':'bootstrap','/v1/operator/grants':'grant','/v1/consume':'consume','/v1/inspect':'read','/v1/operator/revoke':'revoke','/v1/operator/epoch':'revoke'}[path];
      if(!role||request.method!=='POST')return json(404,{error:'ROUTE_NOT_FOUND'});
      const p=await principal(request,this.env,role),input=await body(request),now=Date.now(),at=new Date(now).toISOString(),c=this.config;
      const payload=await this.ctx.storage.transaction(async txn=>{
        let meta=await txn.get('meta');
        if(path==='/v1/operator/bootstrap'){
          if(this.env.LEDGER_ALLOW_BOOTSTRAP!=='true')deny('BOOTSTRAP_DISABLED');
          exact(input,['ledger_id','genesis_id','challenge'],'BOOTSTRAP');digest(input.challenge,'CHALLENGE');
          if(meta||input.ledger_id!==c.ledger_id||input.genesis_id!==c.genesis_id)deny('BOOTSTRAP_IDENTITY_OR_EXISTING_STATE_DENIED',409);
          meta={...c,epoch:1,sequence:0,head_sha256:await sha256Json(c),initialized_at:at};await txn.put('meta',meta);
          return {schema:LEDGER_SCHEMA,operation:'bootstrap',dispatch_allowed:false,challenge:input.challenge,...meta};
        }
        if(!meta)deny('LEDGER_NOT_INITIALIZED_HOLD',503);
        for(const k of Object.keys(c))if(meta[k]!==c[k])deny('LEDGER_IDENTITY_CHANGED_HOLD',503);
        if(meta.sequence>=1000000)deny('LEDGER_LIFETIME_LIMIT_HOLD',429);
        if(path==='/v1/operator/grants'){
          exact(input,['grant_id','tenant_id','work_id','admission_sha256','execution_artifact_sha256','epoch','max_actions','max_compute_calls','max_provider_calls','expires_at','challenge'],'GRANT');
          scope(p,input);for(const k of ['grant_id','tenant_id','work_id'])id(input[k],k);for(const k of ['admission_sha256','execution_artifact_sha256','challenge'])digest(input[k],k);
          for(const k of ['max_actions','max_compute_calls','max_provider_calls'])integer(input[k],10000);
          if(!input.max_actions||input.epoch!==meta.epoch||input.execution_artifact_sha256!==c.execution_artifact_sha256||!Number.isFinite(Date.parse(input.expires_at))||Date.parse(input.expires_at)<=now||Date.parse(input.expires_at)>now+86400000)deny('GRANT_POLICY_DENIED');
          const key='grant/'+input.tenant_id+'/'+input.grant_id;if(await txn.get(key))deny('GRANT_IMMUTABLE',409);
          const workKey='work/'+input.tenant_id+'/'+input.work_id;
          if(await txn.get(workKey))deny('WORK_AUTHORITY_ALREADY_ASSIGNED_HOLD',409);
          const grant={...input,state:'ACTIVE',sequence:0,compute_calls:0,provider_calls:0,contract_sha256:null,issued_by:p.subject,issued_at:at};await txn.put(key,grant);
          await txn.put(workKey,{grant_id:input.grant_id,admission_sha256:input.admission_sha256,execution_artifact_sha256:input.execution_artifact_sha256,epoch:input.epoch});
          meta=await append(txn,meta,{operation:'grant',request_sha256:await sha256Json(input),subject:p.subject,at});
          return {schema:LEDGER_SCHEMA,operation:'grant',dispatch_allowed:false,challenge:input.challenge,grant,ledger_sequence:meta.sequence,chain_sha256:meta.head_sha256};
        }
        if(path==='/v1/operator/epoch'){
          exact(input,['expected_epoch','challenge'],'EPOCH');digest(input.challenge,'CHALLENGE');
          if(p.tenant_id!==null||input.expected_epoch!==meta.epoch)deny('EPOCH_ADVANCE_DENIED',409);
          meta={...meta,epoch:meta.epoch+1};meta=await append(txn,meta,{operation:'epoch',subject:p.subject,epoch:meta.epoch,challenge:input.challenge,at});
          return {schema:LEDGER_SCHEMA,operation:'epoch',dispatch_allowed:false,challenge:input.challenge,epoch:meta.epoch,ledger_sequence:meta.sequence,chain_sha256:meta.head_sha256};
        }
        if(path==='/v1/consume')await validateConsume(input);
        else if(path==='/v1/operator/revoke')exact(input,['grant_id','tenant_id','expected_epoch','challenge'],'REVOKE');
        else exact(input,['grant_id','tenant_id','action_id','challenge'],'INSPECT');
        for(const k of ['grant_id','tenant_id'])id(input[k],k);digest(input.challenge,'CHALLENGE');scope(p,input);
        const key='grant/'+input.tenant_id+'/'+input.grant_id,grant=await txn.get(key);if(!grant)deny('GRANT_NOT_FOUND',404);
        if(path==='/v1/inspect'){
          if(input.action_id!==null)digest(input.action_id,'ACTION');
          const consumed=input.action_id?await txn.get('consume/'+input.tenant_id+'/'+input.grant_id+'/'+input.action_id):null;
          return {schema:LEDGER_SCHEMA,operation:'inspect',dispatch_allowed:false,challenge:input.challenge,ledger_id:meta.ledger_id,genesis_id:meta.genesis_id,key_id:meta.key_id,current_epoch:meta.epoch,grant,consumed:consumed?{request_sha256:consumed.request_sha256,slot:consumed.slot,grant_sequence:consumed.grant_sequence,chain_sha256:consumed.chain_sha256}:null,ledger_sequence:meta.sequence,chain_sha256:meta.head_sha256,observed_at:at};
        }
        if(path==='/v1/operator/revoke'){
          if(input.expected_epoch!==meta.epoch||grant.state!=='ACTIVE')deny('REVOCATION_EPOCH_OR_STATE_DENIED',409);
          await txn.put(key,{...grant,state:'REVOKED'});meta=await append(txn,meta,{operation:'revoke',grant_id:input.grant_id,subject:p.subject,at});
          return {schema:LEDGER_SCHEMA,operation:'revoke',dispatch_allowed:false,challenge:input.challenge,grant_id:input.grant_id,state:'REVOKED',ledger_sequence:meta.sequence,chain_sha256:meta.head_sha256};
        }
        for(const k of ['tenant_id','work_id','admission_sha256','execution_artifact_sha256','epoch'])if(input[k]!==grant[k])deny('GRANT_BINDING_MISMATCH');
        if(meta.epoch!==input.epoch||grant.state!=='ACTIVE'||Date.parse(grant.expires_at)<=now)deny('GRANT_EXPIRED_OR_REVOKED');
        if(grant.contract_sha256&&grant.contract_sha256!==input.contract_sha256)deny('CONTRACT_REBIND_DENIED');
        const consumedKey='consume/'+input.tenant_id+'/'+input.grant_id+'/'+input.action_id;
        if(await txn.get(consumedKey))deny('ALREADY_CONSUMED_HOLD',409);
        if(input.slot!==grant.sequence)deny('MONOTONIC_SEQUENCE_MISMATCH_HOLD',409);
        if(grant.sequence+1>grant.max_actions||grant.compute_calls+input.compute_calls>grant.max_compute_calls||grant.provider_calls+input.provider_calls>grant.max_provider_calls)deny('GRANT_CALL_BUDGET_EXHAUSTED',429);
        const requestHash=await sha256Json(input);
        meta=await append(txn,meta,{operation:'consume',request_sha256:requestHash,subject:p.subject,at});
        const receipt={schema:LEDGER_SCHEMA,operation:'consume',decision:'ALLOW_ONCE',dispatch_allowed:true,ledger_id:meta.ledger_id,genesis_id:meta.genesis_id,key_id:meta.key_id,epoch:meta.epoch,grant_id:grant.grant_id,tenant_id:grant.tenant_id,work_id:grant.work_id,action_id:input.action_id,request_sha256:requestHash,challenge:input.challenge,slot:input.slot,grant_sequence:grant.sequence+1,ledger_sequence:meta.sequence,chain_sha256:meta.head_sha256,issued_at:at,valid_until:new Date(now+15000).toISOString()};
        await txn.put(consumedKey,receipt);
        await txn.put(key,{...grant,contract_sha256:input.contract_sha256,sequence:grant.sequence+1,compute_calls:grant.compute_calls+input.compute_calls,provider_calls:grant.provider_calls+input.provider_calls});
        return receipt;
      });
      // Signing occurs after durable commit. A signing/response failure never refunds consumption.
      await this.ctx.storage.sync();return json(200,await this.signed(payload));
    }catch(error){return json(error instanceof LedgerDenied?error.status:503,{error:error instanceof LedgerDenied?error.code:'LEDGER_UNAVAILABLE_HOLD',dispatch_allowed:false});}
  }
}
export default {async fetch(request,env){
  try{const c=config(env),stub=env.LEDGER_STATE.get(env.LEDGER_STATE.idFromName('ledger/'+c.ledger_id));return await stub.fetch(request);}catch{return json(503,{error:'LEDGER_UNAVAILABLE_HOLD',dispatch_allowed:false});}
}};
