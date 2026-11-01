/** Server-owned HTTPS client. No retries, cached permits, public-key discovery or local fallback. */
import {LEDGER_SCHEMA,LedgerDenied,deny,exact,id,digest,integer,publicKey,descriptor,canonicalJson,sha256Json,actionId,validateConsume,verifyEnvelope,fromB64,bytes} from './protocol.mjs';

function originOnly(value){
  let url;try{url=new URL(value);}catch{deny('INVALID_LEDGER_ORIGIN',400);}
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||!url.hostname.includes('.')||/^(?:\d|\[)/.test(url.hostname)||/\.(?:localhost|local|internal)$/.test(url.hostname)||url.hostname==='localhost')deny('EXTERNAL_HTTPS_ORIGIN_REQUIRED',400);
  return url.origin;
}
async function boundedReply(response,deadline){
  const reader=response.body?.getReader();if(!reader)deny('LEDGER_RESPONSE_MISSING');
  const decoder=new TextDecoder();let text='',size=0,done=false;
  try{for(;;){const x=await Promise.race([reader.read(),deadline]);if(x.done){done=true;break;}size+=x.value.byteLength;if(size>16384)deny('LEDGER_RESPONSE_TOO_LARGE');text+=decoder.decode(x.value,{stream:true});}return JSON.parse(text+decoder.decode());}
  catch(error){if(error instanceof LedgerDenied)throw error;deny('LEDGER_RESPONSE_INVALID');}
  finally{if(!done)void reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function createExternalLedgerClient({origin,ledger_id,genesis_id,key_id,grant_id,epoch,execution_artifact_sha256,public_key_jwk,token,readToken,fetchImpl=fetch,timeoutMs=5000}={}){
  origin=originOnly(origin);publicKey(public_key_jwk);
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(token))deny('CONSUMER_CREDENTIAL_REQUIRED',400);
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)deny('BOUNDED_LEDGER_TIMEOUT_REQUIRED',400);
  const reference=descriptor({ledger_id,genesis_id,key_id,grant_id,epoch,execution_artifact_sha256,authority_sha256:await sha256Json({origin,ledger_id,genesis_id,key_id,public_key_jwk})});
  const jwk=structuredClone(public_key_jwk),prepared=new Set();
  async function post(path,input,credential){
    const body=canonicalJson(input);if(new TextEncoder().encode(body).length>16384)deny('LEDGER_REQUEST_TOO_LARGE',400);
    let response,data,timer;const controller=new AbortController();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new LedgerDenied('LEDGER_TIMEOUT_AMBIGUOUS_HOLD',503));controller.abort();},timeoutMs);});
    try{response=await Promise.race([fetchImpl(origin+path,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json','cache-control':'no-store'},body,redirect:'error',credentials:'omit',signal:controller.signal}),deadline]);data=await boundedReply(response,deadline);}
    catch(error){if(error instanceof LedgerDenied)throw error;throw new LedgerDenied('LEDGER_TRANSPORT_AMBIGUOUS_HOLD',503);}
    finally{clearTimeout(timer);}
    if(response.status!==200){const error=new LedgerDenied('LEDGER_REMOTE_DENIED_HOLD',response.status);error.remote_code=/^[A-Z0-9_]{1,100}$/.test(data?.error??'')?data.error:'UNKNOWN';throw error;}
    return data;
  }
  return Object.freeze({reference:Object.freeze(structuredClone(reference)),
    async prepare({contract,admission_sha256,task_id,slot,action}){
      if(canonicalJson(contract?.policy?.external_ledger)!==canonicalJson(reference))deny('EXECUTION_LEDGER_DESCRIPTOR_MISMATCH');
      const request={grant_id,tenant_id:contract.tenant_id,work_id:contract.work_id,admission_sha256,contract_sha256:contract.contract_sha256,execution_artifact_sha256,epoch,slot,task_id,kind:action.kind,operation:action.operation??null,compute_calls:action.compute_calls,provider_calls:action.provider_calls,action_id:'',challenge:await sha256Json(crypto.randomUUID())};
      request.action_id=await actionId(request);await validateConsume(request);prepared.add(request.challenge);return Object.freeze(request);
    },
    async consume(request){
      await validateConsume(request);
      if(!prepared.delete(request.challenge))deny('FRESH_PREPARED_REQUEST_REQUIRED');
      const envelope=await post('/v1/consume',request,token);
      await verifyEnvelope(envelope,{jwk,reference,request});return structuredClone(envelope);
    },
    async verifyStored(request,envelope){await validateConsume(request);return verifyEnvelope(envelope,{jwk,reference,request,historical:true});},
    async inspect({tenant_id,action_id=null}){
      if(typeof readToken!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(readToken))deny('SEPARATE_READBACK_CREDENTIAL_REQUIRED');
      id(tenant_id,'TENANT');if(action_id!==null)digest(action_id,'ACTION');
      const challenge=await sha256Json(crypto.randomUUID()),envelope=await post('/v1/inspect',{grant_id,tenant_id,action_id,challenge},readToken);
      exact(envelope,['payload','signature'],'ENVELOPE');const p=envelope.payload;
      const key=await crypto.subtle.importKey('jwk',jwk,{name:'Ed25519'},false,['verify']);
      if(!await crypto.subtle.verify('Ed25519',key,fromB64(envelope.signature),bytes(p)))deny('LEDGER_SIGNATURE_INVALID');
      if(p.schema!==LEDGER_SCHEMA||p.operation!=='inspect'||p.dispatch_allowed!==false||p.challenge!==challenge||p.grant?.grant_id!==grant_id||p.grant?.tenant_id!==tenant_id)deny('READBACK_IDENTITY_MISMATCH');
      for(const k of ['ledger_id','genesis_id','key_id'])if(p[k]!==reference[k])deny('READBACK_TRUST_PIN_MISMATCH');
      integer(p.current_epoch);
      if(p.current_epoch<reference.epoch||p.grant.epoch!==reference.epoch||p.grant.execution_artifact_sha256!==reference.execution_artifact_sha256||!['ACTIVE','REVOKED'].includes(p.grant.state))deny('READBACK_GRANT_MISMATCH');
      const at=Date.parse(p.observed_at);if(!Number.isFinite(at)||Math.abs(Date.now()-at)>15000)deny('READBACK_NOT_FRESH');
      return envelope;
    },
  });
}

/** Explicit server policy; user payloads cannot select or disable this guard. */
export async function configuredExternalLedger(env,{tenant_id,work_id}={}){
  const flag=env.AXIOM_EXTERNAL_LEDGER_REQUIRED;
  if(flag===undefined||flag==='false'){
    if(env.AXIOM_EXTERNAL_LEDGER_CONFIG_JSON||env.AXIOM_EXTERNAL_LEDGER_CONSUMERS_JSON)deny('LEDGER_CONFIGURATION_CANNOT_BE_SILENTLY_IGNORED');
    return {required:false,client:null};
  }
  if(flag!=='true')deny('INVALID_LEDGER_REQUIRED_POLICY');
  id(tenant_id,'TENANT');id(work_id,'WORK');
  let config,consumers;try{config=JSON.parse(env.AXIOM_EXTERNAL_LEDGER_CONFIG_JSON);consumers=JSON.parse(env.AXIOM_EXTERNAL_LEDGER_CONSUMERS_JSON);}catch{deny('REQUIRED_EXTERNAL_LEDGER_CONFIGURATION_MISSING');}
  exact(config,['origin','ledger_id','genesis_id','key_id','execution_artifact_sha256','public_key_jwk'],'SERVER_CONFIG');
  const consumer=Object.hasOwn(consumers??{},tenant_id)?consumers[tenant_id]:null;
  const grant=Object.hasOwn(consumer?.grants??{},work_id)?consumer.grants[work_id]:null;
  if(!consumer||!grant)deny('NO_OPERATOR_APPROVED_WORK_GRANT');
  exact(consumer,['token','read_token','grants'],'CONSUMER');
  exact(grant,['grant_id','epoch'],'WORK_GRANT');
  const client=await createExternalLedgerClient({...config,...grant,token:consumer.token,readToken:consumer.read_token});
  return {required:true,client};
}
