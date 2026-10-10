import {createHmac,createHash,timingSafeEqual} from 'node:crypto';

export class WebhookVerificationError extends Error {
  constructor(){super('WEBHOOK_AUTH_FAILED');this.name='WebhookVerificationError';this.code='WEBHOOK_AUTH_FAILED';}
}
const header=(headers,name)=>headers instanceof Headers?headers.get(name):headers?.[name]??headers?.[name.toLowerCase()];
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const MAX_BYTES=65536;
const TYPES=new Set(['email.delivered','email.bounced','email.complained','email.delivery_delayed']);
/** Svix HMAC over the ORIGINAL raw body; reject replay outside five-minute window. */
export function verifyResendWebhook(raw,headers,secret,{now=Date.now,maxSkewSeconds=300}={}){
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_BYTES||!raw.length||typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/=_-]{32,}$/.test(secret))throw new WebhookVerificationError();
  const id=header(headers,'svix-id'),ts=header(headers,'svix-timestamp'),sig=header(headers,'svix-signature');
  if(typeof id!=='string'||!/^[A-Za-z0-9._:-]{4,200}$/.test(id)||typeof ts!=='string'||!/^[0-9]{10,11}$/.test(ts)||typeof sig!=='string'||sig.length>2000)throw new WebhookVerificationError();
  const instant=typeof now==='function'?now():now;
  const delta=Math.abs(instant/1000-Number(ts));
  if(!Number.isFinite(delta)||delta>maxSkewSeconds)throw new WebhookVerificationError();
  const secretPart=secret.slice(6).replace(/-/g,'+').replace(/_/g,'/');
  const key=Buffer.from(secretPart,'base64');if(key.length<24)throw new WebhookVerificationError();
  const expected=createHmac('sha256',key).update(`${id}.${ts}.${raw}`).digest();
  const valid=sig.split(' ').some(part=>{
    const match=part.match(/^v1,([A-Za-z0-9+/=_-]+)$/);if(!match)return false;
    const candidate=Buffer.from(match[1].replace(/-/g,'+').replace(/_/g,'/'),'base64');
    return candidate.length===expected.length&&timingSafeEqual(expected,candidate);
  });
  if(!valid)throw new WebhookVerificationError();
  return Object.freeze({id,rawSha256:hash(raw)});
}
export async function processResendWebhook(fabric,raw,headers,{secret,now=Date.now,strictRecipient=false}={}){
  const verified=verifyResendWebhook(raw,headers,secret,{now});
  let event;try{event=JSON.parse(raw);}catch{throw new TypeError('INVALID_WEBHOOK_EVENT');}
  if(!event||typeof event!=='object'||!TYPES.has(event.type)||typeof event.data?.email_id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(event.data.email_id)){
    return {recorded:false,reason:'UNSUPPORTED_EVENT'};
  }
  // Resend publishes one recipient per outcome (2026 contract). Strict mode
  // binds the signed recipient to the original tenant-scoped opaque HMAC.
  let recipient;
  if(strictRecipient){
    const to=event.data?.to;
    if(!Array.isArray(to)||to.length!==1||typeof to[0]!=='string'||
       to[0].length>254||!/^[^\s@<>]{1,64}@[A-Za-z0-9.-]{1,190}$/.test(to[0])||
       to[0].startsWith('.')||to[0].endsWith('.')||to[0].includes('..'))
      throw new TypeError('INVALID_WEBHOOK_RECIPIENT');
    recipient=to[0].toLowerCase();
  }
  const outcome=await fabric.recordProviderEvent({svixId:verified.id,rawSha256:verified.rawSha256,
    type:event.type,providerId:event.data.email_id,recipient});
  // Signed provider feedback can arrive before a send's acceptance and
  // provider ID are durably finalized. In production, tell Resend to retry
  // instead of returning 2xx and silently discarding the event.
  if(strictRecipient&&outcome?.reason==='UNRELATED_PROVIDER_ID')
    throw Error('PROVIDER_CORRELATION_PENDING');
  return outcome;
}
