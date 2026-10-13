/** B22 S0 conservative dispatch journal, never a provider authorization source.
 * An ISSUE receipt is committed before any synthetic transport; after a crash
 * it must never yield another send permit. Only trusted internal gateway code
 * may invoke this module. It does not certify issuer independence or quota.
 */
export class JournalDenied extends Error {
  constructor(code){super(code);this.name='JournalDenied';this.code=code;}
}
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const HEX=/^[a-f0-9]{64}$/;
const BEGIN_FIELDS='account_id,body_sha,quota_grant_id,request_id,tenant_id,utc_day,workload_id';
const COMPLETE_FIELDS='body_sha,request_id,result_sha';
const UNCERTAIN_FIELDS='body_sha,request_id';
function day(t){if(!Number.isSafeInteger(t)||t<0||t>8.64e15)throw new JournalDenied('INVALID_CLOCK');return new Date(t).toISOString().slice(0,10);}
function exact(x,fields){return x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===fields;}
function requestId(x){if(typeof x!=='string'||!ID.test(x))throw new JournalDenied('INVALID_REQUEST');return x;}
export class DurableDispatchJournal {
  constructor(storage, {accountId,utcDay,now=()=>Date.now()}={}) {
    if(!storage||typeof storage.transactionSync!=='function'||typeof storage.sql?.exec!=='function'||
      typeof accountId!=='string'||!ID.test(accountId)||typeof utcDay!=='string'||
      !/^\d{4}-\d{2}-\d{2}$/.test(utcDay)||!Number.isFinite(Date.parse(utcDay+'T00:00:00Z'))||
      new Date(utcDay+'T00:00:00Z').toISOString().slice(0,10)!==utcDay||typeof now!=='function')
      throw new JournalDenied('UNTRUSTED_JOURNAL_CONTEXT');
    this.storage=storage;this.sql=storage.sql;this.accountId=accountId;this.day=utcDay;this.now=now;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS b22_dispatch (
      request_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, utc_day TEXT NOT NULL,
      tenant_id TEXT NOT NULL, workload_id TEXT NOT NULL, body_sha TEXT NOT NULL,
      quota_grant_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('ISSUED','COMPLETED','UNKNOWN')),
      result_sha TEXT, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL)`);
  }
  current(){const ms=this.now();if(day(ms)!==this.day)throw new JournalDenied('NOT_CURRENT_ACCOUNT_DAY');return ms;}
  validateBegin(r){
    if(!exact(r,BEGIN_FIELDS)||r.account_id!==this.accountId||r.utc_day!==this.day||
      ![r.request_id,r.tenant_id,r.workload_id,r.quota_grant_id].every(x=>typeof x==='string'&&ID.test(x))||
      typeof r.body_sha!=='string'||!HEX.test(r.body_sha))throw new JournalDenied('INVALID_REQUEST');
  }
  lookup(req){
    if(!exact(req,'request_id'))throw new JournalDenied('INVALID_REQUEST');
    const id=requestId(req.request_id);
    const row=this.sql.exec('SELECT request_id,account_id,utc_day,tenant_id,workload_id,body_sha,quota_grant_id,state,result_sha FROM b22_dispatch WHERE request_id=?',id).toArray()[0];
    return row?{...row}:null;
  }
  begin(req){
    this.validateBegin(req); const now=this.current();
    return this.storage.transactionSync(()=>{
      const old=this.lookup({request_id:req.request_id});
      if(old){
        if(old.account_id!==req.account_id||old.utc_day!==req.utc_day||old.tenant_id!==req.tenant_id||
           old.workload_id!==req.workload_id||old.body_sha!==req.body_sha||old.quota_grant_id!==req.quota_grant_id)
          throw new JournalDenied('OPERATION_SCOPE_CONFLICT');
        return {state:old.state,send_allowed:false,request_id:req.request_id};
      }
      this.sql.exec(`INSERT INTO b22_dispatch(request_id,account_id,utc_day,tenant_id,workload_id,
        body_sha,quota_grant_id,state,result_sha,created_ms,updated_ms)
        VALUES (?,?,?,?,?,?,?,'ISSUED',NULL,?,?)`,
        req.request_id,req.account_id,req.utc_day,req.tenant_id,req.workload_id,
        req.body_sha,req.quota_grant_id,now,now);
      return {state:'ISSUED',send_allowed:true,request_id:req.request_id};
    });
  }
  complete(req){
    if(!exact(req,COMPLETE_FIELDS)||typeof req.body_sha!=='string'||!HEX.test(req.body_sha)||
       typeof req.result_sha!=='string'||!HEX.test(req.result_sha))throw new JournalDenied('INVALID_REQUEST');
    requestId(req.request_id);const now=this.current();
    return this.storage.transactionSync(()=>{
      const row=this.lookup({request_id:req.request_id});if(!row)throw new JournalDenied('UNKNOWN_OPERATION');
      if(row.body_sha!==req.body_sha)throw new JournalDenied('OPERATION_SCOPE_CONFLICT');
      if(row.state==='UNKNOWN')throw new JournalDenied('TERMINAL_UNKNOWN');
      if(row.state==='COMPLETED'){
        if(row.result_sha!==req.result_sha)throw new JournalDenied('RESULT_SCOPE_CONFLICT');
        return {state:'COMPLETED',request_id:req.request_id};
      }
      this.sql.exec("UPDATE b22_dispatch SET state='COMPLETED',result_sha=?,updated_ms=? WHERE request_id=?",
        req.result_sha,now,req.request_id);
      return {state:'COMPLETED',request_id:req.request_id};
    });
  }
  uncertain(req){
    if(!exact(req,UNCERTAIN_FIELDS)||typeof req.body_sha!=='string'||!HEX.test(req.body_sha))throw new JournalDenied('INVALID_REQUEST');
    requestId(req.request_id);const now=this.current();
    return this.storage.transactionSync(()=>{
      const row=this.lookup({request_id:req.request_id});if(!row)throw new JournalDenied('UNKNOWN_OPERATION');
      if(row.body_sha!==req.body_sha)throw new JournalDenied('OPERATION_SCOPE_CONFLICT');
      if(row.state==='COMPLETED')throw new JournalDenied('TERMINAL_COMPLETED');
      if(row.state==='UNKNOWN')return {state:'UNKNOWN',request_id:req.request_id};
      this.sql.exec("UPDATE b22_dispatch SET state='UNKNOWN',updated_ms=? WHERE request_id=?",now,req.request_id);
      return {state:'UNKNOWN',request_id:req.request_id};
    });
  }
}
