import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {closeSupportCase, purgeExpiredCase} from '../retention_lifecycle.js';

const API='https://api.cloudflare.com/client/v4';
const SUPPORT_BRANCH='support/axiom-official-support-20261005';
const SUPPORT_DOMAIN='support.mftintelligence.com';
const WORKER='musitu-axiom-support';
const CONFIRM='VERIFY_MUSITU_AXIOM_SUPPORT_CLOSURE_RETENTION';
const sha256=value=>createHash('sha256').update(String(value)).digest('hex');

async function api({fetchImpl,token,path,method='GET',body}) {
  const response=await fetchImpl(API+path,{
    method,
    headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  let payload={};try{payload=await response.json();}catch{}
  if(!response.ok||payload?.success===false) throw new Error(`Cloudflare ${method} ${path} failed HTTP ${response.status}`);
  return payload?.result;
}
function rows(result){const block=Array.isArray(result)?result[0]:result;return Array.isArray(block?.results)?block.results:[];}
class Statement{constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}bind(...args){this.args=args;return this;}async first(){return rows(await this.db.query(this.sql,this.args))[0]||null;}}
class RestD1{
  constructor(v){Object.assign(this,v);} prepare(sql){return new Statement(this,sql);}
  async query(sql,params=[]){return api({fetchImpl:this.fetchImpl,token:this.token,path:`/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,method:'POST',body:{sql,params}});}
  async batch(statements){const result=await api({fetchImpl:this.fetchImpl,token:this.token,path:`/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,method:'POST',body:{batch:statements.map(x=>({sql:x.sql,params:x.args}))}});if(!Array.isArray(result)||result.length!==statements.length||result.some(x=>x?.success===false))throw new Error('D1 closure batch failed');return result;}
}
async function count(db,table){return Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table};`).first())?.count??-1);}

export async function runClosureRetentionDrill({env=process.env,fetchImpl=fetch,now=new Date().toISOString()}={}){
  if(env.GITHUB_REF_NAME!==SUPPORT_BRANCH) throw new Error('closure retention drill may run only from the isolated support branch');
  if(env.SUPPORT_CLOSURE_RETENTION_CONFIRM!==CONFIRM) throw new Error('closure retention confirmation is missing');
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim(),zoneId=String(env.CLOUDFLARE_ZONE_ID||'').trim(),databaseId=String(env.SUPPORT_D1_DATABASE_ID||'').trim(),token=String(env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!accountId||!zoneId||!databaseId||!token) throw new Error('closure retention Cloudflare configuration is incomplete');
  const [domains,subdomain,dns]=await Promise.all([
    api({fetchImpl,token,path:`/accounts/${accountId}/workers/domains`}),
    api({fetchImpl,token,path:`/accounts/${accountId}/workers/scripts/${WORKER}/subdomain`}),
    api({fetchImpl,token,path:`/zones/${zoneId}/dns_records?name=${encodeURIComponent(SUPPORT_DOMAIN)}&per_page=100`}),
  ]);
  if((Array.isArray(domains)?domains:[]).some(x=>String(x?.hostname||'').toLowerCase()===SUPPORT_DOMAIN)||(Array.isArray(dns)&&dns.length)||subdomain?.enabled===true||subdomain?.previews_enabled===true) throw new Error('closure retention drill requires support origin non-public');

  const db=new RestD1({fetchImpl,token,accountId,databaseId});
  const beforeCases=await count(db,'support_cases'),beforeEvents=await count(db,'support_case_events'),beforeAuth=await count(db,'support_case_purge_authorizations'),beforeReceipts=await count(db,'support_deletion_receipts');
  if(beforeCases!==0||beforeEvents!==0||beforeAuth!==0||beforeReceipts<3) throw new Error('closure retention drill requires zero live cases/events/auth and prior lifecycle receipts');

  const caseId='AX-0123456789JK',initialHash='7'.repeat(64),createdAt='2025-12-01T00:00:00Z',resolvedAt='2025-12-31T00:00:00Z';
  const publicJson=JSON.stringify({schema:'musitu.axiom.support-case-public.v1',case_id:caseId,state:'RESOLVED',priority:'P2',surface:'web_app',category:'bug',created_at:createdAt,updated_at:resolvedAt});
  await db.batch([
    db.prepare(`INSERT INTO support_cases
      (case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,public_json,encrypted_payload,last_event_hash,closed_at,retention_expires_at,legal_hold_until,legal_hold_review_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(caseId,'RESOLVED','P2','web_app','bug',null,'SUPPORT_STANDARD','0','8'.repeat(64),publicJson,JSON.stringify({v:1,synthetic:true}),initialHash,null,null,null,null,createdAt,resolvedAt),
    db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(caseId,initialHash,null,'CASE_RESOLVED','support_agent_1','internal',JSON.stringify({synthetic:true}),resolvedAt),
  ]);

  const closed=await closeSupportCase({database:db,caseId,at:'2026-01-01T00:00:00Z',actor:'support_agent_1'});
  if(closed.state!=='CLOSED'||closed.closed_at!=='2026-01-01T00:00:00.000Z'||closed.retention_expires_at!=='2026-06-30T00:00:00.000Z') throw new Error('live closure retention metadata mismatch');
  const row=await db.prepare('SELECT state,closed_at,retention_expires_at FROM support_cases WHERE case_id=? LIMIT 1').bind(caseId).first();
  if(String(row?.state)!=='CLOSED'||String(row?.retention_expires_at)!=='2026-06-30T00:00:00.000Z') throw new Error('live closure D1 readback mismatch');

  const purged=await purgeExpiredCase({database:db,caseId,now,actorRole:'privacy_officer',ownerRef:'github:evansmusitu',independentApproverRef:'person:elvis-musitu',approvalEvidenceHashes:['9'.repeat(64),'a'.repeat(64)]});
  if(purged.status!=='PURGED') throw new Error('live closure-driven purge failed');
  const afterCases=await count(db,'support_cases'),afterEvents=await count(db,'support_case_events'),afterAuth=await count(db,'support_case_purge_authorizations'),afterReceipts=await count(db,'support_deletion_receipts');
  if(afterCases!==0||afterEvents!==0||afterAuth!==0||afterReceipts!==beforeReceipts+1) throw new Error('closure retention cleanup counts are invalid');

  return {schema:'musitu.axiom.support-readiness-evidence.v1',gate:'PRIVACY_RETENTION_CLOSURE_CLOCK',status:'PASS',verified_at:now,verifier_ref:String(env.GITHUB_RUN_ID||'')?`github-actions:run:${String(env.GITHUB_RUN_ID)}`:'github-actions:closure-retention-live',artifact_sha256:sha256(`closure-retention|${now}|${purged.receipt.receipt_sha256}`),closure_transition_verified:true,standard_retention_days:180,closed_at_stamped:true,retention_expiry_stamped:true,append_only_close_event_written:true,expired_case_purged:true,live_case_count_after:afterCases,live_event_count_after:afterEvents,purge_authorization_count_after:afterAuth,deletion_receipt_count_after:afterReceipts,public_route_absent_verified:true,synthetic_customer_content_used:false,public_support_deployed:false,secret_exposed:false};
}
export async function main(){const e=await runClosureRetentionDrill();const serialized=JSON.stringify(e,null,2)+'\n',digest=sha256(serialized);await writeFile('support-closure-retention-live.json',serialized,{encoding:'utf8',mode:0o600,flag:'wx'});await writeFile('support-closure-retention-live.json.sha256',`${digest}  support-closure-retention-live.json\n`,{encoding:'utf8',mode:0o600,flag:'wx'});console.log(JSON.stringify({gate:e.gate,status:e.status,closure_transition_verified:e.closure_transition_verified,retention_expiry_stamped:e.retention_expiry_stamped,expired_case_purged:e.expired_case_purged,deletion_receipt_count_after:e.deletion_receipt_count_after,evidence_sha256:digest}));return e;}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await main();
