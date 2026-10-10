/** Read-only, tenant-scoped operational diagnostics. No addresses, bodies, provider IDs or secrets leave this interface. */
import {createHash} from 'node:crypto';
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const STATES=Object.freeze(['QUEUED','SENDING','ACCEPTED_BY_PROVIDER','REJECTED_BY_PROVIDER','OUTCOME_UNKNOWN','BLOCKED_BY_POLICY']);
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function assessTenantHealth(db,{tenantId,now=Date.now,maxQueuedAgeMs=15*60000}={}){
 if(!db?.prepare||typeof tenantId!=='string'||!TENANT.test(tenantId)||
    typeof now!=='function'||!Number.isSafeInteger(maxQueuedAgeMs)||maxQueuedAgeMs<60000||maxQueuedAgeMs>86400000)
    throw new TypeError('INVALID_OPERATIONAL_SCOPE');
 try{
  const at=now();
  if(!Number.isSafeInteger(at)||at<=0)throw Error('INVALID_OPERATIONAL_CLOCK');
  const states=Object.fromEntries(STATES.map(s=>[s,0]));
  const group=await db.prepare('SELECT state,COUNT(*) AS n FROM mail_messages WHERE tenant_id=? GROUP BY state').bind(tenantId).all();
  for(const row of group.results||[]){
   if(!Object.hasOwn(states,row.state)||!Number.isSafeInteger(row.n)||row.n<0)
    throw Error('INVALID_STATE_COUNT');
   states[row.state]=row.n;
  }
  const oldest=await db.prepare("SELECT MIN(created_ms) AS oldest FROM mail_messages WHERE tenant_id=? AND state='QUEUED'").bind(tenantId).first();
  const stale=await db.prepare("SELECT COUNT(*) AS n FROM mail_messages WHERE tenant_id=? AND state='SENDING' AND lease_deadline<=?").bind(tenantId,at).first();
  const failures=await db.prepare("SELECT kind,COUNT(*) AS n FROM mail_provider_events WHERE tenant_id=? AND created_ms>=? AND kind IN ('email.bounced','email.complained') GROUP BY kind")
     .bind(tenantId,at-86400000).all();
  const bad={bounces24h:0,complaints24h:0};
  for(const e of failures.results||[]){
   const key=e.kind==='email.bounced'?'bounces24h':e.kind==='email.complained'?'complaints24h':null;
   if(!key||!Number.isSafeInteger(e.n)||e.n<0)throw Error('INVALID_PROVIDER_EVENT_COUNT');
   bad[key]=e.n;
  }
  const oldestQueuedAgeMs=oldest?.oldest===null||oldest?.oldest===undefined?null:Math.max(0,at-Number(oldest.oldest));
  if(oldestQueuedAgeMs!==null&&!Number.isSafeInteger(oldestQueuedAgeMs))throw Error('INVALID_QUEUE_AGE');
  const staleClaims=Number(stale?.n);
  if(!Number.isSafeInteger(staleClaims)||staleClaims<0)throw Error('INVALID_CLAIM_COUNT');
  const reasons=[];
  if(staleClaims>0)reasons.push('STALE_DELIVERY_CLAIMS');
  if(states.OUTCOME_UNKNOWN>0)reasons.push('AMBIGUOUS_PROVIDER_OUTCOMES');
  if(oldestQueuedAgeMs!==null&&oldestQueuedAgeMs>=maxQueuedAgeMs)reasons.push('QUEUE_BACKLOG_EXCEEDED');
  if(bad.complaints24h>0)reasons.push('RECIPIENT_COMPLAINTS_RECORDED');
  return Object.freeze({service:'MUSITU Mail Fabric',tenantHash:hash(tenantId),at:new Date(at).toISOString(),
   status:reasons.length?'ATTENTION_REQUIRED':'OK',reasons,
   metrics:{messageStates:states,staleClaims,oldestQueuedAgeMs,...bad},
   provenance:'LOCAL_DATABASE_OBSERVATION',note:'Provider reports are not inbox proof. No SLA or live transport health is inferred.'});
 }catch{throw Error('OPERATIONAL_STORE_UNAVAILABLE');}
}
