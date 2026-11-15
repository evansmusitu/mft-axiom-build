/** Typed fixture client. No SQL method, Cloudflare admin credential, redirects,
 * ambient credential lookup, automatic retry or production fallback.
 */
import {SCHEMA,H64,hold,exact,fixtureId,validateScope,canonical,sha} from './protocol.mjs';
export function isolatedStagingStore({pin,origin,token,fetchImpl=fetch,timeoutMs=5000}){
 const scope=validateScope(structuredClone(pin));
 let url;try{url=new URL(origin);}catch{hold('FRONTIER_STAGE_ORIGIN_HOLD');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||
  !/^axiom-frontier-stage-[a-z0-9-]{1,50}\.[a-z0-9-]{1,63}\.workers\.dev$/.test(url.hostname))
  hold('FRONTIER_STAGE_ORIGIN_HOLD');
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(token))hold('FRONTIER_STAGE_TOKEN_HOLD');
 if(!Number.isInteger(timeoutMs)||timeoutMs<200||timeoutMs>10000)hold('FRONTIER_STAGE_TIMEOUT_HOLD');
 const endpoint=url.origin;
 async function call(operation,input){
  fixtureId(input.tenant_id);if(operation!=='revoke')fixtureId(input.record_id);
  const payload={schema:SCHEMA,scope_nonce:scope.scope_nonce,...input},body=canonical(payload);
  if(new TextEncoder().encode(body).length>8192)hold('FRONTIER_STAGE_REQUEST_SIZE_HOLD');
  const abort=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();
   reject(Error('FRONTIER_STAGE_RESPONSE_AMBIGUOUS_HOLD'));},timeoutMs);});
  try{
   const response=await Promise.race([fetchImpl(endpoint+'/v1/staging/'+operation,{method:'POST',
    redirect:'manual',credentials:'omit',cache:'no-store',signal:abort.signal,
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},body}),deadline]);
   if(response.status!==200)hold('FRONTIER_STAGE_REMOTE_DENIAL_HOLD');
   const reader=response.body?.getReader();if(!reader)hold('FRONTIER_STAGE_REPLY_HOLD');
   let raw='',count=0,complete=false;const decoder=new TextDecoder('utf-8',{fatal:true});
   try{
    for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done){complete=true;break;}
     count+=next.value.byteLength;if(count>8192)hold('FRONTIER_STAGE_REPLY_SIZE_HOLD');
     raw+=decoder.decode(next.value,{stream:true});}
    raw+=decoder.decode();
   }finally{if(!complete)try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
   const value=JSON.parse(raw),base=['schema','scope_nonce','tenant_id','operation'];
   exact(value,operation==='revoke'?[...base,'revoked_token_sha256','revoked']:
    operation==='read'?[...base,'record_id','version','payload','payload_sha256']:
    [...base,'record_id','version','payload_sha256']);
   if(value.schema!==SCHEMA||value.scope_nonce!==scope.scope_nonce||value.tenant_id!==input.tenant_id||
    value.operation!==operation)hold('FRONTIER_STAGE_REPLY_BINDING_HOLD');
   if(operation==='revoke'){
    if(value.revoked!==true||value.revoked_token_sha256!==input.token_sha256)hold('FRONTIER_STAGE_REPLY_BINDING_HOLD');
   }else{
    if(value.record_id!==input.record_id||!Number.isSafeInteger(value.version)||value.version<1||
     !H64.test(value.payload_sha256))hold('FRONTIER_STAGE_REPLY_BINDING_HOLD');
    if(operation==='put'&&(value.version!==input.expected_version+1||value.payload_sha256!==await sha(canonical(input.payload))))
     hold('FRONTIER_STAGE_REPLY_BINDING_HOLD');
    if(operation==='read'&&value.payload_sha256!==await sha(canonical(value.payload)))hold('FRONTIER_STAGE_REPLY_BINDING_HOLD');
   }
   return Object.freeze(value);
  }catch{hold('FRONTIER_STAGE_UNCONFIRMED_NO_RETRY_HOLD');}
  finally{clearTimeout(timer);}
 }
 return Object.freeze({
  put:({tenant_id,record_id,expected_version,payload})=>call('put',{tenant_id,record_id,expected_version,payload}),
  read:({tenant_id,record_id})=>call('read',{tenant_id,record_id}),
  revoke:({tenant_id,token_sha256})=>call('revoke',{tenant_id,token_sha256})
 });
}
