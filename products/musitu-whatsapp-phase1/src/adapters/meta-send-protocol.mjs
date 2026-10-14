/**
 * OFFLINE ONLY — deterministic Meta WhatsApp Graph API request/receipt contract.
 * Does not contain fetch(), tokens, queues, outbox writes or release authority.
 * Do not treat an offline preparation as authorization to call this endpoint.
 *
 * Documentation reference: Meta's official WhatsApp Business Platform
 * Postman Cloud API /{Version}/{Phone-Number-ID}/messages collection.
 */
const VERSION=/^v[0-9]{1,3}\.[0-9]{1,2}$/;
const PHONE=/^[0-9]{6,20}$/;
const WAMID=/^wamid\.[A-Za-z0-9._~-]{1,180}$/;
const REQUEST_KEYS=new Set(['graphVersion','phoneNumberId','recipientWaId','body']);
const RECEIPT_KEYS=new Set(['httpStatus','response','expectedRecipient']);
const unknown=()=>({status:'UNKNOWN',providerMessageId:null,automaticRetry:false});
function exactKeys(raw,allowed){return raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).every(k=>allowed.has(k));}
export function buildMetaTextSubmission(raw={}){
 if(!exactKeys(raw,REQUEST_KEYS)||
    typeof raw.graphVersion!=='string'||!VERSION.test(raw.graphVersion)||
    typeof raw.phoneNumberId!=='string'||!PHONE.test(raw.phoneNumberId)||
    typeof raw.recipientWaId!=='string'||!PHONE.test(raw.recipientWaId)||
    typeof raw.body!=='string'||raw.body.length===0||raw.body.trim().length===0||
    raw.body.length>4096||raw.body.includes('\u0000'))throw Error('INVALID_META_SEND_REQUEST');
 return Object.freeze({
  url:`https://graph.facebook.com/${raw.graphVersion}/${raw.phoneNumberId}/messages`,
  body:{messaging_product:'whatsapp',to:raw.recipientWaId,type:'text',text:{body:raw.body,preview_url:false}}
 });
}
export function classifyMetaSendOutcome(raw={}){
 if(!exactKeys(raw,RECEIPT_KEYS)||typeof raw.expectedRecipient!=='string'||!PHONE.test(raw.expectedRecipient))
  throw Error('INVALID_META_RECEIPT_CONTEXT');
 const {httpStatus,response,expectedRecipient}=raw;
 if(httpStatus==null||!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599)return unknown();
 if(httpStatus>=500||httpStatus===408||httpStatus===429)return unknown();
 if(httpStatus>=400){
  const providerCode=response?.error?.code;
  const result={status:'REJECTED',providerMessageId:null,automaticRetry:false};
  if(Number.isInteger(providerCode)&&providerCode>=0)result.providerCode=providerCode;
  return result;
 }
 if(httpStatus!==200)return unknown();
 if(response?.messaging_product!=='whatsapp'||
    !Array.isArray(response?.contacts)||response.contacts.length!==1||
    response.contacts[0]?.wa_id!==expectedRecipient||
    !Array.isArray(response?.messages)||response.messages.length!==1||
    typeof response.messages[0]?.id!=='string'||!WAMID.test(response.messages[0].id))return unknown();
 return {status:'ACCEPTED',providerMessageId:response.messages[0].id,automaticRetry:false};
}
