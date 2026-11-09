/** Server-owned HTTPS client. No retries, cached permits, public-key discovery or local fallback. */
import {LEDGER_SCHEMA,LedgerDenied,deny,exact,id,digest,integer,publicKey,descriptor,canonicalJson,sha256Json,actionId,validateConsume,verifyEnvelope,fromB64,bytes} from './protocol.mjs';

import {anchorPin,anchorCredential,verifyGithubCheckpoint} from './github-anchor.mjs';
import {highwaterPin,verifyExternalHighwaterReceipt} from '../security-authority2/external-highwater-fence.mjs';

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

export async function createExternalLedgerClient({origin,ledger_id,genesis_id,key_id,grant_id,epoch,execution_artifact_sha256,public_key_jwk,token,readToken,fetchImpl=fetch,timeoutMs=5000,github_anchor,anchorReadToken,anchorFetchImpl=fetch,highwater_pin,highwaterReadToken,highwaterFetchImpl=fetch}={}){
  origin=originOnly(origin);publicKey(public_key_jwk);
  const anchor=github_anchor===undefined?null:anchorPin(github_anchor);
  const highwater=highwater_pin===undefined?null:highwaterPin(highwater_pin);
  if(anchor)anchorCredential(anchorReadToken,'ANCHOR_READ_CREDENTIAL_REQUIRED',400);
  if(highwater){
    if(!anchor)deny('HIGHWATER_ANCHOR_REQUIRED_HOLD');
    if(typeof highwaterReadToken!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(highwaterReadToken))deny('HIGHWATER_SEPARATE_READ_CREDENTIAL_REQUIRED_HOLD');
  }else if(highwaterReadToken)deny('UNPINNED_HIGHWATER_CONFIG_HOLD');
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(token))deny('CONSUMER_CREDENTIAL_REQUIRED',400);
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)deny('BOUNDED_LEDGER_TIMEOUT_REQUIRED',400);
  const reference=descriptor({ledger_id,genesis_id,key_id,grant_id,epoch,execution_artifact_sha256,authority_sha256:await sha256Json({origin,ledger_id,genesis_id,key_id,public_key_jwk,...(anchor?{github_anchor:anchor}:{}),...(highwater?{highwater_pin:highwater}:{})})});
  const jwk=structuredClone(public_key_jwk),prepared=new Set();
  async function post(path,input,credential){
    const body=canonicalJson(input);if(new TextEncoder().encode(body).length>16384)deny('LEDGER_REQUEST_TOO_LARGE',400);
    let response,data,timer;const controller=new AbortController();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new LedgerDenied('LEDGER_TIMEOUT_AMBIGUOUS_HOLD',503));controller.abort();},timeoutMs);});
    try{response=await Promise.race([fetchImpl(origin+path,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json','cache-control':'no-store'},body,redirect:'manual',credentials:'omit',signal:controller.signal}),deadline]);data=await boundedReply(response,deadline);}
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
      await verifyEnvelope(envelope,{jwk,reference,request});
      if(anchor){await verifyGithubCheckpoint({pin:anchor,token:anchorReadToken,payload:envelope.payload,fetchImpl:anchorFetchImpl});await verifyEnvelope(envelope,{jwk,reference,request});}
      else if(envelope.payload.anchor)deny('UNPINNED_ANCHOR_PROOF');
      if(highwater)await verifyExternalHighwaterReceipt({pin:highwater,ledger_payload:envelope.payload,read_token:highwaterReadToken,fetchImpl:highwaterFetchImpl});
      else if(envelope.payload.highwater)deny('UNPINNED_HIGHWATER_PROOF');
      return structuredClone(envelope);
    },
    async verifyStored(request,envelope){await validateConsume(request);await verifyEnvelope(envelope,{jwk,reference,request,historical:true});if(anchor)await verifyGithubCheckpoint({pin:anchor,token:anchorReadToken,payload:envelope.payload,fetchImpl:anchorFetchImpl});else if(envelope.payload.anchor)deny('UNPINNED_ANCHOR_PROOF');if(highwater)await verifyExternalHighwaterReceipt({pin:highwater,ledger_payload:envelope.payload,read_token:highwaterReadToken,fetchImpl:highwaterFetchImpl});else if(envelope.payload.highwater)deny('UNPINNED_HIGHWATER_PROOF');return true;},
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
      if(anchor)await verifyGithubCheckpoint({pin:anchor,token:anchorReadToken,payload:p,fetchImpl:anchorFetchImpl});
      else if(p.anchor)deny('UNPINNED_ANCHOR_PROOF');
      if(highwater)await verifyExternalHighwaterReceipt({pin:highwater,ledger_payload:p,read_token:highwaterReadToken,fetchImpl:highwaterFetchImpl});
      else if(p.highwater)deny('UNPINNED_HIGHWATER_PROOF');
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
  exact(config,['origin','ledger_id','genesis_id','key_id','execution_artifact_sha256','public_key_jwk',...(Object.hasOwn(config,'github_anchor')?['github_anchor']:[]),...(Object.hasOwn(config,'highwater_pin')?['highwater_pin']:[])],'SERVER_CONFIG');
  const hwMode=env.AXIOM_HIGHWATER_REQUIRED;
  if(hwMode!==undefined&&!['true','false'].includes(hwMode))deny('INVALID_HIGHWATER_POLICY_HOLD');
  if(hwMode==='true'&&!config.highwater_pin)deny('REQUIRED_HIGHWATER_NOT_CONFIGURED_HOLD');
  if(config.highwater_pin&&hwMode!=='true')deny('HIGHWATER_CONFIG_CANNOT_BE_SILENTLY_IGNORED');
  const consumer=Object.hasOwn(consumers??{},tenant_id)?consumers[tenant_id]:null;
  const grant=Object.hasOwn(consumer?.grants??{},work_id)?consumer.grants[work_id]:null;
  if(!consumer||!grant)deny('NO_OPERATOR_APPROVED_WORK_GRANT');
  exact(consumer,['token','read_token','grants'],'CONSUMER');
  exact(grant,['grant_id','epoch'],'WORK_GRANT');
  const client=await createExternalLedgerClient({...config,...grant,token:consumer.token,readToken:consumer.read_token,anchorReadToken:env.AXIOM_GITHUB_ANCHOR_READ_TOKEN,highwaterReadToken:env.AXIOM_HIGHWATER_READ_TOKEN});
  return {required:true,client};
}
