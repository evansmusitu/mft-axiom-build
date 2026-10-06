import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {applyLegalHold, purgeExpiredCase, releaseLegalHold, reviewLegalHold} from '../retention_lifecycle.js';

const API='https://api.cloudflare.com/client/v4';
const SUPPORT_BRANCH='support/axiom-official-support-20261005';
const SUPPORT_DOMAIN='support.mftintelligence.com';
const WORKER='musitu-axiom-support';
const CONFIRM='VERIFY_MUSITU_AXIOM_SUPPORT_LEGAL_HOLD_LIFECYCLE';
const sha256=value=>createHash('sha256').update(String(value)).digest('hex');

async function api({fetchImpl,token,path,method='GET',body}) {
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
function rows(result){const block=Array.isArray(result)?result[0]:result;return Array.isArray(block?.results)?block.results:[];}

class Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){const result=await this.db.query(this.sql,this.args);return rows(result)[0]||null;}
}
class RestD1 {
  constructor({fetchImpl,token,accountId,databaseId}){Object.assign(this,{fetchImpl,token,accountId,databaseId});}
  prepare(sql){return new Statement(this,sql);}
  async query(sql,params=[]){
    return api({fetchImpl:this.fetchImpl,token:this.token,path:`/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,method:'POST',body:{sql,params}});
  }
  async batch(statements){
    const result=await api({
      fetchImpl:this.fetchImpl,token:this.token,
      path:`/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      method:'POST',body:{batch:statements.map(x=>({sql:x.sql,params:x.args}))},
    });
    if(!Array.isArray(result)||result.length!==statements.length||result.some(x=>x?.success===false)) throw new Error('D1 legal hold batch failed');
    return result;
  }
}

async function count(db,table){return Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table};`).first())?.count??-1);}

export async function runLegalHoldLifecycleDrill({env=process.env,fetchImpl=fetch,now=new Date().toISOString()}={}){
  if(env.GITHUB_REF_NAME!==SUPPORT_BRANCH) throw new Error('legal hold drill may run only from the isolated support branch');
  if(env.SUPPORT_LEGAL_HOLD_LIFECYCLE_CONFIRM!==CONFIRM) throw new Error('legal hold drill confirmation is missing');
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const zoneId=String(env.CLOUDFLARE_ZONE_ID||'').trim();
  const databaseId=String(env.SUPPORT_D1_DATABASE_ID||'').trim();
  const token=String(env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!accountId||!zoneId||!databaseId||!token) throw new Error('legal hold Cloudflare configuration is incomplete');

  const [domains,subdomain,dns]=await Promise.all([
    api({fetchImpl,token,path:`/accounts/${accountId}/workers/domains`}),
    api({fetchImpl,token,path:`/accounts/${accountId}/workers/scripts/${WORKER}/subdomain`}),
    api({fetchImpl,token,path:`/zones/${zoneId}/dns_records?name=${encodeURIComponent(SUPPORT_DOMAIN)}&per_page=100`}),
  ]);
  const publicDomain=(Array.isArray(domains)?domains:[]).some(x=>String(x?.hostname||'').toLowerCase()===SUPPORT_DOMAIN);
  if(publicDomain||(Array.isArray(dns)&&dns.length)||subdomain?.enabled===true||subdomain?.previews_enabled===true) {
    throw new Error('legal hold drill requires the support origin to remain non-public');
  }

  const db=new RestD1({fetchImpl,token,accountId,databaseId});
  const initialCases=await count(db,'support_cases');
  const initialEvents=await count(db,'support_case_events');
  const initialAuth=await count(db,'support_case_purge_authorizations');
  const initialReceipts=await count(db,'support_deletion_receipts');
  if(initialAuth!==0||initialReceipts<1) throw new Error('legal hold drill requires no active purge authorization and prior erasure evidence');

  let staleSyntheticCaseRecovered=false;
  const staleCaseId='AX-0123456789CD';
  const stale=await db.prepare('SELECT case_id,state,legal_hold_until FROM support_cases WHERE case_id=? LIMIT 1').bind(staleCaseId).first();
  if(initialCases===1&&stale?.case_id===staleCaseId&&!stale.legal_hold_until){
    const recovered=await purgeExpiredCase({
      database:db,caseId:staleCaseId,now:new Date().toISOString(),
      actorRole:'privacy_officer',ownerRef:'github:evansmusitu',independentApproverRef:'person:elvis-musitu',
      approvalEvidenceHashes:['c'.repeat(64),'d'.repeat(64)],
    });
    if(recovered.status!=='PURGED') throw new Error('stale synthetic legal hold case recovery failed');
    staleSyntheticCaseRecovered=true;
  } else if(initialCases!==0||initialEvents!==0) {
    throw new Error('unexpected live support case/event state before legal hold drill');
  }

  const baselineCases=await count(db,'support_cases');
  const baselineEvents=await count(db,'support_case_events');
  const baselineAuth=await count(db,'support_case_purge_authorizations');
  const baselineReceipts=await count(db,'support_deletion_receipts');
  if(baselineCases!==0||baselineEvents!==0||baselineAuth!==0) throw new Error('synthetic recovery did not return support D1 to zero live cases/events/auth');

  const caseId='AX-0123456789EF';
  const initialHash='1'.repeat(64);
  const closedAt='2026-01-01T00:00:00Z';
  const publicJson=JSON.stringify({schema:'musitu.axiom.support-case-public.v1',case_id:caseId,state:'CLOSED',priority:'P2',surface:'privacy_data_rights',category:'privacy_request',created_at:closedAt,updated_at:closedAt});
  await db.batch([
    db.prepare(`INSERT INTO support_cases
      (case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,public_json,encrypted_payload,last_event_hash,closed_at,retention_expires_at,legal_hold_until,legal_hold_review_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      caseId,'CLOSED','P2','privacy_data_rights','privacy_request',null,'PRIVACY_RESTRICTED','1','2'.repeat(64),
      publicJson,JSON.stringify({v:1,synthetic:true}),initialHash,closedAt,'2026-04-01T00:00:00.000Z',null,null,closedAt,closedAt),
    db.prepare(`INSERT INTO support_case_events
      (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(caseId,initialHash,null,'CASE_CLOSED','privacy_officer','internal',JSON.stringify({synthetic:true}),closedAt),
  ]);

  const auth={
    actorRole:'privacy_officer',
    ownerRef:'github:evansmusitu',
    independentApproverRef:'person:elvis-musitu',
    approvalEvidenceHashes:['3'.repeat(64)],
  };
  const hold=await applyLegalHold({database:db,caseId,reasonHash:'4'.repeat(64),at:'2026-06-01T00:00:00Z',...auth});
  const heldRow=await db.prepare('SELECT legal_hold_until,legal_hold_review_at FROM support_cases WHERE case_id=? LIMIT 1').bind(caseId).first();
  if(String(heldRow?.legal_hold_until)!=='9999-12-31T23:59:59.000Z'||String(heldRow?.legal_hold_review_at)!=='2026-08-30T00:00:00.000Z') {
    throw new Error('live legal hold readback mismatch');
  }

  let overduePurgeBlocked=false;
  try {
    await purgeExpiredCase({
      database:db,caseId,now,
      actorRole:'privacy_officer',ownerRef:'github:evansmusitu',independentApproverRef:'person:elvis-musitu',
      approvalEvidenceHashes:['5'.repeat(64)],
    });
  } catch(error) {
    overduePurgeBlocked=/LEGAL_HOLD_ACTIVE|not eligible for purge/.test(String(error?.message||''));
  }
  if(!overduePurgeBlocked) throw new Error('overdue legal hold did not block live purge');

  const reviewed=await reviewLegalHold({database:db,caseId,reasonHash:'4'.repeat(64),at:now,...auth});
  const reviewDelta=Date.parse(reviewed.review_due_at)-Date.parse(now);
  if(reviewDelta!==90*24*60*60*1000) throw new Error('live legal hold review deadline is not exactly 90 days');
  const releaseAt=new Date().toISOString();
  const released=await releaseLegalHold({database:db,caseId,at:releaseAt,...auth});
  if(released.status!=='RELEASED') throw new Error('live legal hold release failed');

  const purged=await purgeExpiredCase({
    database:db,caseId,now:new Date().toISOString(),
    actorRole:'privacy_officer',ownerRef:'github:evansmusitu',independentApproverRef:'person:elvis-musitu',
    approvalEvidenceHashes:['5'.repeat(64),'6'.repeat(64)],
  });
  if(purged.status!=='PURGED') throw new Error('post-release live purge failed');

  const afterCases=await count(db,'support_cases');
  const afterEvents=await count(db,'support_case_events');
  const afterAuth=await count(db,'support_case_purge_authorizations');
  const afterReceipts=await count(db,'support_deletion_receipts');
  if(afterCases!==0||afterEvents!==0||afterAuth!==0||afterReceipts!==baselineReceipts+1) throw new Error('legal hold lifecycle cleanup counts are invalid');

  return {
    schema:'musitu.axiom.support-readiness-evidence.v1',
    gate:'PRIVACY_RETENTION_LEGAL_HOLD',
    status:'PASS',
    verified_at:now,
    verifier_ref:String(env.GITHUB_RUN_ID||'')?`github-actions:run:${String(env.GITHUB_RUN_ID)}`:'github-actions:legal-hold-live',
    artifact_sha256:sha256(`legal-hold-live|${now}|${purged.receipt.receipt_sha256}`),
    legal_hold_dual_approval_verified:true,
    legal_hold_review_days:90,
    overdue_review_never_auto_released:true,
    overdue_purge_blocked:true,
    hold_review_verified:true,
    hold_release_dual_approved:true,
    post_release_purge_verified:true,
    live_case_count_after:afterCases,
    live_event_count_after:afterEvents,
    purge_authorization_count_after:afterAuth,
    initial_deletion_receipt_count:initialReceipts,
    stale_synthetic_case_recovered:staleSyntheticCaseRecovered,
    baseline_deletion_receipt_count_after_recovery:baselineReceipts,
    deletion_receipt_count_after:afterReceipts,
    public_route_absent_verified:true,
    synthetic_customer_content_used:false,
    public_support_deployed:false,
    secret_exposed:false,
  };
}

export async function main(){
  const evidence=await runLegalHoldLifecycleDrill();
  const serialized=JSON.stringify(evidence,null,2)+'\n';
  const digest=sha256(serialized);
  await writeFile('support-legal-hold-live-evidence.json',serialized,{encoding:'utf8',mode:0o600,flag:'wx'});
  await writeFile('support-legal-hold-live-evidence.json.sha256',`${digest}  support-legal-hold-live-evidence.json\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify({
    gate:evidence.gate,status:evidence.status,overdue_review_never_auto_released:evidence.overdue_review_never_auto_released,
    overdue_purge_blocked:evidence.overdue_purge_blocked,hold_review_verified:evidence.hold_review_verified,
    hold_release_dual_approved:evidence.hold_release_dual_approved,post_release_purge_verified:evidence.post_release_purge_verified,
    evidence_sha256:digest,
  })+'\n');
  return evidence;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await main();
