/**
 * MMF isolated commercial-domain kernel. NOT a public service or production
 * billing bridge. All subject identities must originate from a verified OIDC
 * session in a separately reviewed gateway, NEVER directly from an HTTP body.
 * No Paynow request, email send, tax invoice, entitlement activation or public
 * route is possible from this file.
 */
import {createHash,createHmac,createPublicKey,randomBytes,verify,timingSafeEqual} from 'node:crypto';
import {mmfTransaction} from './mmf-db-transaction.mjs';
export const Catalog=Object.freeze({
 LAUNCH:Object.freeze({sku:'mmf-launch-v1',amountCents:9900,currency:'USD',period:'month',monthlyEvents:5000,domainLimit:1,commerciallyReleased:false}),
 GROWTH:Object.freeze({sku:'mmf-growth-v1',amountCents:29900,currency:'USD',period:'month',monthlyEvents:30000,domainLimit:3,commerciallyReleased:false}),
 BUSINESS:Object.freeze({sku:'mmf-business-v1',amountCents:89900,currency:'USD',period:'month',monthlyEvents:100000,domainLimit:10,commerciallyReleased:false}),
 ENTERPRISE:'CONTACT_SALES'
});
const deny=()=>{throw Error('MMF_PLATFORM_DENIED')};
const ID=/^[a-z][a-z0-9-]{2,45}$/;
const SUBJECT=/^oidc:[A-Za-z0-9._:-]{8,130}$/;
const DOMAIN=/^(?=.{4,190}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const ORDER=/^MMF-ORDER-[A-Z0-9]{8,50}$/;
const IDEM=/^EVENT-[A-Z0-9_-]{8,80}$/;
const HASH=/^[a-f0-9]{64}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const CLAIM_KEYS=['schema','product','tenantId','orderReference','planCode','amountCents','currency','provider','providerReferenceSha256','status','observedAtMs'];
const STATUS=new Set(['pending','paid','failed','cancelled','reversed','disputed']);
const STATES={pending:'PENDING',paid:'PAID_ATTESTED_STAGE',failed:'FAILED',cancelled:'CANCELLED',reversed:'REVERSED',disputed:'DISPUTED'};
const safeObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const parsePlan=c=>{if(!Object.hasOwn(Catalog,c)||c==='ENTERPRISE')deny();return Catalog[c]};
const hash=s=>createHash('sha256').update(s).digest('hex');
const ms=x=>{if(!Number.isSafeInteger(x)||x<=0)deny();return x};
export function canonicalCommerceClaim(c){
 if(!safeObj(c)||Object.keys(c).length!==CLAIM_KEYS.length||
    !CLAIM_KEYS.every(k=>Object.hasOwn(c,k))||c.schema!=='mmf-commerce-claim-v1'||
    c.product!=='musitu-mail-fabric'||!ID.test(c.tenantId)||!ORDER.test(c.orderReference)||
    !Object.hasOwn(Catalog,c.planCode)||c.planCode==='ENTERPRISE'||
    c.amountCents!==parsePlan(c.planCode).amountCents||c.currency!=='USD'||c.provider!=='paynow'||
    !HASH.test(c.providerReferenceSha256)||!STATUS.has(c.status))deny();
 ms(c.observedAtMs);
 return Buffer.from(JSON.stringify(Object.fromEntries(CLAIM_KEYS.map(k=>[k,c[k]]))));
}
const ddl=`
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS mmf_tenants(tenant_id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, created_ms INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS mmf_api_keys(key_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES mmf_tenants(tenant_id), secret_hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL CHECK(scope IN ('events:write','events:read','billing:read')), revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))) STRICT;
CREATE TABLE IF NOT EXISTS mmf_domains(domain TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES mmf_tenants(tenant_id), challenge_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING_DNS','DNS_VERIFIED_STAGE'))) STRICT;
CREATE TABLE IF NOT EXISTS mmf_subscriptions(order_ref TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES mmf_tenants(tenant_id), plan_code TEXT NOT NULL, price_cents INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','PAID_ATTESTED_STAGE','FAILED','CANCELLED','REVERSED','DISPUTED')), provider_ref TEXT UNIQUE, last_event_ms INTEGER NOT NULL, created_ms INTEGER NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS mmf_subscriptions_tenant ON mmf_subscriptions(tenant_id,status);
CREATE TABLE IF NOT EXISTS mmf_payment_events(event_hash TEXT PRIMARY KEY, order_ref TEXT NOT NULL REFERENCES mmf_subscriptions(order_ref), tenant_id TEXT NOT NULL, observed_ms INTEGER NOT NULL, status TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS mmf_usage_events(tenant_id TEXT NOT NULL REFERENCES mmf_tenants(tenant_id), idempotency_key TEXT NOT NULL, kind TEXT NOT NULL, period TEXT NOT NULL, created_ms INTEGER NOT NULL, PRIMARY KEY(tenant_id,idempotency_key)) STRICT;
CREATE INDEX IF NOT EXISTS mmf_usage_period ON mmf_usage_events(tenant_id,period);
`;
export class CommercialPlatform {
 constructor(db,{apiPepper,trustedPaymentKey,now=Date.now,env}={}){
  if(!db?.prepare||!db?.exec||!apiPepper||Buffer.from(apiPepper).length!==32||
     !trustedPaymentKey||typeof now!=='function'||!env||env.MMF_REAL_SEND_ENABLED!=='false'||
     env.MMF_COMMERCE_ENABLED!=='false'||env.MMF_CUSTOMER_API_ENABLED!=='false')deny();
  const key=trustedPaymentKey?.type==='public'?trustedPaymentKey:createPublicKey(trustedPaymentKey);
  if(key.asymmetricKeyType!=='ed25519')deny();
  this.db=db;this.apiPepper=Buffer.from(apiPepper);this.trustedPaymentKey=key;this.now=now;
  db.exec(ddl);
 }
 #auth(tenantId,actorSubject){
  if(!ID.test(tenantId)||typeof actorSubject!=='string'||!SUBJECT.test(actorSubject))deny();
  const found=this.db.prepare('SELECT owner_subject FROM mmf_tenants WHERE tenant_id=?').get(tenantId);
  if(!found||found.owner_subject!==actorSubject)deny();
 }
 createTenant({tenantId,ownerSubject}){
  if(typeof tenantId!=='string'||!ID.test(tenantId)||typeof ownerSubject!=='string'||!SUBJECT.test(ownerSubject))deny();
  const existing=this.db.prepare('SELECT owner_subject FROM mmf_tenants WHERE tenant_id=?').get(tenantId);
  if(existing)deny();
  this.db.prepare('INSERT INTO mmf_tenants(tenant_id,owner_subject,created_ms) VALUES(?,?,?)').run(tenantId,ownerSubject,ms(this.now()));
  return Object.freeze({tenantId,product:'musitu-mail-fabric',customerApiEnabled:false});
 }
 issueApiKey({tenantId,actorSubject,scope}){
  this.#auth(tenantId,actorSubject);
  if(!['events:write','events:read','billing:read'].includes(scope))deny();
  const keyId=randomBytes(12).toString('hex');const token='mmf_stage_'+randomBytes(32).toString('base64url');
  const digest=createHmac('sha256',this.apiPepper).update(token).digest('hex');
  this.db.prepare('INSERT INTO mmf_api_keys(key_id,tenant_id,secret_hash,scope) VALUES(?,?,?,?)').run(keyId,tenantId,digest,scope);
  return Object.freeze({keyId,token,scope,customerApiEnabled:false});
 }
 authenticateApiKey(token,scope){
  if(typeof token!=='string'||!/^mmf_stage_[0-9A-Za-z_-]{43}$/.test(token)||!['events:write','events:read','billing:read'].includes(scope))deny();
  const digest=createHmac('sha256',this.apiPepper).update(token).digest('hex');
  const found=this.db.prepare('SELECT tenant_id,scope,secret_hash FROM mmf_api_keys WHERE secret_hash=? AND revoked=0').get(digest);
  if(!found||found.scope!==scope||!timingSafeEqual(Buffer.from(found.secret_hash),Buffer.from(digest)))deny();
  return Object.freeze({tenantId:found.tenant_id,scope,realSendingAuthorized:false});
 }
 revokeApiKey({tenantId,actorSubject,keyId}){
  this.#auth(tenantId,actorSubject);
  if(typeof keyId!=='string'||!/^[0-9a-f]{24}$/.test(keyId))deny();
  const out=this.db.prepare('UPDATE mmf_api_keys SET revoked=1 WHERE key_id=? AND tenant_id=? AND revoked=0').run(keyId,tenantId);
  if(out.changes!==1)deny();return true;
 }
 requestDomain({tenantId,actorSubject,domain}){
  this.#auth(tenantId,actorSubject);
  if(typeof domain!=='string'||domain!==domain.toLowerCase()||!DOMAIN.test(domain))deny();
  const allocated=this.db.prepare('SELECT COUNT(*) AS n FROM mmf_domains WHERE tenant_id=?').get(tenantId).n;
  if(allocated>=Catalog.LAUNCH.domainLimit)deny();
  const nonce=randomBytes(24).toString('base64url'),value='mmf-verify='+nonce;
  try{this.db.prepare("INSERT INTO mmf_domains(domain,tenant_id,challenge_hash,status) VALUES(?,?,?,'PENDING_DNS')").run(domain,tenantId,hash(value));}catch{deny()}
  return Object.freeze({domain,dnsName:'_mmf-verify.'+domain,txtValue:value,status:'PENDING_DNS',canSendMail:false});
 }
 async verifyDomainDns({tenantId,actorSubject,domain,resolveTxt}){
  this.#auth(tenantId,actorSubject);
  if(typeof domain!=='string'||!DOMAIN.test(domain)||typeof resolveTxt!=='function')deny();
  const r=this.db.prepare('SELECT * FROM mmf_domains WHERE domain=? AND tenant_id=?').get(domain,tenantId);
  if(!r||r.status!=='PENDING_DNS')deny();
  let records;try{records=await resolveTxt('_mmf-verify.'+domain);}catch{deny()}
  if(!Array.isArray(records)||records.length>40||!records.some(t=>Array.isArray(t)&&t.length<=12&&hash(t.join(''))===r.challenge_hash))deny();
  this.db.prepare("UPDATE mmf_domains SET status='DNS_VERIFIED_STAGE' WHERE domain=? AND tenant_id=?").run(domain,tenantId);
  return Object.freeze({domain,status:'DNS_VERIFIED_STAGE',canSendMail:false});
 }
 openSubscription({tenantId,actorSubject,planCode,orderReference}){
  this.#auth(tenantId,actorSubject);
  const plan=parsePlan(planCode);
  if(typeof orderReference!=='string'||!ORDER.test(orderReference))deny();
  const row=this.db.prepare('SELECT * FROM mmf_subscriptions WHERE order_ref=?').get(orderReference);
  if(row){if(row.tenant_id!==tenantId||row.plan_code!==planCode)deny();return this.#sub(row)}
  const at=ms(this.now());this.db.prepare("INSERT INTO mmf_subscriptions(order_ref,tenant_id,plan_code,price_cents,status,last_event_ms,created_ms) VALUES(?,?,?,?,'PENDING',?,?)").run(orderReference,tenantId,planCode,plan.amountCents,at,at);
  return this.#sub(this.db.prepare('SELECT * FROM mmf_subscriptions WHERE order_ref=?').get(orderReference));
 }
 #sub(row){return Object.freeze({tenantId:row.tenant_id,orderReference:row.order_ref,planCode:row.plan_code,amountCents:row.price_cents,status:row.status,liveEntitlement:false,canInitiatePaynow:false});}
 getSubscription({tenantId,actorSubject,orderReference}){
  this.#auth(tenantId,actorSubject);
  if(typeof orderReference!=='string'||!ORDER.test(orderReference))deny();
  const row=this.db.prepare('SELECT * FROM mmf_subscriptions WHERE order_ref=? AND tenant_id=?').get(orderReference,tenantId);
  return row?this.#sub(row):null;
 }
 ingestSignedPayment({claim,signature}={}){
  const bytes=canonicalCommerceClaim(claim);
  if(typeof signature!=='string'||!SIGNATURE.test(signature)||!verify(null,bytes,this.trustedPaymentKey,Buffer.from(signature,'base64url')))deny();
  const current=this.db.prepare('SELECT * FROM mmf_subscriptions WHERE order_ref=? AND tenant_id=?').get(claim.orderReference,claim.tenantId);
  if(!current||current.plan_code!==claim.planCode||current.price_cents!==claim.amountCents||
   claim.observedAtMs>this.now()+5*60*1000||claim.observedAtMs<this.now()-7*86400000||
   current.provider_ref&&current.provider_ref!==claim.providerReferenceSha256)deny();
  const digest=hash(bytes);
  const duplicate=this.db.prepare('SELECT 1 AS yes FROM mmf_payment_events WHERE event_hash=?').get(digest);
  if(duplicate){if(current.status!==STATES[claim.status])deny();return Object.freeze({status:current.status,idempotent:true,realProviderPaymentVerified:false});}
  // Never promote back to paid from a terminal negative/reversal/dispute event.
  const next=STATES[claim.status];
  const allowed=current.status==='PENDING'&&(['pending','paid','failed','cancelled'].includes(claim.status))||
    current.status==='PAID_ATTESTED_STAGE'&&(['reversed','disputed'].includes(claim.status));
  if(!allowed||claim.observedAtMs<current.last_event_ms)deny();
  try{mmfTransaction(this.db,()=>{
   this.db.prepare('INSERT INTO mmf_payment_events(event_hash,order_ref,tenant_id,observed_ms,status) VALUES(?,?,?,?,?)').run(digest,claim.orderReference,claim.tenantId,claim.observedAtMs,claim.status);
   this.db.prepare('UPDATE mmf_subscriptions SET status=?,provider_ref=?,last_event_ms=? WHERE order_ref=? AND tenant_id=?').run(next,claim.providerReferenceSha256,claim.observedAtMs,claim.orderReference,claim.tenantId);
  });}catch{deny()}
  return Object.freeze({status:next,idempotent:false,realProviderPaymentVerified:false,canSendMail:false});
 }
 effectiveEntitlement({tenantId,actorSubject}){
  this.#auth(tenantId,actorSubject);
  return Object.freeze({tenantId,canSend:false,canPubliclyCharge:false,reason:'PRODUCTION_RELEASE_NOT_QUALIFIED'});
 }
 meterStageEvent({tenantId,actorSubject,idempotencyKey,kind}){
  this.#auth(tenantId,actorSubject);
  if(typeof idempotencyKey!=='string'||!IDEM.test(idempotencyKey)||!['governed','extra'].includes(kind))deny();
  const period=new Date(ms(this.now())).toISOString().slice(0,7);
  try{return mmfTransaction(this.db,()=>{
   const prior=this.db.prepare('SELECT kind,period FROM mmf_usage_events WHERE tenant_id=? AND idempotency_key=?').get(tenantId,idempotencyKey);
   if(prior&&(prior.kind!==kind||prior.period!==period))deny();
   const countBefore=this.db.prepare('SELECT COUNT(*) AS n FROM mmf_usage_events WHERE tenant_id=? AND period=?').get(tenantId,period).n;
   // Default preparation allowance; subscription entitlements NOT activated.
   if(!prior&&countBefore>=Catalog.LAUNCH.monthlyEvents)deny();
   if(!prior)this.db.prepare('INSERT INTO mmf_usage_events(tenant_id,idempotency_key,kind,period,created_ms) VALUES(?,?,?,?,?)').run(tenantId,idempotencyKey,kind,period,ms(this.now()));
   const count=prior?countBefore:countBefore+1;
   return Object.freeze({count,duplicate:Boolean(prior),period,productionDeliveryEnabled:false});
  });}catch{deny()}
 }
 getUsage({tenantId,actorSubject}){
  this.#auth(tenantId,actorSubject);
  const period=new Date(ms(this.now())).toISOString().slice(0,7);
  const count=this.db.prepare('SELECT COUNT(*) AS n FROM mmf_usage_events WHERE tenant_id=? AND period=?').get(tenantId,period).n;
  return Object.freeze({tenantId,period,count,productionDeliveryEnabled:false});
 }
}