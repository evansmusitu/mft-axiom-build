/** Offline, privacy-preserving, all-record migration reconciliation.
 * Never queries a live provider, exports credentials, or transfers customer data.
 * Run with authenticated, frozen SQLite source export AND staged Neon readback.
 * This does not authorize a production cutover or prove provider network access.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';

const COLUMNS=Object.freeze({
  projects:['id','title','owner_sub','created_at'],
  memberships:['project_id','member_sub','role','created_at'],
  jobs:['id','project_id','submission_key','payload_json','payload_sha256','render_device',
    'state','created_by_sub','approved_by_sub','dispatched_by_sub','call_id','error_code',
    'created_at','approved_at','dispatched_at','finished_at'],
  assets:['job_id','filename','object_key','sha256','bytes'],
  audit_events:['id','project_id','job_id','action','actor_sub','at','details']
});
const KEYS=Object.freeze({
  projects:['id'],memberships:['project_id','member_sub'],jobs:['id'],
  assets:['job_id','filename'],audit_events:['id']
});
const ALLOWED_JOB_STATES=new Set(['PENDING_APPROVAL','APPROVED','DISPATCHING',
  'RUNNING','COMPLETED','FAILED','NEEDS_REVIEW']);
const ASSET_FILES=new Set(['scene.blend','scene.glb','preview.png']);
const MAX_ROWS=25000,MAX_ROW_BYTES=80000;
const fail=code=>{throw Error(code)};
function requireText(value,code){if(typeof value!=='string'||value.length===0||value.length>65536)fail(code)}
function signature(bytes,key){return createHmac('sha256',key).update(bytes).digest()}
function tuple(row,fields){return JSON.stringify(fields.map(k=>row[k]))}
function snapshotDigest(snapshot,table,key){
  const payload=JSON.stringify({schema:'musitu.studio.v03.table.v2',freeze_id:snapshot.freeze_id,table,rows:snapshot[table]});
  return signature(payload,key);
}
/** Throws a specific non-sensitive error code on malformed/partial input. */
export function normalizeStudioLedgerSnapshot(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('LEDGER_SNAPSHOT_INVALID');
  const allowed=new Set([...Object.keys(COLUMNS),'complete','freeze_id']);
  if(Object.keys(raw).some(k=>!allowed.has(k)))fail('LEDGER_UNEXPECTED_TABLE');
  if(raw.complete!==true)fail('LEDGER_PARTIAL_EXPORT');
  requireText(raw.freeze_id,'LEDGER_FREEZE_ID_REQUIRED');
  if(raw.freeze_id.length>128)fail('LEDGER_FREEZE_ID_INVALID');
  const result={complete:true,freeze_id:raw.freeze_id};
  for(const [table,columns] of Object.entries(COLUMNS)){
    const input=raw[table];
    if(!Array.isArray(input)||input.length>MAX_ROWS)fail('LEDGER_TABLE_MISSING_OR_UNBOUNDED');
    const ids=new Set();
    const ordered=input.map(row=>{
      if(!row||typeof row!=='object'||Array.isArray(row))fail('LEDGER_ROW_INVALID');
      if(Object.keys(row).length!==columns.length||columns.some(k=>!Object.hasOwn(row,k)))
        fail('LEDGER_COLUMN_SET_MISMATCH');
      const obj={};
      for(const col of columns){
        const value=row[col];
        if(col==='bytes'){
          if(!Number.isSafeInteger(value)||value<1024||value>5000000)
            fail('LEDGER_ASSET_SIZE_INVALID');
        }else if(value!==null&&typeof value!=='string')fail('LEDGER_COLUMN_TYPE_INVALID');
        if(typeof value==='string'&&value.length>65536)fail('LEDGER_COLUMN_UNBOUNDED');
        obj[col]=value;
      }
      const key=tuple(obj,KEYS[table]);
      if(ids.has(key))fail('LEDGER_DUPLICATE_PRIMARY_KEY');
      ids.add(key);
      if(Buffer.byteLength(JSON.stringify(obj),'utf8')>MAX_ROW_BYTES)fail('LEDGER_ROW_TOO_LARGE');
      return obj;
    });
    ordered.sort((a,b)=>tuple(a,KEYS[table]).localeCompare(tuple(b,KEYS[table]),'en'));
    result[table]=ordered;
  }
  verifyLedgerInvariants(result);
  return result;
}
function verifyLedgerInvariants(s){
  const projects=new Map(s.projects.map(p=>[p.id,p]));
  const jobs=new Map(s.jobs.map(j=>[j.id,j]));
  const membership=new Set(s.memberships.map(m=>tuple(m,['project_id','member_sub','role'])));
  const assetsByJob=new Map();
  const auditByJob=new Map();
  for(const p of s.projects){
    requireText(p.id,'LEDGER_PROJECT_ID');requireText(p.owner_sub,'LEDGER_OWNER_ID');
    if(!membership.has(tuple({project_id:p.id,member_sub:p.owner_sub,role:'owner'},
      ['project_id','member_sub','role'])))fail('LEDGER_OWNER_MEMBERSHIP_MISSING');
  }
  for(const m of s.memberships){
    if(!projects.has(m.project_id))fail('LEDGER_MEMBER_ORPHAN');
    if(!['owner','editor','reviewer','viewer'].includes(m.role))fail('LEDGER_MEMBER_ROLE_INVALID');
  }
  for(const j of s.jobs){
    if(!projects.has(j.project_id))fail('LEDGER_JOB_ORPHAN');
    if(!ALLOWED_JOB_STATES.has(j.state)||j.render_device!=='CPU')fail('LEDGER_JOB_STATE_INVALID');
    if(!/^[a-f0-9]{64}$/i.test(j.payload_sha256||''))fail('LEDGER_JOB_HASH_INVALID');
    if(j.approved_by_sub===null&&j.state!=='PENDING_APPROVAL')
      fail('LEDGER_APPROVAL_MISSING');
    if(j.approved_by_sub!==null&&j.state==='PENDING_APPROVAL')
      fail('LEDGER_PREMATURE_APPROVAL');
  }
  const submissions=new Set();
  for(const j of s.jobs){
    if(submissions.has(j.submission_key))fail('LEDGER_DUPLICATE_SUBMISSION_KEY');
    submissions.add(j.submission_key);
  }
  const keys=new Set();
  for(const a of s.assets){
    if(!jobs.has(a.job_id))fail('LEDGER_ASSET_ORPHAN');
    if(!ASSET_FILES.has(a.filename)||!/^[a-f0-9]{64}$/i.test(a.sha256||''))
      fail('LEDGER_ASSET_INVALID');
    requireText(a.object_key,'LEDGER_ASSET_OBJECT_KEY');
    if(keys.has(a.object_key))fail('LEDGER_DUPLICATE_OBJECT_KEY');
    keys.add(a.object_key);
    assetsByJob.set(a.job_id,(assetsByJob.get(a.job_id)||0)+1);
  }
  for(const event of s.audit_events){
    if(event.project_id!==null&&!projects.has(event.project_id))fail('LEDGER_AUDIT_PROJECT_ORPHAN');
    if(event.job_id!==null){
      const j=jobs.get(event.job_id);
      if(!j||j.project_id!==event.project_id)fail('LEDGER_AUDIT_JOB_ORPHAN');
      const key=tuple(event,['job_id','action','actor_sub']);
      auditByJob.set(key,(auditByJob.get(key)||0)+1);
    }
    try{
      if(!event.details||typeof JSON.parse(event.details)!=='object')throw Error('NON_OBJECT');
    }catch{fail('LEDGER_AUDIT_DETAILS_INVALID')}
  }
  for(const j of s.jobs){
    if(j.state==='COMPLETED'&&assetsByJob.get(j.id)!==3)
      fail('LEDGER_COMPLETED_ASSETS_MISSING');
    if(j.approved_by_sub!==null){
      const action=j.created_by_sub===j.approved_by_sub?'JOB_APPROVED_SINGLE_ADMIN':'JOB_APPROVED';
      const approvals=auditByJob.get(tuple({job_id:j.id,action,actor_sub:j.approved_by_sub},
        ['job_id','action','actor_sub']))||0;
      if(approvals!==1)fail('LEDGER_APPROVAL_AUDIT_MISSING_OR_DUPLICATED');
    }
  }
}
/** Reusable keyed attestation of ONE internally complete, normalized ledger.
 * Caller must independently prove live origin, freeze, protected transport and
 * secret-key custody. This source-only function makes NO provider assertions.
 */
export function attestStudioLedgerSnapshot(snapshot,{integrityKey}={}){
  if(!Buffer.isBuffer(integrityKey)&&!(integrityKey instanceof Uint8Array))
    fail('LEDGER_HMAC_KEY_REQUIRED');
  if(integrityKey.byteLength<32)fail('LEDGER_HMAC_KEY_TOO_SHORT');
  const normalized=normalizeStudioLedgerSnapshot(snapshot);
  const counts={},table_hmac={};
  for(const table of Object.keys(COLUMNS)){
    counts[table]=normalized[table].length;
    table_hmac[table]=snapshotDigest(normalized,table,integrityKey).toString('hex');
  }
  return {schema:'musitu.studio.v03.neon.ledger-attestation.v2',
    verified:true,complete:true,freeze_id:normalized.freeze_id,
    counts,table_hmac,customer_rows_logged:false,provider_verified:false};
}
/** Match two independently attested snapshots in constant time.
 * A matching digest cannot prove the source was authenticated or frozen.
 */
export function reconcileStudioLedgers(source,target,{integrityKey}={}){
  const a=attestStudioLedgerSnapshot(source,{integrityKey});
  const b=attestStudioLedgerSnapshot(target,{integrityKey});
  if(a.freeze_id!==b.freeze_id)fail('LEDGER_FREEZE_ID_MISMATCH');
  for(const table of Object.keys(COLUMNS)){
    if(a.counts[table]!==b.counts[table])
      fail('LEDGER_COUNT_MISMATCH_'+table.toUpperCase());
    if(!timingSafeEqual(Buffer.from(a.table_hmac[table],'hex'),
      Buffer.from(b.table_hmac[table],'hex')))
      fail('LEDGER_CONTENT_MISMATCH_'+table.toUpperCase());
  }
  return {schema:'musitu.studio.v03.neon.transfer.v2',verified:true,complete:true,
    freeze_match:true,freeze_id:a.freeze_id,counts:a.counts,table_hmac:a.table_hmac,
    customer_rows_logged:false,provider_verified:false};
}
