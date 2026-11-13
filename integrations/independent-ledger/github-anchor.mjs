/** Opt-in provider fence. Mutable release notes and local high-water caches are never proof. */
import {deny,exact,integer,canonicalJson,sha256Json} from './protocol.mjs';
const SCHEMA='musitu.axiom.github-checkpoint.v1';
export function anchorCredential(token,code='ANCHOR_CREDENTIAL_REQUIRED',status=503){
  if(typeof token!=='string'||token.length<20||token.length>8192||!(/^[A-Za-z0-9._~+\/-]+={0,2}$/).test(token))deny(code,status);
  return token;
}
export function anchorPin(value){
  exact(value,['repository','repository_id','namespace','target_commitish'],'ANCHOR_PIN');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)||value.repository.includes('..')||!Number.isSafeInteger(value.repository_id)||value.repository_id<1||!/^ax-[a-z0-9-]{1,60}$/.test(value.namespace)||!(/^[0-9a-f]{40}$/).test(value.target_commitish))deny('INVALID_ANCHOR_PIN',400);
  return Object.freeze(structuredClone(value));
}
export function checkpointTag(pin,payload){integer(payload.ledger_sequence??payload.sequence);return pin.namespace+'-'+String(payload.ledger_sequence??payload.sequence).padStart(12,'0');}
function content(pin,payload){const {anchor,highwater,...unanchored}=payload;return canonicalJson({schema:SCHEMA,pin,payload:unanchored});}
async function contentDigest(pin,payload){return 'sha256:'+await sha256Json(JSON.parse(content(pin,payload)));}
function transport(pin,token,fetchImpl){
  anchorCredential(token);
  const root='/repos/'+pin.repository;
  return async(method,path,body,upload=false)=>{
    if(!path.startsWith(root+'/')&&path!==root)deny('ANCHOR_REPOSITORY_SCOPE_DENIED');
    let timer;const controller=new AbortController();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('deadline'));},10000);});
    try{
      const response=await Promise.race([fetchImpl((upload?'https://uploads.github.com':'https://api.github.com')+path,{method,redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'musitu-axiom-checkpoint','x-github-api-version':'2022-11-28',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:upload?body:JSON.stringify(body)})}),deadline]);
      const reader=response.body?.getReader(),decoder=new TextDecoder();let text='',size=0;
      if(reader){try{for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;size+=next.value.byteLength;if(size>131072)deny('ANCHOR_REPLY_TOO_LARGE_HOLD',503);text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}}
      let data;try{data=JSON.parse(text);}catch{deny('ANCHOR_REPLY_INVALID_HOLD',503);}
      return {status:response.status,data};
    }catch(error){if(error?.code)throw error;deny('ANCHOR_TRANSPORT_AMBIGUOUS_HOLD',503);}
    finally{clearTimeout(timer);}
  };
}
function successful(reply,status){if(reply.status!==status)deny('ANCHOR_WRITE_UNCONFIRMED_HOLD',503);return reply.data;}
async function identity(api,pin){const repo=successful(await api('GET','/repos/'+pin.repository),200);if(repo.id!==pin.repository_id||repo.full_name!==pin.repository||repo.archived===true)deny('ANCHOR_REPOSITORY_IDENTITY_CHANGED_HOLD',503);
  // Checkpoint payloads can contain tenant/action evidence. Never publish
  // or accept them through a public or visibility-unknown repository.
  if(repo.private!==true)deny('ANCHOR_REPOSITORY_PRIVACY_HOLD',503);}
async function verify(api,pin,payload,proof){
  exact(proof,['schema','repository_id','namespace','tag','release_id','asset_digest'],'ANCHOR_PROOF');
  const tag=checkpointTag(pin,payload),digest=await contentDigest(pin,payload);
  if(proof.schema!==SCHEMA||proof.repository_id!==pin.repository_id||proof.namespace!==pin.namespace||proof.tag!==tag||proof.asset_digest!==digest||!Number.isSafeInteger(proof.release_id)||proof.release_id<1)deny('ANCHOR_BINDING_MISMATCH_HOLD',503);
  const root='/repos/'+pin.repository,r=successful(await api('GET',root+'/releases/'+proof.release_id),200);
  const size=new TextEncoder().encode(content(pin,payload)).length;
  if(r.id!==proof.release_id||r.immutable!==true||r.draft!==false||r.tag_name!==tag||r.assets?.length!==1||r.assets[0].name!=='checkpoint.json'||r.assets[0].state!=='uploaded'||r.assets[0].size!==size||r.assets[0].digest!==digest)deny('ANCHOR_IMMUTABLE_PROOF_MISSING_HOLD',503);
  const ref=successful(await api('GET',root+'/git/ref/tags/'+tag),200);
  if(ref.ref!=='refs/tags/'+tag||ref.object?.type!=='commit'||ref.object.sha!==pin.target_commitish)deny('ANCHOR_TARGET_CHANGED_HOLD',503);
  return true;
}
export async function publishGithubCheckpoint({pin,token,payload,fetchImpl=fetch}){
  pin=anchorPin(pin);const api=transport(pin,token,fetchImpl),root='/repos/'+pin.repository,tag=checkpointTag(pin,payload);
  await identity(api,pin);
  const bytes=content(pin,payload);if(new TextEncoder().encode(bytes).length>32768)deny('ANCHOR_EVENT_TOO_LARGE_HOLD',503);
  const draft=successful(await api('POST',root+'/releases',{tag_name:tag,target_commitish:pin.target_commitish,name:'Axiom commitment checkpoint',body:'Commitment-only qualification/authority evidence. Not a product release.',draft:true,prerelease:true,make_latest:'false'}),201);
  if(!Number.isSafeInteger(draft.id)||draft.id<1||draft.tag_name!==tag||draft.draft!==true)deny('ANCHOR_DRAFT_INVALID_HOLD',503);
  successful(await api('POST',root+'/releases/'+draft.id+'/assets?name=checkpoint.json',bytes,true),201);
  successful(await api('PATCH',root+'/releases/'+draft.id,{draft:false,prerelease:true,make_latest:'false'}),200);
  const proof={schema:SCHEMA,repository_id:pin.repository_id,namespace:pin.namespace,tag,release_id:draft.id,asset_digest:await contentDigest(pin,payload)};
  await verify(api,pin,payload,proof);
  // Close same-name repository replacement between initial pin check and proof.
  await identity(api,pin);return proof;
}
export async function verifyGithubCheckpoint({pin,token,payload,fetchImpl=fetch}){
  pin=anchorPin(pin);const api=transport(pin,token,fetchImpl);await identity(api,pin);
  await verify(api,pin,payload,payload.anchor);
  // A valid release proof from a newly replaced same-name repository cannot
  // inherit the original repository's trusted identity.
  await identity(api,pin);return true;
}
