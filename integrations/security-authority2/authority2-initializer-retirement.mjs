/** GET-only retirement METADATA check. Not source-byte, route, custody or B27 attestation.
 * Expected version ID and opaque provider ETag must come from independently
 * retained, reviewed operator upload evidence. Never assume ETag is bundle SHA.
 */
import {createHash} from 'node:crypto';
import {verifyAuthority2ActiveDeployment} from './authority2-active-deployment.mjs';
import {verifyAuthority2WorkerBindings,validateAuthority2BindingList} from './authority2-worker-bindings.mjs';
const ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
const SCRIPT='axiom-security-authority2-highwater';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
class RetirementHold extends Error{constructor(code){super(code);this.code=code;}}
const hold=code=>{throw new RetirementHold(code);};
async function getJSON(path,token,fetchImpl,timeoutMs){
 let timer;const abort=new AbortController();
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();
  reject(new RetirementHold('A2_RETIREMENT_READ_AMBIGUOUS_HOLD'));},timeoutMs);});
 try{
  const r=await Promise.race([fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
    '/workers/scripts/'+SCRIPT+path,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',
    signal:abort.signal,headers:{authorization:'Bearer '+token,accept:'application/json'}}),deadline]);
  if(r?.status!==200)hold('A2_RETIREMENT_READ_DENIED_HOLD');
  const reader=r.body?.getReader();if(!reader)hold('A2_RETIREMENT_REPLY_INVALID_HOLD');
  let raw='',count=0,complete=false;const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
   for(;;){const p=await Promise.race([reader.read(),deadline]);if(p.done){complete=true;break;}
    if(!(p.value instanceof Uint8Array))hold('A2_RETIREMENT_REPLY_INVALID_HOLD');
    count+=p.value.byteLength;if(count>32768)hold('A2_RETIREMENT_REPLY_OVERSIZE_HOLD');
    raw+=decoder.decode(p.value,{stream:true});}
   raw+=decoder.decode();
  }finally{if(!complete)try{void reader.cancel().catch(()=>{});}catch{}
   try{reader.releaseLock();}catch{}}
  let data;try{data=JSON.parse(raw);}catch{hold('A2_RETIREMENT_REPLY_INVALID_HOLD');}
  if(data?.success!==true||!Array.isArray(data.errors)||data.errors.length||!data.result)
   hold('A2_RETIREMENT_REPLY_INVALID_HOLD');
  return data.result;
 }catch(e){if(e instanceof RetirementHold)throw e;hold('A2_RETIREMENT_READ_AMBIGUOUS_HOLD');}
 finally{clearTimeout(timer);}
}
export async function verifyAuthority2InitializerRetirement({account_id,token,expected_version_id,
 expected_script_etag,fetchImpl=fetch,timeoutMs=5000}={}){
 if(account_id!==ACCOUNT)hold('A2_RETIREMENT_ACCOUNT_PIN_HOLD');
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(token))hold('A2_RETIREMENT_READ_CREDENTIAL_HOLD');
 if(typeof expected_version_id!=='string'||!UUID.test(expected_version_id)||
   typeof expected_script_etag!=='string'||expected_script_etag.length<1||
   expected_script_etag.length>200||!/^[A-Za-z0-9._:"-]+$/.test(expected_script_etag))
  hold('A2_RETIREMENT_OPERATOR_VERSION_PIN_HOLD');
 if(!Number.isInteger(timeoutMs)||timeoutMs<200||timeoutMs>10000)hold('A2_RETIREMENT_TIMEOUT_POLICY_HOLD');
 const args={account_id,token,fetchImpl,timeoutMs};
 const before=await verifyAuthority2ActiveDeployment(args);
 if(before.active_version_id_sha256!==sha(expected_version_id))hold('A2_RETIREMENT_ACTIVE_VERSION_MISMATCH_HOLD');
 await verifyAuthority2WorkerBindings(args);
 const version=await getJSON('/versions/'+expected_version_id,token,fetchImpl,timeoutMs);
 if(version.id!==expected_version_id||version.resources?.script?.etag!==expected_script_etag)
  hold('A2_RETIREMENT_VERSION_ETAG_HOLD');
 validateAuthority2BindingList(version.resources.bindings);
 const script=version.resources.script;
 if(!Array.isArray(script.handlers)||script.handlers.length!==1||script.handlers[0]!=='fetch'||
   !Array.isArray(script.named_handlers)||script.named_handlers.length!==1||
   script.named_handlers[0]?.name!=='Authority2Highwater'||
   !Array.isArray(script.named_handlers[0].handlers)||
   script.named_handlers[0].handlers.length!==1||script.named_handlers[0].handlers[0]!=='fetch')
  hold('A2_RETIREMENT_INITIALIZER_HANDLER_PRESENT_HOLD');
 const schedules=await getJSON('/schedules',token,fetchImpl,timeoutMs);
 if(!Array.isArray(schedules.schedules)||schedules.schedules.length)
  hold('A2_RETIREMENT_SCHEDULES_REMAIN_HOLD');
 const subdomain=await getJSON('/subdomain',token,fetchImpl,timeoutMs);
 if(subdomain.enabled!==false||subdomain.previews_enabled!==false)
  hold('A2_RETIREMENT_PUBLIC_PREVIEW_ENABLED_HOLD');
 const after=await verifyAuthority2ActiveDeployment(args);
 if(after.deployment_id_sha256!==before.deployment_id_sha256||
   after.active_version_id_sha256!==before.active_version_id_sha256)
  hold('A2_RETIREMENT_DEPLOYMENT_CHANGED_HOLD');
 return Object.freeze({schema:'musitu.axiom.authority2.initializer-retirement-metadata.v1',
  status:'RETIRED_INITIALIZER_METADATA_ONLY_NOT_RELEASE',account_id:ACCOUNT,script_name:SCRIPT,
  active_version_id_sha256:before.active_version_id_sha256,provider_etag_sha256:sha(expected_script_etag),
  temporary_bindings_absent:true,scheduled_handler_absent:true,cron_triggers_absent:true,
  workers_dev_and_previews_disabled:true,source_bytes_independently_qualified:false,
  custom_route_absence_qualified:false,independent_custody_qualified:false,
  provider_writes:0,release_eligible:false});
}
