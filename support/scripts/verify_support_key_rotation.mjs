import {createHash, randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const API='https://api.cloudflare.com/client/v4';
const SUPPORT_BRANCH='support/axiom-official-support-20261005';
const WORKER='musitu-axiom-support';
const SUPPORT_DOMAIN='support.mftintelligence.com';
const CONFIRM='ROTATE_MUSITU_AXIOM_SUPPORT_DATA_KEY_EMPTY_D1';

const sha256=value=>createHash('sha256').update(String(value)).digest('hex');

async function cf({fetchImpl,token,path,method='GET',body}) {
  const response=await fetchImpl(API+path,{
    method,
    headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  let payload={}; try{payload=await response.json();}catch{}
  if(!response.ok||payload?.success===false){
    const codes=Array.isArray(payload?.errors)?payload.errors.map(x=>x?.code).filter(Boolean):[];
    const error=new Error(`Cloudflare ${method} ${path} failed HTTP ${response.status}; codes=${codes.join(',')||'none'}`);
    error.status=response.status;
    throw error;
  }
  return payload?.result;
}

function queryRows(result){
  const block=Array.isArray(result)?result[0]:result;
  return Array.isArray(block?.results)?block.results:[];
}

async function countRows({fetchImpl,token,accountId,databaseId,table}){
  const result=await cf({
    fetchImpl,token,
    path:`/accounts/${accountId}/d1/database/${databaseId}/query`,
    method:'POST',
    body:{sql:`SELECT COUNT(*) AS count FROM ${table};`},
  });
  return Number(queryRows(result)[0]?.count??-1);
}

export async function rotateSupportDataKey({
  env=process.env,
  fetchImpl=fetch,
  now=new Date().toISOString(),
}={}){
  if(env.GITHUB_REF_NAME!==SUPPORT_BRANCH) throw new Error('support key rotation may run only from the isolated support branch');
  if(env.SUPPORT_KEY_ROTATION_CONFIRM!==CONFIRM) throw new Error('support key rotation confirmation is missing');
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const zoneId=String(env.CLOUDFLARE_ZONE_ID||'').trim();
  const databaseId=String(env.SUPPORT_D1_DATABASE_ID||'').trim();
  const token=String(env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!accountId||!zoneId||!databaseId||!token) throw new Error('support key rotation Cloudflare configuration is incomplete');

  const [domains,subdomain,dns,caseCount,eventCount,secretsBefore]=await Promise.all([
    cf({fetchImpl,token,path:`/accounts/${accountId}/workers/domains`}),
    cf({fetchImpl,token,path:`/accounts/${accountId}/workers/scripts/${WORKER}/subdomain`}),
    cf({fetchImpl,token,path:`/zones/${zoneId}/dns_records?name=${encodeURIComponent(SUPPORT_DOMAIN)}&per_page=100`}),
    countRows({fetchImpl,token,accountId,databaseId,table:'support_cases'}),
    countRows({fetchImpl,token,accountId,databaseId,table:'support_case_events'}),
    cf({fetchImpl,token,path:`/accounts/${accountId}/workers/scripts/${WORKER}/secrets`}),
  ]);

  const supportDomains=(Array.isArray(domains)?domains:[]).filter(x=>String(x?.hostname||'').toLowerCase()===SUPPORT_DOMAIN);
  const supportDns=Array.isArray(dns)?dns:[];
  const workersDevEnabled=subdomain?.enabled===true;
  const previewsEnabled=subdomain?.previews_enabled===true;
  if(supportDomains.length||supportDns.length||workersDevEnabled||previewsEnabled) {
    throw new Error('support key rotation requires the support Worker to remain non-public');
  }
  if(caseCount!==0||eventCount!==0) throw new Error('support D1 must be empty before zero-data key rotation');
  const beforeNames=new Set((Array.isArray(secretsBefore)?secretsBefore:[]).map(x=>String(x?.name||'')));
  if(!beforeNames.has('SUPPORT_DATA_KEY_B64')) throw new Error('existing support data key binding is missing');
  if(!beforeNames.has('TURNSTILE_SECRET_KEY')) throw new Error('Turnstile secret binding is missing');

  const keyBytes=randomBytes(32);
  let keyB64=keyBytes.toString('base64');
  try {
    const result=await cf({
      fetchImpl,token,
      path:`/accounts/${accountId}/workers/scripts/${WORKER}/secrets`,
      method:'PUT',
      body:{name:'SUPPORT_DATA_KEY_B64',text:keyB64,type:'secret_text'},
    });
    if(String(result?.name||'')!=='SUPPORT_DATA_KEY_B64'||String(result?.type||'')!=='secret_text') {
      throw new Error('Cloudflare did not confirm the support data key secret binding');
    }
  } finally {
    keyBytes.fill(0);
    keyB64='';
  }

  const secretsAfter=await cf({fetchImpl,token,path:`/accounts/${accountId}/workers/scripts/${WORKER}/secrets`});
  const afterNames=new Set((Array.isArray(secretsAfter)?secretsAfter:[]).map(x=>String(x?.name||'')));
  if(!afterNames.has('SUPPORT_DATA_KEY_B64')||!afterNames.has('TURNSTILE_SECRET_KEY')) {
    throw new Error('support secret binding verification failed after key rotation');
  }

  const runId=String(env.GITHUB_RUN_ID||'').trim();
  return {
    schema:'musitu.axiom.support-readiness-evidence.v1',
    gate:'ENCRYPTION_KEY_MANAGEMENT',
    status:'PASS',
    verified_at:now,
    verifier_ref:runId?`github-actions:run:${runId}`:'github-actions:isolated-key-rotation',
    artifact_sha256:sha256(`support-key-rotation|${now}|${runId}|32|empty-d1|non-public`),
    algorithm:'AES-256-GCM',
    generated_key_bytes:32,
    rotation_performed:true,
    database_empty_verified:true,
    support_case_count:caseCount,
    support_event_count:eventCount,
    public_route_absent_verified:true,
    workers_dev_enabled:false,
    previews_enabled:false,
    support_custom_domain_count:0,
    support_dns_record_count:0,
    key_binding_present_before:true,
    key_binding_present_after:true,
    turnstile_secret_preserved:true,
    customer_data_reencrypted:false,
    customer_data_reencryption_required:false,
    secret_value_exposed:false,
    secret_value_persisted_in_evidence:false,
    public_support_deployed:false,
  };
}

export async function main(){
  const evidence=await rotateSupportDataKey();
  const serialized=JSON.stringify(evidence,null,2)+'\n';
  const digest=sha256(serialized);
  await writeFile('support-key-rotation-evidence.json',serialized,{encoding:'utf8',mode:0o600,flag:'wx'});
  await writeFile('support-key-rotation-evidence.json.sha256',`${digest}  support-key-rotation-evidence.json\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify({
    gate:evidence.gate,status:evidence.status,rotation_performed:evidence.rotation_performed,
    database_empty_verified:evidence.database_empty_verified,public_route_absent_verified:evidence.public_route_absent_verified,
    generated_key_bytes:evidence.generated_key_bytes,secret_value_exposed:false,evidence_sha256:digest,
  })+'\n');
  return evidence;
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await main();
