import {createHash,randomBytes} from 'node:crypto';

const digest=x=>createHash('sha256').update(x).digest('hex');
const DOMAIN=/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const CHALLENGE_TTL=3600_000;
const VERIFY_TTL=90*86400_000;
export class SenderVerificationError extends Error{constructor(code){super(code);this.name='SenderVerificationError';this.code=code;}}
function validDomain(domain){if(typeof domain!=='string'||domain!==domain.toLowerCase()||!DOMAIN.test(domain)||/\b(?:invalid|local|internal)$/.test(domain))throw new SenderVerificationError('INVALID_DOMAIN');return domain;}
/** Verify DNS ownership independently of any API-client assertions. */
export async function dnsTxtResolver(name,{fetchImpl=fetch}={}){
 if(!name.startsWith('_mmf-verify.')||!DOMAIN.test(name.slice('_mmf-verify.'.length)))throw new SenderVerificationError('INVALID_DOMAIN');
 const url='https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(name)+'&type=TXT';
 let response,data;
 try{response=await fetchImpl(url,{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(8000)});data=await response.json();}catch{throw new SenderVerificationError('DNS_UNAVAILABLE');}
 if(!response.ok||data?.Status!==0||!Array.isArray(data?.Answer))throw new SenderVerificationError('DNS_UNAVAILABLE');
 return data.Answer.filter(x=>x.type===16).map(x=>String(x.data||'').replaceAll('"','').trim());
}
export class SenderRegistry {
 constructor({db,tenantId,now=Date.now,resolver=dnsTxtResolver}={}){
  if(!db?.prepare||!TENANT.test(String(tenantId||''))||typeof resolver!=='function')throw new TypeError('Invalid sender registry configuration');
  this.db=db;this.tenantId=tenantId;this.now=now;this.resolver=resolver;
 }
 async issue(domain){
  validDomain(domain);
  const token=randomBytes(32).toString('base64url'),txtValue='musitu-mail-fabric-v1='+token,now=this.now();
  const r=await this.db.prepare(`INSERT INTO mail_sender_domains(tenant_id,domain,challenge_sha256,challenge_expires_ms,verified_until_ms,status,updated_ms)
   VALUES(?,?,?,?,0,'PENDING',?) ON CONFLICT(tenant_id,domain) DO UPDATE SET challenge_sha256=excluded.challenge_sha256,
   challenge_expires_ms=excluded.challenge_expires_ms,verified_until_ms=0,status='PENDING',updated_ms=excluded.updated_ms`)
   .bind(this.tenantId,domain,digest(txtValue),now+CHALLENGE_TTL,now).run();
  if(!r?.success)throw new SenderVerificationError('STORE_UNAVAILABLE');
  return {domain,txtName:'_mmf-verify.'+domain,txtValue,expiresAt:new Date(now+CHALLENGE_TTL).toISOString()};
 }
 async isVerified(domain){
  validDomain(domain);
  const row=await this.db.prepare('SELECT status,verified_until_ms FROM mail_sender_domains WHERE tenant_id=? AND domain=?').bind(this.tenantId,domain).first();
  return row?.status==='VERIFIED'&&Number(row.verified_until_ms)>this.now();
 }
 async verify(domain){
  validDomain(domain);
  const row=await this.db.prepare('SELECT * FROM mail_sender_domains WHERE tenant_id=? AND domain=?').bind(this.tenantId,domain).first();
  if(!row||row.status==='REVOKED')throw new SenderVerificationError('CHALLENGE_NOT_FOUND');
  if(row.status==='VERIFIED')return {verified:await this.isVerified(domain)};
  if(this.now()>Number(row.challenge_expires_ms))throw new SenderVerificationError('CHALLENGE_EXPIRED');
  let records;
  try{records=await this.resolver('_mmf-verify.'+domain);}catch{throw new SenderVerificationError('DNS_UNAVAILABLE');}
  if(!Array.isArray(records)||!records.some(x=>typeof x==='string'&&digest(x.trim().replace(/^"|"$/g,''))===row.challenge_sha256))throw new SenderVerificationError('DNS_CHALLENGE_MISMATCH');
  const result=await this.db.prepare(`UPDATE mail_sender_domains SET status='VERIFIED',verified_until_ms=?,updated_ms=? WHERE tenant_id=? AND domain=? AND challenge_sha256=? AND status='PENDING' AND challenge_expires_ms>=?`)
   .bind(this.now()+VERIFY_TTL,this.now(),this.tenantId,domain,row.challenge_sha256,this.now()).run();
  if(!result?.success||result.meta?.changes!==1)throw new SenderVerificationError('CHALLENGE_EXPIRED');
  return {verified:true};
 }
 async revoke(domain){
  validDomain(domain);
  const r=await this.db.prepare(`UPDATE mail_sender_domains SET status='REVOKED',verified_until_ms=0,challenge_sha256='',updated_ms=? WHERE tenant_id=? AND domain=?`).bind(this.now(),this.tenantId,domain).run();
  if(!r?.success)throw new SenderVerificationError('STORE_UNAVAILABLE');
  return {revoked:true};
 }
}
