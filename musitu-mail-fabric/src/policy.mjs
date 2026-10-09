/** Strict transactional-only policy. */
const ADDR=/^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const ID=/^[a-z][a-z0-9_-]{2,63}$/;
const IDEM=/^[A-Za-z0-9._:-]{8,128}$/;
const TYPES=new Set(['SECURITY','ACCOUNT','RECEIPT','SUPPORT','SERVICE_ALERT']);
export class PolicyRejection extends Error {constructor(code){super(code);this.name='PolicyRejection';this.code=code;}}
export function validateSubmission(input,config,suppressed){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new PolicyRejection('INVALID_REQUEST');
  const {tenantId,from,to,subject,text,kind,idempotencyKey}=input;
  if(typeof tenantId!=='string'||!ID.test(tenantId)||tenantId!==config.tenantId)throw new PolicyRejection('TENANT_NOT_AUTHORIZED');
  if(typeof from!=='string'||typeof to!=='string'||!ADDR.test(from)||!ADDR.test(to)||from.includes('\n')||to.includes('\n'))throw new PolicyRejection('INVALID_ADDRESS');
  if(typeof subject!=='string'||subject.trim().length<1||subject.length>160||/[\r\n\0]/.test(subject))throw new PolicyRejection('INVALID_SUBJECT');
  if(typeof text!=='string'||text.trim().length<1||Buffer.byteLength(text,'utf8')>25000)throw new PolicyRejection('INVALID_TEXT');
  if(typeof idempotencyKey!=='string'||!IDEM.test(idempotencyKey))throw new PolicyRejection('INVALID_IDEMPOTENCY_KEY');
  if(typeof kind!=='string'||!TYPES.has(kind))throw new PolicyRejection('PURPOSE_NOT_ALLOWED');
  const fromAddress=from.toLowerCase(),toAddress=to.toLowerCase();
  if(!config.verifiedDomains.includes(fromAddress.split('@')[1]))throw new PolicyRejection('DOMAIN_NOT_VERIFIED');
  if(config.denyExternalRecipients&&!config.allowedRecipientDomains?.includes(toAddress.split('@')[1]))throw new PolicyRejection('RECIPIENT_POLICY_REJECTED');
  if(suppressed.has(toAddress))throw new PolicyRejection('RECIPIENT_SUPPRESSED');
  if(!config.allowedRegions.includes(config.provider.region))throw new PolicyRejection('RESIDENCY_POLICY_REJECTED');
  return Object.freeze({tenantId,from:fromAddress,to:toAddress,subject,text,kind,idempotencyKey});
}
export function validateConfig(config){
  if(!config||!ID.test(config.tenantId||''))throw new TypeError('Invalid tenant configuration');
  if(!Array.isArray(config.verifiedDomains)||config.verifiedDomains.length<1||config.verifiedDomains.some(x=>typeof x!=='string'||x!==x.toLowerCase()||!ADDR.test('sender@'+x)))throw new TypeError('Verified sending domains required');
  if(!Array.isArray(config.allowedRegions)||!config.allowedRegions.length||config.allowedRegions.some(x=>typeof x!=='string'))throw new TypeError('Explicit legal data region policy required');
  if(typeof config.provider?.send!=='function'||typeof config.provider?.region!=='string')throw new TypeError('Delivery provider required');
  if(config.denyExternalRecipients&&(!Array.isArray(config.allowedRecipientDomains)||!config.allowedRecipientDomains.length))throw new TypeError('Explicit recipient domain policy required');
}
