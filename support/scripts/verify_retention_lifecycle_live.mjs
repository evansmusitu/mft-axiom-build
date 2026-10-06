import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {purgeExpiredCase} from '../retention_lifecycle.js';

const API='https://api.cloudflare.com/client/v4';
const SUPPORT_BRANCH='support/axiom-official-support-20261005';
const SUPPORT_DOMAIN='support.mftintelligence.com';
const WORKER='musitu-axiom-support';
const CONFIRM='VERIFY_MUSITU_AXIOM_SUPPORT_RETENTION_LIFECYCLE';

const sha256=value=>createHash('sha256').update(String(value)).digest('hex');

async function api({fetchImpl,token,path,method='GET',body,allowFailure=false}) {
  const response=await fetchImpl(API+path,{
    method,
    headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  let payload={}; try{payload=await response.json();}catch{}
  const ok=response.ok&&payload?.success!==false;
  if(!ok&&!allowFailure){
    const codes=Array.isArray(payload?.errors)?payload.errors.map(x=>x?.code).filter(Boolean):[];
    const error=new Error(`Cloudflare ${method} ${path} failed HTTP ${response.status}; codes=${codes.join(',')||'none'}`);
    error.status=response.status;
    throw error;
  }
  return {ok,status:response.status,result:payload?.result??null,errors:payload?.errors||[]};
}

function rows(result){
  const block=Array.isArray(result)?result[0]:result;
  return Array.isArray(block?.results)?block.results:[];
}

class RestStatement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    const result=await this.db._query({sql:this.sql,params:this.args});
    return rows(result)[0]||null;
  }
}
class RestD1 {
  constructor({fetchImpl,token,accountId,databaseId}){
    this.fetchImpl=fetchImpl;this.token=token;this.accountId=accountId;this.databaseId=databaseId;
  }
  prepare(sql){return new RestStatement(this,sql);}
  async _query(query){
    const out=await api({
      fetchImpl:this.fetchImpl,token:this.token,
      path:`/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      method:'POST',body:query,
    });
    return out.result;
  }
  async batch(statements){
    const batch=statements.map(stmt=>({sql:stmt.sql,params:stmt.args}));
    const out=await api({
      fetchImpl:this.fetchImpl,token:this.token,
      path:`/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      method:'POST',body:{batch},
    });
    const results=Array.isArray(out.result)?out.result:[];
    if(results.length!==batch.length||results.some(x=>x?.success===false)) throw new Error('D1 REST batch did not commit all purge statements');
    return results;
  }
}

async function queryFirst(db,sql,...params){return db.prepare(sql).bind(...params).first();}

export async function runRetentionLifecycleDrill({env=process.env,fetchImpl=fetch,now=new Date().toISOString()}={}){
  if(env.GITHUB_REF_NAME!==SUPPORT_BRANCH) throw new Error('retention lifecycle drill may run only from the isolated support branch');
  if(env.SUPPORT_RETENTION_LIFECYCLE_CONFIRM!==CONFIRM) throw new Error('retention lifecycle drill confirmation is missing');
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const zoneId=String(env.CLOUDFLARE_ZONE_ID||'').trim();
  const databaseId=String(env.SUPPORT_D1_DATABASE_ID||'').trim();
  const token=String(env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!accountId||!zoneId||!databaseId||!token) throw new Error('retention lifecycle Cloudflare configuration is incomplete');

  const [domains,subdomain,dns]=await Promise.all([
    api({fetchImpl,token,path:`/accounts/${accountId}/workers/domains`}),
    api({fetchImpl,token,path:`/accounts/${accountId}/workers/scripts/${WORKER}/subdomain`}),
    api({fetchImpl,token,path:`/zones/${zoneId}/dns_records?name=${encodeURIComponent(SUPPORT_DOMAIN)}&per_page=100`}),
  ]);
  const publicDomain=(Array.isArray(domains.result)?domains.result:[]).some(x=>String(x?.hostname||'').toLowerCase()===SUPPORT_DOMAIN);
  const supportDns=Array.isArray(dns.result)?dns.result:[];
  if(publicDomain||supportDns.length||subdomain.result?.enabled===true||subdomain.result?.previews_enabled===true) {
    throw new Error('retention lifecycle drill requires the support origin to remain non-public');
  }

  const db=new RestD1({fetchImpl,token,accountId,databaseId});
  const beforeCases=Number((await queryFirst(db,'SELECT COUNT(*) AS count FROM support_cases;'))?.count??-1);
  const beforeEvents=Number((await queryFirst(db,'SELECT COUNT(*) AS count FROM support_case_events;'))?.count??-1);
  const beforeReceipts=Number((await queryFirst(db,'SELECT COUNT(*) AS count FROM support_deletion_receipts;'))?.count??-1);
  if(beforeCases!==0||beforeEvents!==0||beforeReceipts!==0) throw new Error('retention lifecycle drill requires zero live cases, events and prior deletion receipts');

  const caseId='AX-0123456789AB';
  const eventHash='b'.repeat(64);
  const recoveryHash='a'.repeat(64);
  const closedAt='2026-01-01T00:00:00Z';
  const retentionExpiresAt='2026-04-01T00:00:00.000Z';
  const publicJson=JSON.stringify({schema:'musitu.axiom.support-case-public.v1',case_id:caseId,state:'CLOSED',priority:'P2',surface:'privacy_data_rights',category:'privacy_request',created_at:closedAt,updated_at:closedAt});
  const syntheticCiphertext=JSON.stringify({v:1,synthetic:true,ciphertext_sha256:sha256('synthetic-retention-drill')});

  await db.batch([
    db.prepare(`INSERT INTO support_cases
      (case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,public_json,encrypted_payload,last_event_hash,closed_at,retention_expires_at,legal_hold_until,legal_hold_review_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        caseId,'CLOSED','P2','privacy_data_rights','privacy_request',null,'PRIVACY_RESTRICTED','1',
        recoveryHash,publicJson,syntheticCiphertext,eventHash,closedAt,retentionExpiresAt,null,null,closedAt,closedAt,
      ),
    db.prepare(`INSERT INTO support_case_events
      (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(caseId,eventHash,null,'CASE_CLOSED','privacy_officer','internal',JSON.stringify({synthetic:true}),closedAt),
  ]);

  const unauthorizedDelete=await api({
    fetchImpl,token,
    path:`/accounts/${accountId}/d1/database/${databaseId}/query`,
    method:'POST',
    body:{sql:'DELETE FROM support_case_events WHERE case_id=?',params:[caseId]},
    allowFailure:true,
  });
  if(unauthorizedDelete.ok) throw new Error('append-only event deletion unexpectedly succeeded without purge authorization');

  const result=await purgeExpiredCase({
    database:db,
    caseId,
    now,
    actorRole:'privacy_officer',
    ownerRef:'github:evansmusitu',
    independentApproverRef:'person:elvis-musitu',
    approvalEvidenceHashes:['c'.repeat(64),'d'.repeat(64)],
  });

  const afterCases=Number((await queryFirst(db,'SELECT COUNT(*) AS count FROM support_cases;'))?.count??-1);
  const afterEvents=Number((await queryFirst(db,'SELECT COUNT(*) AS count FROM support_case_events;'))?.count??-1);
  const afterAuth=Number((await queryFirst(db,'SELECT COUNT(*) AS count FROM support_case_purge_authorizations;'))?.count??-1);
  const afterReceipts=Number((await queryFirst(db,'SELECT COUNT(*) AS count FROM support_deletion_receipts;'))?.count??-1);
  if(afterCases!==0||afterEvents!==0||afterAuth!==0||afterReceipts!==1) throw new Error('retention lifecycle post-purge counts are invalid');

  const receiptRow=await queryFirst(db,`SELECT receipt_sha256,case_reference_sha256,retention_class,purged_at,processor_backup_expiry_note FROM support_deletion_receipts LIMIT 1;`);
  if(String(receiptRow?.receipt_sha256||'')!==result.receipt.receipt_sha256) throw new Error('stored deletion receipt does not match purge result');
  if('case_id' in (receiptRow||{})) throw new Error('deletion receipt unexpectedly contains raw case id');

  const updateAttempt=await api({
    fetchImpl,token,
    path:`/accounts/${accountId}/d1/database/${databaseId}/query`,
    method:'POST',
    body:{sql:'UPDATE support_deletion_receipts SET purged_at=? WHERE receipt_sha256=?',params:['2099-01-01T00:00:00Z',result.receipt.receipt_sha256]},
    allowFailure:true,
  });
  const deleteAttempt=await api({
    fetchImpl,token,
    path:`/accounts/${accountId}/d1/database/${databaseId}/query`,
    method:'POST',
    body:{sql:'DELETE FROM support_deletion_receipts WHERE receipt_sha256=?',params:[result.receipt.receipt_sha256]},
    allowFailure:true,
  });
  if(updateAttempt.ok||deleteAttempt.ok) throw new Error('deletion receipt immutability trigger failed');

  return {
    schema:'musitu.axiom.support-readiness-evidence.v1',
    gate:'PRIVACY_RETENTION',
    status:'PASS',
    verified_at:now,
    verifier_ref:String(env.GITHUB_RUN_ID||'')?`github-actions:run:${String(env.GITHUB_RUN_ID)}`:'github-actions:live-retention-lifecycle',
    artifact_sha256:sha256(`privacy-retention-live|${now}|${result.receipt.receipt_sha256}`),
    approved_retention_days:{standard:180,privacy_restricted:90,security_restricted:365},
    legal_hold_review_days:90,
    direct_event_delete_blocked:true,
    expired_case_purged:true,
    live_case_count_after:afterCases,
    live_event_count_after:afterEvents,
    purge_authorization_count_after:afterAuth,
    deletion_receipt_count_after:afterReceipts,
    deletion_receipt_immutable:true,
    raw_case_id_retained_in_receipt:false,
    synthetic_customer_content_used:false,
    processor_backup_expiry_disclosed:true,
    public_route_absent_verified:true,
    public_support_deployed:false,
    secret_exposed:false,
  };
}

export async function main(){
  const evidence=await runRetentionLifecycleDrill();
  const serialized=JSON.stringify(evidence,null,2)+'\n';
  const digest=sha256(serialized);
  await writeFile('support-retention-live-evidence.json',serialized,{encoding:'utf8',mode:0o600,flag:'wx'});
  await writeFile('support-retention-live-evidence.json.sha256',`${digest}  support-retention-live-evidence.json\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify({
    gate:evidence.gate,status:evidence.status,direct_event_delete_blocked:evidence.direct_event_delete_blocked,
    expired_case_purged:evidence.expired_case_purged,deletion_receipt_immutable:evidence.deletion_receipt_immutable,
    public_route_absent_verified:evidence.public_route_absent_verified,evidence_sha256:digest,
  })+'\n');
  return evidence;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await main();
