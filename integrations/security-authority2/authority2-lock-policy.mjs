/** Provider-origin, READ-ONLY R2 lock preflight for Security Authority 2.
 * No setup, mutation, deployment, or claim of administrator-proof retention.
 */
const EXPECTED_ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
const EXPECTED_BUCKET='musitu-axiom-authority2-worm';
const TOKEN=/^[A-Za-z0-9_-]{32,200}$/;
export class LockPolicyHold extends Error {constructor(code){super(code);this.name='LockPolicyHold';this.code=code;}}
const hold=code=>{throw new LockPolicyHold(code);};
export async function verifyAuthority2R2LockPolicy({account_id,bucket_name,token,fetchImpl=fetch,timeoutMs=5000}={}){
  if(account_id!==EXPECTED_ACCOUNT)hold('ACCOUNT_PIN_MISMATCH_HOLD');
  if(bucket_name!==EXPECTED_BUCKET)hold('BUCKET_PIN_MISMATCH_HOLD');
  if(typeof token!=='string'||!TOKEN.test(token))hold('READ_ONLY_CREDENTIAL_REQUIRED_HOLD');
  if(!Number.isInteger(timeoutMs)||timeoutMs<200||timeoutMs>10000)hold('INVALID_POLICY_TIMEOUT_HOLD');
  // Never follow redirects or use a user-selected host: only Cloudflare's API.
  const url=`https://api.cloudflare.com/client/v4/accounts/${EXPECTED_ACCOUNT}/r2/buckets/${bucket_name}/lock`;
  const ctl=new AbortController();const timeout=setTimeout(()=>ctl.abort(),timeoutMs);
  let data;
  try{
    const response=await fetchImpl(url,{method:'GET',headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'manual',credentials:'omit',cache:'no-store',signal:ctl.signal});
    if(response?.status!==200)hold('PROVIDER_LOCK_READBACK_DENIED_HOLD');
    const raw=await response.text();
    if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>16384)hold('PROVIDER_LOCK_REPLY_INVALID_HOLD');
    try{data=JSON.parse(raw);}catch{hold('PROVIDER_LOCK_REPLY_INVALID_HOLD');}
  }catch(error){if(error instanceof LockPolicyHold)throw error;hold('PROVIDER_LOCK_UNAVAILABLE_HOLD');}
  finally{clearTimeout(timeout);}
  if(data?.success!==true||!Array.isArray(data.errors)||data.errors.length!==0||!Array.isArray(data.result?.rules))hold('PROVIDER_LOCK_REPLY_INVALID_HOLD');
  const rule=data.result.rules.find(r=>r?.enabled===true&&r.condition?.type==='Indefinite'&&
    (r.prefix===undefined||r.prefix===''||r.prefix==='b27/')&&typeof r.id==='string'&&r.id.length>0);
  if(!rule)hold('INDEFINITE_POLICY_MISSING_HOLD');
  return Object.freeze({status:'POLICY_READBACK_VERIFIED_NOT_INDEPENDENT_CUSTODY',account_id:EXPECTED_ACCOUNT,bucket_name,
    rule_id:rule.id,scope:'b27/',retention:'Indefinite',admin_removable:true,
    verification_limit:'Cloudflare lock rule can be deleted by a sufficiently privileged administrator'});
}
