/**
 * Closed-stage, synthetic-only MMF customer-control SQLite proof.
 * Operates on separate tables with random SHA-256 test digests, NEVER on live
 * commercial tables, customer records, sessions, checkout or provider APIs.
 * Pending domain/subscription states are not DNS ownership or payment proof.
 */
const HASH=/^[a-f0-9]{64}$/;
const FIELDS=['tenantDigest','subjectDigest','domainDigest','keyDigest','plan'];
const deny=()=>{throw Error('MMF_PRIVATE_CONTROL_PROOF_DENIED')};
const sameKeys=(obj,fields)=>obj&&Object.getPrototypeOf(obj)===Object.prototype&&
 Object.keys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k));
function recordCheck(record){
 if(!sameKeys(record,FIELDS)||!FIELDS.slice(0,4).every(k=>typeof record[k]==='string'&&HASH.test(record[k]))||
  !['LAUNCH','GROWTH'].includes(record.plan))deny();
 return record;
}
function inputCheck(run,records){
 if(typeof run!=='string'||!HASH.test(run)||!Array.isArray(records)||records.length!==2)deny();
 for(const x of records)recordCheck(x);
 for(const name of FIELDS.slice(0,4))if(records[0][name]===records[1][name])deny();
 if(records.some(x=>Object.values(x).slice(0,4).includes(run)))deny();
 return records;
}
function singleCheck(run,record){if(!HASH.test(run||''))deny();return recordCheck(record)}
function initialize(storage){
 if(typeof storage?.sql?.exec!=='function'||typeof storage?.transactionSync!=='function')deny();
 storage.sql.exec(`CREATE TABLE IF NOT EXISTS mmf_private_control_tenants_20261013 (
  run_digest TEXT NOT NULL,tenant_digest TEXT PRIMARY KEY,subject_digest TEXT NOT NULL,
  domain_digest TEXT NOT NULL UNIQUE,key_digest TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL CHECK(plan IN ('LAUNCH','GROWTH')),
  domain_state TEXT NOT NULL CHECK(domain_state='PENDING_DNS'),
  subscription_state TEXT NOT NULL CHECK(subscription_state='PENDING'),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))) STRICT`);
 storage.sql.exec(`CREATE TABLE IF NOT EXISTS mmf_private_control_usage_20261013 (
  tenant_digest TEXT NOT NULL REFERENCES mmf_private_control_tenants_20261013(tenant_digest),
  idem_digest TEXT NOT NULL,PRIMARY KEY(tenant_digest,idem_digest)) STRICT`);
 return storage;
}
function rows(s,q,...args){const result=s.sql.exec(q,...args);if(typeof result?.toArray!=='function')deny();return result.toArray()}
function requireOwner(s,run,r,active=false){
 const matched=rows(s,`SELECT revoked FROM mmf_private_control_tenants_20261013
 WHERE run_digest=? AND tenant_digest=? AND subject_digest=? AND domain_digest=? AND key_digest=? AND plan=?`,
 run,r.tenantDigest,r.subjectDigest,r.domainDigest,r.keyDigest,r.plan);
 if(matched.length!==1||(active&&matched[0].revoked!==0))deny();
 return matched[0];
}
export function seedMmfSyntheticControl(storage,run,records){
 inputCheck(run,records);const s=initialize(storage);
 return s.transactionSync(()=>{
  if(rows(s,'SELECT tenant_digest FROM mmf_private_control_tenants_20261013 LIMIT 1').length)deny();
  for(const r of records)rows(s,`INSERT INTO mmf_private_control_tenants_20261013
   (run_digest,tenant_digest,subject_digest,domain_digest,key_digest,plan,domain_state,subscription_state)
   VALUES(?,?,?,?,?,?,'PENDING_DNS','PENDING')`,run,r.tenantDigest,r.subjectDigest,r.domainDigest,r.keyDigest,r.plan);
  return {stored:true,tenantCount:2};
 });
}
export function readMmfSyntheticControl(storage,run,records){
 inputCheck(run,records);const s=initialize(storage);
 const data=rows(s,`SELECT run_digest,tenant_digest,subject_digest,domain_digest,key_digest,plan,
 domain_state,subscription_state,revoked FROM mmf_private_control_tenants_20261013 ORDER BY tenant_digest`);
 if(data.length===0)return {present:false};
 if(data.length!==2)deny();
 for(const r of records){
  const hit=data.find(x=>x.tenant_digest===r.tenantDigest);
  if(!hit||hit.run_digest!==run||hit.subject_digest!==r.subjectDigest||hit.domain_digest!==r.domainDigest||
     hit.key_digest!==r.keyDigest||hit.plan!==r.plan||hit.domain_state!=='PENDING_DNS'||hit.subscription_state!=='PENDING'||
     ![0,1].includes(hit.revoked))deny();
 }
 const usage=rows(s,'SELECT tenant_digest,idem_digest FROM mmf_private_control_usage_20261013');
 if(usage.some(u=>!records.some(r=>r.tenantDigest===u.tenant_digest)||!HASH.test(u.idem_digest)))deny();
 return {present:true,tenantCount:2,domainPendingCount:2,subscriptionPendingCount:2,
  usageCount:usage.length,revokedCount:data.filter(x=>x.revoked===1).length,entitlementsActive:0};
}
export function checkMmfSyntheticControlAccess(storage,run,record){
 singleCheck(run,record);const s=initialize(storage);
 const r=rows(s,`SELECT revoked FROM mmf_private_control_tenants_20261013
 WHERE run_digest=? AND tenant_digest=? AND subject_digest=? AND domain_digest=? AND key_digest=? AND plan=?`,
 run,record.tenantDigest,record.subjectDigest,record.domainDigest,record.keyDigest,record.plan);
 return {active:r.length===1&&r[0].revoked===0};
}
export function recordMmfSyntheticControlUsage(storage,run,record,idempotencyDigest){
 singleCheck(run,record);if(typeof idempotencyDigest!=='string'||!HASH.test(idempotencyDigest))deny();
 const s=initialize(storage);
 return s.transactionSync(()=>{
  requireOwner(s,run,record,true);
  rows(s,`INSERT INTO mmf_private_control_usage_20261013(tenant_digest,idem_digest)
   VALUES(?,?) ON CONFLICT(tenant_digest,idem_digest) DO NOTHING`,record.tenantDigest,idempotencyDigest);
  const count=rows(s,'SELECT changes() AS n')[0]?.n;
  if(![0,1].includes(count))deny();return {metered:count===1};
 });
}
export function revokeMmfSyntheticControlKey(storage,run,record){
 singleCheck(run,record);const s=initialize(storage);
 return s.transactionSync(()=>{
  requireOwner(s,run,record,true);
  rows(s,`UPDATE mmf_private_control_tenants_20261013 SET revoked=1 WHERE run_digest=? AND tenant_digest=? AND revoked=0`,run,record.tenantDigest);
  if(rows(s,'SELECT changes() AS n')[0]?.n!==1)deny();
  return {revoked:true};
 });
}
export function clearMmfSyntheticControl(storage,run){
 if(typeof run!=='string'||!HASH.test(run))deny();const s=initialize(storage);
 return s.transactionSync(()=>{
  if(rows(s,'SELECT COUNT(*) AS n FROM mmf_private_control_tenants_20261013 WHERE run_digest=?',run)[0]?.n!==2||
   rows(s,'SELECT COUNT(*) AS n FROM mmf_private_control_tenants_20261013')[0]?.n!==2)deny();
  rows(s,'DELETE FROM mmf_private_control_usage_20261013');
  rows(s,'DELETE FROM mmf_private_control_tenants_20261013 WHERE run_digest=?',run);
  if(rows(s,'SELECT COUNT(*) AS n FROM mmf_private_control_tenants_20261013')[0]?.n!==0||
     rows(s,'SELECT COUNT(*) AS n FROM mmf_private_control_usage_20261013')[0]?.n!==0)deny();
  return {cleared:true};
 });
}
