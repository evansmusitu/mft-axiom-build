/**
 * MUSITU AXIOM Gate 1 — owner-device Cloudflare Free account GET-only preflight.
 * Uses Node.js 20+ (installed on user's Windows machine). Does NOT require
 * Python, WSL, Docker, GitHub Actions secrets or private key material.
 *
 * WARNING: A positive metadata read is neither an independently proven Free
 * plan nor an authorization for account creation, D1 restoration or payment.
 * Signer trust roots, MFA, customer consent and zero-cost guarantee remain NO_GO.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCOUNT = '93f395f5121954671f92fffa453d6b61';
const SOURCE = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
const ID = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const MAX = 100000;
const DEFAULT_OUT='axiom_gate1_free_account_readonly_NO_GO_20261114.json';
const sha = b => createHash('sha256').update(b).digest('hex');
export class NoGo extends Error {
  constructor(code){super(code);this.name='NoGo';this.code=code;}
}
function demand(ok,code){if(!ok)throw new NoGo(code);}
function validateAccount(account){
  demand(typeof account === 'string' && ID.test(account),'INVALID_OWNER_FREE_ACCOUNT_ID');
  demand(account !== ACCOUNT,'PAID_ORIGINAL_ACCOUNT_REUSE_FORBIDDEN');
  return account;
}
function validateToken(token){
  demand(typeof token==='string'&&token.length>=6&&token.length<10000&&!/[\r\n]/.test(token),'NEW_ACCOUNT_READ_TOKEN_MISSING');
  return token;
}
function paths(account){return [
  `/accounts/${account}`,
  `/accounts/${account}/subscriptions`,
  `/accounts/${account}/d1/database?page=1&per_page=100`,
];}
async function exactProviderGet(account,token,path){
  demand(paths(account).includes(path),'UNAPPROVED_PROVIDER_PATH');
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(16000),
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},
  }).catch(()=>{throw new NoGo('PROVIDER_CONNECTION_UNAVAILABLE');});
  demand(response.status===200,'PROVIDER_HTTP_'+String(response.status));
  const len=Number(response.headers.get('content-length'));
  demand(!Number.isFinite(len)||len<=MAX,'PROVIDER_RESPONSE_TOO_LARGE');
  // Bound streamed response before constructing JSON (no raw provider payloads in logs).
  const reader=response.body?.getReader();
  demand(!!reader,'PROVIDER_BODY_MISSING');
  const chunks=[];let total=0;
  while(true){
    const {done,value}=await reader.read().catch(()=>{throw new NoGo('PROVIDER_BODY_READ_ERROR');});
    if(done)break;
    total+=value.byteLength;
    if(total>MAX){await reader.cancel();throw new NoGo('PROVIDER_RESPONSE_TOO_LARGE');}
    chunks.push(value);
  }
  const bytes=Buffer.concat(chunks.map(x=>Buffer.from(x)));
  let data;
  try{data=JSON.parse(bytes.toString('utf8'));}catch{throw new NoGo('PROVIDER_JSON_INVALID');}
  return data;
}
/**
 * The injectable getter is only a test seam. Caller-supplied account is never
 * used as URL until it passes the strict, original-account-different guard.
 */
export async function audit({account,token,get=null,now=new Date()}={}){
  validateAccount(account);validateToken(token);
  demand(now instanceof Date && Number.isFinite(now.getTime()),'INVALID_CLOCK');
  const allowed=paths(account);
  const fetcher=get??(path=>exactProviderGet(account,token,path));
  const receipt={
    schema:'musitu.axiom.step1.free-account-windows-readonly.v1',
    checked_at_utc:now.toISOString(),
    account_id_sha256:sha(Buffer.from(account,'ascii')),
    source_account_unchanged:true,source_database_unchanged:true,
    provider_operation:'EXACT_THREE_GET_ONLY_NO_SQL_NO_MUTATION',
    account_metadata_http:'UNREAD',account_identity_verified:false,
    subscriptions_http:'UNREAD',active_paid_subscriptions_absent:false,
    workers_free_plan_independently_verified:false,
    d1_catalog_http:'UNREAD',d1_catalog_complete:false,
    d1_database_count:null,isolation_candidate_empty:false,
    known_source_size_20261113_bytes:356352,
    known_source_below_published_free_single_db_limit:true,
    owner_free_account_no_payment_method_verified:false,
    free_account_other_products_billable_absence_verified:false,
    free_account_import_row_writes_limit_checked:false,
    free_account_tenant_identity_and_mfa_qualified:false,
    owner_mfa_independently_qualified:false,
    owner_public_trust_pins_independently_activated:false,
    owner_operation_specific_signed_permission:false,
    provider_hard_zero_additional_spend_verified:false,
    new_account_creation_authorized:false,d1_creation_authorized:false,
    customer_export_authorized:false,customer_restore_authorized:false,
    gate1_closed:false,step1_closed:false,step2_authorized:false,
    release_authorized:false,release_status:'NOT_RELEASE',
    status:'CANDIDATE_METADATA_READ_ONLY_GATE1_OPEN_NO_GO',
  };
  const read=async (path,field)=>{
    demand(allowed.includes(path),'GET_PATH_NOT_ALLOWED');
    try{
      const obj=await fetcher(path);
      demand(obj && typeof obj==='object' && !Array.isArray(obj)&&obj.success===true,'BAD_PROVIDER_ENVELOPE');
      receipt[field]=200;
      return obj;
    }catch(e){
      receipt[field]=e instanceof NoGo?e.code:'PROVIDER_RESPONSE_UNAVAILABLE';
      return null;
    }
  };
  const a=await read(allowed[0],'account_metadata_http');
  receipt.account_identity_verified=!!(a && a.result&&typeof a.result==='object'&&a.result.id===account);
  const s=await read(allowed[1],'subscriptions_http');
  if(s){
    const items=s.result;
    if(Array.isArray(items)&&items.length<=1000&&items.every(x=>x&&typeof x==='object'&&!Array.isArray(x))){
      const inactive=new Set(['Cancelled','Expired','Failed','Inactive','Free']);
      receipt.active_paid_subscriptions_absent=items.every(x=>typeof x.state==='string'&&inactive.has(x.state));
    }else receipt.subscriptions_http='SUBSCRIPTIONS_INCOMPLETE_OR_INVALID';
  }
  const c=await read(allowed[2],'d1_catalog_http');
  if(c){
    const items=c.result,info=c.result_info;
    let complete=Array.isArray(items)&&items.length<=100&&info&&typeof info==='object'&&!Array.isArray(info);
    complete=complete&&['page','per_page','count','total_count'].every(k=>Number.isInteger(info[k])&&info[k]>=0);
    complete=complete&&info.page===1&&info.per_page===100&&info.count===items.length&&info.total_count===items.length;
    if(complete){
      const uuids=new Set(),names=new Set();
      for(const x of items){
        if(!x||typeof x!=='object'||!UUID.test(x.uuid||'')||typeof x.name!=='string'||x.name.length<1||x.name.length>200||uuids.has(x.uuid)||names.has(x.name)||x.uuid===SOURCE){complete=false;break;}
        uuids.add(x.uuid);names.add(x.name);
      }
    }
    if(complete){
      receipt.d1_catalog_complete=true;
      receipt.d1_database_count=items.length;
      receipt.isolation_candidate_empty=items.length===0;
    }else receipt.d1_catalog_http='INCOMPLETE_OR_UNSAFE_D1_CATALOG';
  }
  // Identity and spend authority are NEVER derived from these metadata GETs.
  demand(receipt.gate1_closed===false&&receipt.provider_hard_zero_additional_spend_verified===false&&receipt.d1_creation_authorized===false,'GUARD_INTERNAL_INVARIANT');
  return receipt;
}
/** Command-line usage: token and new ID are supplied ONLY via transient env. */
async function main(){
  let outcome;
  try{
    outcome=await audit({account:process.env.AXIOM_GATE1_OWNER_FREE_ACCOUNT_ID,
                        token:process.env.AXIOM_GATE1_OWNER_FREE_ACCOUNT_READ_TOKEN});
  }catch(e){
    outcome={schema:'musitu.axiom.step1.free-account-windows-readonly.v1',
      status:'MISSING_OR_UNQUALIFIED_OWNER_FREE_ACCOUNT_NO_GO',
      error:e instanceof NoGo?e.code:'PROVIDER_UNAVAILABLE',
      gate1_closed:false,step1_closed:false,step2_authorized:false,
      d1_creation_authorized:false,release_authorized:false,release_status:'NOT_RELEASE'};
  }
  const content=JSON.stringify(outcome,null,2)+'\n';
  writeFileSync(DEFAULT_OUT,content,{flag:'wx',encoding:'utf8',mode:0o600});
  writeFileSync(DEFAULT_OUT+'.sha256',sha(Buffer.from(content))+'  '+DEFAULT_OUT+'\n',{flag:'wx',encoding:'utf8',mode:0o600});
  console.log('AXIOM_GATE1_WINDOWS_FREE_ACCOUNT_READONLY_METADATA_NO_GO_NOT_RELEASE');
  for(const k of ['status','account_identity_verified','active_paid_subscriptions_absent','d1_catalog_complete','isolation_candidate_empty','gate1_closed']){
    if(Object.hasOwn(outcome,k))console.log(k+'='+outcome[k]);
  }
  if(!(outcome.account_identity_verified===true && outcome.active_paid_subscriptions_absent===true && outcome.d1_catalog_complete===true && outcome.isolation_candidate_empty===true))process.exitCode=2;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{
  console.error('AXIOM_GATE1_WINDOWS_FAIL_CLOSED_NO_GO_NOT_RELEASE');
  process.exitCode=2;
});
