/** Read-only active Cloudflare Worker deployment identity check.
 * Metadata is NOT byte-for-byte deployed source or independent custody proof.
 */
import {createHash} from 'node:crypto';
const ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
const SCRIPT='axiom-security-authority2-highwater';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=x=>createHash('sha256').update(x).digest('hex');
export class DeploymentHold extends Error {
 constructor(code){super(code);this.code=code;this.name='DeploymentHold';}
}
const hold=code=>{throw new DeploymentHold(code);};
export async function verifyAuthority2ActiveDeployment({
 account_id,token,fetchImpl=fetch,timeoutMs=5000
}={}){
 if(account_id!==ACCOUNT)hold('DEPLOYMENT_ACCOUNT_PIN_MISMATCH_HOLD');
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(token))
  hold('DEPLOYMENT_READ_CREDENTIAL_REQUIRED_HOLD');
 if(!Number.isInteger(timeoutMs)||timeoutMs<200||timeoutMs>10000)
  hold('DEPLOYMENT_TIMEOUT_POLICY_HOLD');
 const url=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/deployments?page=1&per_page=1`;
 const ctl=new AbortController();let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
   ctl.abort();reject(new DeploymentHold('DEPLOYMENT_PROVIDER_UNAVAILABLE_HOLD'));
 },timeoutMs);});
 let data;
 try{
  const response=await Promise.race([fetchImpl(url,{method:'GET',
    redirect:'manual',credentials:'omit',cache:'no-store',signal:ctl.signal,
    headers:{authorization:'Bearer '+token,accept:'application/json'}}),deadline]);
  if(response?.status!==200)hold('DEPLOYMENT_READBACK_DENIED_HOLD');
  let raw='';
  if(response.body&&typeof response.body.getReader==='function'){
   const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
   let size=0,done=false;
   try{
    for(;;){
     const chunk=await Promise.race([reader.read(),deadline]);
     if(chunk.done){done=true;break;}
     if(!(chunk.value instanceof Uint8Array))hold('DEPLOYMENT_REPLY_INVALID_HOLD');
     size+=chunk.value.byteLength;
     if(size>32768)hold('DEPLOYMENT_REPLY_INVALID_HOLD');
     try{raw+=decoder.decode(chunk.value,{stream:true});}
     catch{hold('DEPLOYMENT_REPLY_INVALID_HOLD');}
    }
    try{raw+=decoder.decode();}catch{hold('DEPLOYMENT_REPLY_INVALID_HOLD');}
   }finally{
    if(!done)try{void reader.cancel().catch(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
   }
  }else{
   raw=await Promise.race([response.text(),deadline]);
   if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>32768)
    hold('DEPLOYMENT_REPLY_INVALID_HOLD');
  }
  try{data=JSON.parse(raw);}catch{hold('DEPLOYMENT_REPLY_INVALID_HOLD');}
 }catch(e){if(e instanceof DeploymentHold)throw e;hold('DEPLOYMENT_PROVIDER_UNAVAILABLE_HOLD');}
 finally{clearTimeout(timer);}
 if(data?.success!==true||!Array.isArray(data.errors)||data.errors.length!==0||
   !Array.isArray(data.result?.deployments)||data.result.deployments.length!==1)
   hold('DEPLOYMENT_METADATA_INVALID_HOLD');
 const deployment=data.result.deployments[0];
 if(!UUID.test(deployment?.id??'')||deployment.strategy!=='percentage'||
    !Array.isArray(deployment.versions)||deployment.versions.length!==1||
    !UUID.test(deployment.versions[0]?.version_id??'')||
    deployment.versions[0].percentage!==100||
    !Number.isFinite(Date.parse(deployment.created_on)))
   hold('DEPLOYMENT_NOT_SINGLE_STABLE_VERSION_HOLD');
 return Object.freeze({
   status:'ACTIVE_DEPLOYMENT_METADATA_NOT_SOURCE_ATTESTATION',
   account_id:ACCOUNT,script_name:SCRIPT,
   deployment_id_sha256:SHA(deployment.id),
   active_version_id_sha256:SHA(deployment.versions[0].version_id),
   active_deployment_metadata_observed:true,
   active_deployment_source_qualified:false,
   independent_custody_verified:false,release_eligible:false
 });
}
