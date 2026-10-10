/** Operator-only, insert-only manual recipient suppression.
 * Works while sending is paused; stores tenant-scoped keyed HMAC, never PII.
 * Unblocking is deliberately unsupported.
 */
import {createHmac} from 'node:crypto';
import {normalizeRecipientAddress} from '../policy.mjs';
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
function privacyKey(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length>128)
   throw Error('SUPPRESSION_KEY_UNAVAILABLE');
 const key=Buffer.from(value,'base64');
 if(key.length<32||key.length>64||key.toString('base64')!==value)
   throw Error('SUPPRESSION_KEY_UNAVAILABLE');
 return key;
}
/** Key material must be the same independently managed HMAC key as DurableMailFabric. */
export async function addOperatorSuppression(db,{tenantId,recipient,privacyKeyBase64,now=Date.now}={}){
 if(!db?.prepare||typeof tenantId!=='string'||!TENANT.test(tenantId))
   throw Error('SUPPRESSION_STORE_UNAVAILABLE');
 const normalized=normalizeRecipientAddress(recipient);
 const digest=createHmac('sha256',privacyKey(privacyKeyBase64)).update(normalized).digest('hex');
 const at=now();
 if(!Number.isSafeInteger(at)||at<=0)throw Error('SUPPRESSION_CLOCK_INVALID');
 const result=await db.prepare('INSERT OR IGNORE INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)')
   .bind(tenantId,digest,at).run();
 if(result?.success!==true||!Number.isSafeInteger(result?.meta?.changes)||![0,1].includes(result.meta.changes))
   throw Error('SUPPRESSION_STORE_UNAVAILABLE');
 return Object.freeze({suppressed:true,created:result.meta.changes===1});
}
