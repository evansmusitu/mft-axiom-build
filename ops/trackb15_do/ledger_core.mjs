/*
 * MUSITU AXIOM Track B15 — isolated candidate, NOT DEPLOYABLE AUTHORITY.
 * Account/day quota state is modeled against Cloudflare SQLite-backed Durable
 * Object synchronous storage. All grants must be signed by a PINNED independent
 * issuer. Provider consumption evidence is not magically certified by this code.
 */
export class Denied extends Error { constructor(code) { super(code); this.name='Denied'; this.code=code; } }
const TE=new TextEncoder();
const MAX_DAILY_NEURONS=10000;
const MAX_GRANT_SECONDS=180;
const EXPECTED_SCHEMA='musitu.axiom.trackb15.s0.quota-grant.v1';
const SAFE_ASCII=/^[a-zA-Z0-9._:-]{1,80}$/;
const HEX64=/^[a-f0-9]{64}$/;

function safeInt(x,min,max) {return typeof x==='number' && Number.isSafeInteger(x) && x>=min && x<=max;}
function bytesFromB64(value) {
  if (typeof value!=='string'||value.length>25000||value.length===0|| !/^[a-zA-Z0-9+/]+={0,2}$/.test(value)) throw new Denied('ENCODING_DENIED');
  try {return Uint8Array.from(atob(value), c=>c.charCodeAt(0));}catch {throw new Denied('ENCODING_DENIED');}
}
function utf8(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch {throw new Denied('UTF8_DENIED');}}
function isoDay(seconds){return new Date(seconds*1000).toISOString().slice(0,10);}
export async function validateGrant(signed, { publicKeyB64, nowSeconds, expectedAccount, expectedDay }) {
  if (!signed || typeof signed!=='object'||Array.isArray(signed)||Object.keys(signed).sort().join(',')!=='payload_b64,signature_b64') throw new Denied('SIGNED_ENVELOPE_DENIED');
  if (!safeInt(nowSeconds,1,4102444800) || !SAFE_ASCII.test(expectedAccount) || !/^\d{4}-\d\d-\d\d$/.test(expectedDay)) throw new Denied('INVALID_VALIDATION_CONTEXT');
  const signedBytes=bytesFromB64(signed.payload_b64), sig=bytesFromB64(signed.signature_b64), pub=bytesFromB64(publicKeyB64);
  if (signedBytes.length>2048 || sig.length!==64 || pub.length!==32) throw new Denied('SIGNED_SIZE_DENIED');
  let key;
  try {key=await crypto.subtle.importKey('raw',pub,'Ed25519',false,['verify']);}catch {throw new Denied('AUTHORITY_KEY_REJECTED');}
  const ok=await crypto.subtle.verify('Ed25519',key,sig,signedBytes);
  if (!ok) throw new Denied('SIGNATURE_INVALID');
  let grant;
  try {grant=JSON.parse(utf8(signedBytes));}catch {throw new Denied('GRANT_JSON_DENIED');}
  if (!grant||Array.isArray(grant)||typeof grant!=='object') throw new Denied('GRANT_SHAPE_DENIED');
  const allowed=['schema','account_id','utc_day','tenant_id','workload_id','grant_id','issued_at','expires_at','max_calls','max_per_call_neurons','daily_capacity_neurons','provider_remaining_certified','production_authority'];
  if (Object.keys(grant).sort().join(',')!==allowed.sort().join(','))throw new Denied('GRANT_EXTRA_OR_MISSING_FIELDS');
  if (grant.schema!==EXPECTED_SCHEMA||grant.account_id!==expectedAccount||grant.utc_day!==expectedDay||
      ![grant.tenant_id,grant.workload_id,grant.grant_id].every(x=>typeof x==='string'&&SAFE_ASCII.test(x)) ||
      grant.production_authority!==false || grant.provider_remaining_certified!==true)throw new Denied('GRANT_SCOPE_DENIED');
  if (!safeInt(grant.issued_at,1,4102444800)||!safeInt(grant.expires_at,1,4102444800)||
      grant.issued_at>nowSeconds||grant.expires_at<=nowSeconds||
      grant.expires_at-grant.issued_at>MAX_GRANT_SECONDS ||
      isoDay(grant.issued_at)!==expectedDay || isoDay(nowSeconds)!==expectedDay)throw new Denied('GRANT_EXPIRED_DAY_DENIED');
  if (!safeInt(grant.max_calls,1,20)||!safeInt(grant.max_per_call_neurons,1,1500)||
      !safeInt(grant.daily_capacity_neurons,1,MAX_DAILY_NEURONS))throw new Denied('GRANT_BUDGET_DENIED');
  return grant;
}

export async function validateRevocation(signed,{publicKeyB64, nowSeconds, expectedAccount, expectedDay}){
  if (!signed || typeof signed!=='object'||Array.isArray(signed)||Object.keys(signed).sort().join(',')!=='payload_b64,signature_b64')throw new Denied('SIGNED_ENVELOPE_DENIED');
  if(!safeInt(nowSeconds,1,4102444800))throw new Denied('TIME_DENIED');
  const payload=bytesFromB64(signed.payload_b64),signature=bytesFromB64(signed.signature_b64),pub=bytesFromB64(publicKeyB64);
  if(payload.length>2048||signature.length!==64||pub.length!==32)throw new Denied('SIGNED_SIZE_DENIED');
  let key;
  try{key=await crypto.subtle.importKey('raw',pub,'Ed25519',false,['verify']);}catch{throw new Denied('AUTHORITY_KEY_REJECTED');}
  if(!await crypto.subtle.verify('Ed25519',key,signature,payload))throw new Denied('SIGNATURE_INVALID');
  let r;
  try{r=JSON.parse(utf8(payload));}catch{throw new Denied('REVOCATION_JSON_DENIED');}
  const expected='account_id,expires_at,issued_at,reason,schema,sequence,utc_day';
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!==expected)throw new Denied('REVOCATION_SHAPE_DENIED');
  if(r.schema!=='musitu.axiom.trackb15.s0.revocation.v1'||r.account_id!==expectedAccount||r.utc_day!==expectedDay||
     typeof r.reason!=='string'||!SAFE_ASCII.test(r.reason)||!safeInt(r.sequence,1,2147483647)||
     !safeInt(r.issued_at,1,4102444800)||!safeInt(r.expires_at,1,4102444800)||
     r.issued_at>nowSeconds||r.expires_at<=nowSeconds||r.expires_at-r.issued_at>MAX_GRANT_SECONDS||
     isoDay(r.issued_at)!==expectedDay||isoDay(nowSeconds)!==expectedDay)throw new Denied('REVOCATION_SCOPE_DENIED');
  return r;
}

export class AccountDayLedger {
  constructor(storage,{accountId,utcDay,publicKeyB64,now=()=>Math.floor(Date.now()/1000)}={}) {
    if(!storage?.transactionSync||!storage?.sql?.exec)throw new Denied('SQLITE_STORAGE_REQUIRED');
    if(typeof accountId!=='string'||!SAFE_ASCII.test(accountId)||!/^\d{4}-\d\d-\d\d$/.test(utcDay)||typeof publicKeyB64!=='string')throw new Denied('UNBOUND_LEDGER_CONFIG');
    this.storage=storage;this.sql=storage.sql;this.accountId=accountId;this.utcDay=utcDay;this.publicKeyB64=publicKeyB64;this.now=now;
    this.sql.exec('CREATE TABLE IF NOT EXISTS quota_meta (id INTEGER PRIMARY KEY CHECK(id=1), account_id TEXT NOT NULL, utc_day TEXT NOT NULL, safe_limit INTEGER NOT NULL, used INTEGER NOT NULL, revoked INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS reservations (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, tenant_id TEXT NOT NULL, workload_id TEXT NOT NULL, request_sha TEXT NOT NULL, neurons INTEGER NOT NULL, PRIMARY KEY(grant_id, request_id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS grant_usage (grant_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workload_id TEXT NOT NULL, consumed INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS revocations (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL, reason TEXT NOT NULL)');
  }
  async reserve({signed,request_id,request_sha,neurons,tenant_id,workload_id}) {
    // Await external WebCrypto BEFORE starting the synchronous SQLite transaction.
    const now=this.now();
    const g=await validateGrant(signed,{publicKeyB64:this.publicKeyB64,nowSeconds:now,expectedAccount:this.accountId,expectedDay:this.utcDay});
    if (![request_id,tenant_id,workload_id].every(x=>typeof x==='string'&&SAFE_ASCII.test(x)) ||
        typeof request_sha!=='string'||!HEX64.test(request_sha)||
        !safeInt(neurons,1,g.max_per_call_neurons)||
        tenant_id!==g.tenant_id||workload_id!==g.workload_id)throw new Denied('WORKLOAD_REQUEST_DENIED');
    // Absolute time check after signature verification; midnight races fail closed.
    if (this.now()>=g.expires_at||isoDay(this.now())!==this.utcDay)throw new Denied('GRANT_STALE_AFTER_SIGNATURE');
    // An independently signed reduction must survive even if the new request
    // is later denied. Otherwise the previous, larger cap can be replayed.
    this.storage.transactionSync(()=>{
      const current=this.sql.exec('SELECT * FROM quota_meta WHERE id=1').toArray()[0];
      if(current && (current.account_id!==this.accountId || current.utc_day!==this.utcDay || current.revoked!==0))
        throw new Denied('ACCOUNT_STATE_DENIED');
      if (!current)
        this.sql.exec('INSERT INTO quota_meta(id,account_id,utc_day,safe_limit,used,revoked) VALUES(1,?,?,?,0,0)',this.accountId,this.utcDay,g.daily_capacity_neurons);
      else if (g.daily_capacity_neurons<current.safe_limit)
        this.sql.exec('UPDATE quota_meta SET safe_limit=? WHERE id=1',g.daily_capacity_neurons);
    });
    if (this.now()>=g.expires_at || isoDay(this.now())!==this.utcDay)throw new Denied('GRANT_STALE_AFTER_CAP_REDUCTION');
    return this.storage.transactionSync(()=>{
      const current=this.sql.exec('SELECT * FROM quota_meta WHERE id=1').toArray()[0];
      if(current&&(current.account_id!==this.accountId||current.utc_day!==this.utcDay||current.revoked!==0))throw new Denied('ACCOUNT_STATE_DENIED');
      const oldLimit=current?current.safe_limit:g.daily_capacity_neurons;
      const safeLimit=Math.min(oldLimit,g.daily_capacity_neurons); // limit can only shrink
      const used=current?current.used:0;
      // Keep idempotent retries idempotent, but never allow same request to change payload.
      const existing=this.sql.exec('SELECT * FROM reservations WHERE grant_id=? AND request_id=?',g.grant_id,request_id).toArray()[0];
      if(existing) {
        if(existing.tenant_id!==tenant_id||existing.workload_id!==workload_id||existing.request_sha!==request_sha||existing.neurons!==neurons)throw new Denied('IDEMPOTENCY_CONFLICT');
        return {status:'ALREADY_RESERVED',dispatch_allowed:false,grant_id:g.grant_id,request_id,neurons,used,safe_limit:oldLimit};
      }
      const usage=this.sql.exec('SELECT * FROM grant_usage WHERE grant_id=?',g.grant_id).toArray()[0];
      if(usage&&(usage.tenant_id!==tenant_id||usage.workload_id!==workload_id))throw new Denied('GRANT_ID_CROSS_TENANT_REPLAY');
      if(usage&&usage.consumed>=g.max_calls)throw new Denied('GRANT_CALLS_EXHAUSTED');
      if(used+neurons>safeLimit)throw new Denied('ACCOUNT_DAILY_CAPACITY_EXHAUSTED');
      if(!current) this.sql.exec('INSERT INTO quota_meta(id,account_id,utc_day,safe_limit,used,revoked) VALUES(1,?,?,?, ?,0)',this.accountId,this.utcDay,safeLimit,used+neurons);
      else this.sql.exec('UPDATE quota_meta SET safe_limit=?,used=? WHERE id=1',safeLimit,used+neurons);
      this.sql.exec('INSERT INTO reservations(grant_id,request_id,tenant_id,workload_id,request_sha,neurons) VALUES(?,?,?,?,?,?)',g.grant_id,request_id,tenant_id,workload_id,request_sha,neurons);
      if(usage)this.sql.exec('UPDATE grant_usage SET consumed=? WHERE grant_id=?',usage.consumed+1,g.grant_id);
      else this.sql.exec('INSERT INTO grant_usage(grant_id,tenant_id,workload_id,consumed) VALUES(?,?,?,1)',g.grant_id,tenant_id,workload_id);
      return {status:'RESERVED',dispatch_allowed:true,grant_id:g.grant_id,request_id,neurons,used:used+neurons,safe_limit:safeLimit};
    });
  }
  async revoke({signed}){
    const rev=await validateRevocation(signed,{publicKeyB64:this.publicKeyB64, nowSeconds:this.now(), expectedAccount:this.accountId, expectedDay:this.utcDay});
    if(this.now()>=rev.expires_at||isoDay(this.now())!==this.utcDay)throw new Denied('REVOCATION_EXPIRED');
    return this.storage.transactionSync(()=>{
      const old=this.sql.exec('SELECT * FROM revocations WHERE id=1').toArray()[0];
      if(old){
        if(rev.sequence<old.sequence)throw new Denied('REVOCATION_ROLLBACK_DENIED');
        if(rev.sequence===old.sequence){
          if(old.reason!==rev.reason)throw new Denied('REVOCATION_SEQUENCE_COLLISION');
          return {status:'ALREADY_REVOKED',sequence:rev.sequence};
        }
        this.sql.exec('UPDATE revocations SET sequence=?,reason=? WHERE id=1',rev.sequence,rev.reason);
      }else this.sql.exec('INSERT INTO revocations(id,sequence,reason) VALUES(1,?,?)',rev.sequence,rev.reason);
      const row=this.sql.exec('SELECT * FROM quota_meta WHERE id=1').toArray()[0];
      if(!row)this.sql.exec('INSERT INTO quota_meta(id,account_id,utc_day,safe_limit,used,revoked) VALUES(1,?,?,0,0,1)',this.accountId,this.utcDay);
      else this.sql.exec('UPDATE quota_meta SET revoked=1 WHERE id=1');
      return {status:'REVOKED',sequence:rev.sequence};
    });
  }
  // Test-only hooks MUST NOT be exposed on the production DO RPC surface.
  revokeForTestOnly(){return this.storage.transactionSync(()=>{
    const row=this.sql.exec('SELECT * FROM quota_meta WHERE id=1').toArray()[0];
    if (!row) this.sql.exec('INSERT INTO quota_meta(id,account_id,utc_day,safe_limit,used,revoked) VALUES(1,?,?,0,0,1)',this.accountId,this.utcDay);
    else this.sql.exec('UPDATE quota_meta SET revoked=1 WHERE id=1');
  });}
  snapshotForTestOnly(){return this.sql.exec('SELECT * FROM quota_meta WHERE id=1').toArray()[0]??null;}
}
