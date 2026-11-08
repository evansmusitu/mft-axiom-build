import {createHmac, timingSafeEqual} from 'node:crypto';

/** Verify a Meta X-Hub-Signature-256 header against the *original raw bytes*.
 * This function does not authenticate a WABA/phone mapping or authorize a reply.
 */
export function verifyMetaSignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof appSecret !== 'string' || !appSecret ||
      typeof signature !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const actual=Buffer.from(signature.slice(7),'hex');
  const expected=createHmac('sha256',appSecret).update(rawBody).digest();
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}

/** Extract canonical inbound-message identifiers only after authenticating the
 * envelope separately. The caller MUST persist these using a unique DB key.
 */
export function resolveWebhookEvents(payload, bindings) {
  if (payload?.object!=='whatsapp_business_account' || !Array.isArray(payload.entry) ||
      !Array.isArray(bindings)) throw new Error('INVALID_META_WEBHOOK');
  const result=[];
  for (const entry of payload.entry) {
    if (typeof entry?.id!=='string' || !Array.isArray(entry.changes)) throw new Error('INVALID_META_WEBHOOK');
    for (const change of entry.changes) {
      if (change.field!=='messages') continue;
      const phoneId=change.value?.metadata?.phone_number_id;
      if (typeof phoneId!=='string' || !phoneId) throw new Error('UNAUTHORIZED_CHANNEL');
      const matching=bindings.filter(b=>b.phoneNumberId===phoneId&&b.wabaId===entry.id);
      if (matching.length!==1 || typeof matching[0].tenantId!=='string' || !matching[0].tenantId) {
        throw new Error('UNAUTHORIZED_CHANNEL');
      }
      const tenantId=matching[0].tenantId;
      if (change.value?.messages!==undefined && !Array.isArray(change.value.messages)) throw new Error('INVALID_META_WEBHOOK');
      for (const msg of change.value?.messages||[]) {
        if (typeof msg?.id!=='string' || !msg.id) throw new Error('INVALID_META_WEBHOOK');
        result.push({tenantId,wabaId:entry.id,phoneNumberId:phoneId,providerMessageId:msg.id,direction:'inbound'});
      }
    }
  }
  return result;
}
