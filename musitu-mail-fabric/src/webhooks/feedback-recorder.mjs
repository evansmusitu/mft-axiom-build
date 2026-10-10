/** Narrow, receive-only signed-provider-event persistence.
 * No sender signing key, customer encryption key, recipient HMAC secret,
 * sending provider, customer API or general SQL storage credential.
 * Uses the owner-owned recipient-match capability in the scoped DB interface.
 */
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const PROVIDER=/^[A-Za-z0-9_-]{1,120}$/;
const EVENT=/^[A-Za-z0-9._:-]{4,200}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const KINDS=new Set(['email.delivered','email.bounced','email.complained','email.delivery_delayed']);
function ok(result){
 if(result?.success!==true)throw Error('FEEDBACK_STORE_UNAVAILABLE');
 return result;
}
export function createFeedbackRecorder({db,tenantId,now=Date.now}={}){
 if(!TENANT.test(String(tenantId||''))||typeof db?.prepare!=='function'||
    typeof db.matchRecipient!=='function'||typeof now!=='function')
   throw TypeError('SCOPED_FEEDBACK_RECEIVER_REQUIRED');
 const suppress=async(type,providerId)=>{
  if(type!=='email.bounced'&&type!=='email.complained')return;
  const r=await db.prepare("SELECT recipient_hmac FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'")
    .bind(tenantId,providerId).first();
  if(typeof r?.recipient_hmac!=='string'||!DIGEST.test(r.recipient_hmac))
   throw Error('FEEDBACK_RECIPIENT_NOT_FOUND');
  ok(await db.prepare('INSERT OR IGNORE INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)')
    .bind(tenantId,r.recipient_hmac,now()).run());
 };
 return Object.freeze({
  async recordProviderEvent({svixId,rawSha256,type,providerId,recipient}={}){
   if(typeof svixId!=='string'||!EVENT.test(svixId)||!DIGEST.test(rawSha256||'')||
      !KINDS.has(type)||typeof providerId!=='string'||!PROVIDER.test(providerId)||
      typeof recipient!=='string'||recipient.length>254)
     throw TypeError('INVALID_PROVIDER_EVENT');
   // Crucial: signed origin alone does not establish which accepted transaction
   // owns the recipient; the owner DO performs this check without releasing key material.
   const match=await db.matchRecipient(tenantId,providerId,recipient.toLowerCase());
   if(match===false)throw Error('PROVIDER_RECIPIENT_MISMATCH');
   if(match===null)return {recorded:false,reason:'UNRELATED_PROVIDER_ID'};
   if(match!==true)throw Error('PROVIDER_CORRELATION_UNVERIFIED');
   const prior=await db.prepare('SELECT * FROM mail_provider_events WHERE tenant_id=? AND svix_id=?')
     .bind(tenantId,svixId).first();
   if(prior){
    if(prior.raw_sha256!==rawSha256||prior.kind!==type||prior.provider_id!==providerId)
      throw Error('WEBHOOK_ID_CONFLICT');
    await suppress(type,providerId);
    return {recorded:false,reason:'DUPLICATE_EVENT'};
   }
   const row=await db.prepare("SELECT message_id FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'")
     .bind(tenantId,providerId).first();
   if(typeof row?.message_id!=='string')return {recorded:false,reason:'UNRELATED_PROVIDER_ID'};
   const result=ok(await db.prepare('INSERT OR IGNORE INTO mail_provider_events(tenant_id,svix_id,message_id,provider_id,kind,raw_sha256,created_ms) VALUES(?,?,?,?,?,?,?)')
     .bind(tenantId,svixId,row.message_id,providerId,type,rawSha256,now()).run());
   if(result.meta?.changes!==1){
    const existing=await db.prepare('SELECT * FROM mail_provider_events WHERE tenant_id=? AND svix_id=?')
      .bind(tenantId,svixId).first();
    if(!existing||existing.raw_sha256!==rawSha256||existing.kind!==type||existing.provider_id!==providerId)
     throw Error('WEBHOOK_ID_CONFLICT');
    await suppress(type,providerId);
    return {recorded:false,reason:'DUPLICATE_EVENT'};
   }
   await suppress(type,providerId);
   return {recorded:true};
  }
 });
}
