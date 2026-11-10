/** Cloudflare-origin Worker SETTINGS preflight; never source-download or mutate.
 * Binding metadata is NOT deployed-byte attestation or signer custody evidence.
 */
const ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
const SCRIPT='axiom-security-authority2-highwater';
const BUCKET='musitu-axiom-authority2-worm';
const REQUIRED=new Map([
 ['HIGHWATER_STATE','durable_object_namespace'],
 ['HIGHWATER_WORM','r2_bucket'],
 ['HW_CONFIG_JSON','secret_text'],
 ['HW_ROLE_TOKEN_SHA256_JSON','secret_text'],
 ['HW_SIGNING_JWK','secret_text']
]);
export class WorkerBindingHold extends Error{
 constructor(code){super(code);this.name='WorkerBindingHold';this.code=code;}
}
const hold=code=>{throw new WorkerBindingHold(code);};
export async function verifyAuthority2WorkerBindings({
 account_id,token,fetchImpl=fetch,timeoutMs=5000
}={}){
 if(account_id!==ACCOUNT)hold('WORKER_ACCOUNT_PIN_MISMATCH_HOLD');
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(token))
   hold('WORKER_READ_CREDENTIAL_REQUIRED_HOLD');
 if(!Number.isInteger(timeoutMs)||timeoutMs<200||timeoutMs>10000)
   hold('WORKER_TIMEOUT_POLICY_HOLD');
 const url=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/settings`;
 const ctrl=new AbortController();let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
   ctrl.abort();reject(new WorkerBindingHold('WORKER_PROVIDER_UNAVAILABLE_HOLD'));
 },timeoutMs);});
 let data;
 try{
  const response=await Promise.race([fetchImpl(url,{method:'GET',redirect:'manual',
   credentials:'omit',cache:'no-store',headers:{authorization:'Bearer '+token,accept:'application/json'},signal:ctrl.signal}),deadline]);
  if(response?.status!==200)hold('WORKER_SETTINGS_READBACK_DENIED_HOLD');
  let raw='';
  if(response.body&&typeof response.body.getReader==='function'){
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
    let count=0,done=false;
    try{
      for(;;){
       const part=await Promise.race([reader.read(),deadline]);
       if(part.done){done=true;break;}
       if(!(part.value instanceof Uint8Array))hold('WORKER_SETTINGS_REPLY_INVALID_HOLD');
       count+=part.value.byteLength;
       if(count>32768)hold('WORKER_SETTINGS_REPLY_INVALID_HOLD');
       try{raw+=decoder.decode(part.value,{stream:true});}catch{hold('WORKER_SETTINGS_REPLY_INVALID_HOLD');}
      }
      try{raw+=decoder.decode();}catch{hold('WORKER_SETTINGS_REPLY_INVALID_HOLD');}
    }finally{
      if(!done)try{void reader.cancel().catch(()=>{});}catch{}
      try{reader.releaseLock();}catch{}
    }
  }else{
    raw=await Promise.race([response.text(),deadline]);
    if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>32768)
      hold('WORKER_SETTINGS_REPLY_INVALID_HOLD');
  }
  try{data=JSON.parse(raw);}catch{hold('WORKER_SETTINGS_REPLY_INVALID_HOLD');}
 }catch(e){if(e instanceof WorkerBindingHold)throw e;hold('WORKER_PROVIDER_UNAVAILABLE_HOLD');}
 finally{clearTimeout(timer);}
 if(data?.success!==true||!Array.isArray(data.errors)||data.errors.length!==0||
    !Array.isArray(data.result?.bindings))hold('WORKER_SETTINGS_REPLY_INVALID_HOLD');
 const seen=new Set();
 for(const binding of data.result.bindings){
  if(!binding||typeof binding.name!=='string'||seen.has(binding.name)||!REQUIRED.has(binding.name))
    hold('WORKER_UNEXPECTED_BINDING_HOLD');
  seen.add(binding.name);
  if(binding.type!==REQUIRED.get(binding.name))hold('WORKER_BINDING_TYPE_MISMATCH_HOLD');
  if(binding.name==='HIGHWATER_STATE'&&(binding.class_name!=='Authority2Highwater'||
    binding.script_name&&binding.script_name!==SCRIPT))
    hold('WORKER_DURABLE_OBJECT_IDENTITY_HOLD');
  if(binding.name==='HIGHWATER_WORM'&&binding.bucket_name!==BUCKET)
    hold('WORKER_R2_BUCKET_IDENTITY_HOLD');
 }
 if(seen.size!==REQUIRED.size)hold('WORKER_REQUIRED_BINDING_MISSING_HOLD');
 return Object.freeze({
  status:'WORKER_METADATA_READBACK_NOT_RELEASE',account_id:ACCOUNT,
  script_name:SCRIPT,bucket_name:BUCKET,checked_binding_count:seen.size,
  secret_values_exposed:false,active_deployment_verified:false,
  signer_custody_verified:false,release_eligible:false
 });
}
