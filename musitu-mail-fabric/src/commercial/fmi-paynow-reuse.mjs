/**
 * MUSITU Mail Fabric -> existing MUSITU payment authority integration contract.
 * No merchant registration, new Paynow account, stored merchant secret or FMI-plan
 * checkout is created here. Staging-only until an authorized MMF product binding
 * is deployed and independently verified. Never accepts a client-reported "paid".
 *
 * FMI checkout has *FMI-only* plans FOUNDING/PRO; this is a DISTINCT MMF SKU.
 * The existing verified Paynow merchant/Phase-8 transport is to be reused by
 * the product-authorized server-side authority, not called directly by browsers.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';

export const SHARED_MUSITU_PAYNOW = Object.freeze({
  merchantSystem: 'MUSITU existing Paynow integration',
  authorityWorker: 'mft-phase8-external-authority',
  transportWorker: 'mft-paynow-transport-gateway',
  fmiBillingWorker: 'mft-fmi-billing',
  commerceOrigin: 'https://payments.mftintelligence.com',
  allowlistedProviderHosts: Object.freeze(['paynow.co.zw','www.paynow.co.zw']),
  directMerchantCredentialsAtMailFabric: false,
  existingFmiPlanReuseAllowed: false,
  newMerchantRegistrationRequired: false
});

// Price is a PROPOSED amount until a signed legal offer fixes the terms.
export const MMF_PREPARATION_SKU=Object.freeze({
  product: 'musitu-mail-fabric',
  sku: 'mmf-verified-communications-readiness-v1',
  amountCents: 9900,
  currency: 'USD',
  billingMode: 'one_time',
  grantsMailSending: false,
  pricingStatus: 'PROPOSAL_NOT_APPROVED'
});

const ORD=/^MMF-[A-Z0-9]{10,56}$/;
const ID=/^[a-z][a-z0-9_-]{2,63}$/;
const REF=/^[A-Za-z][A-Za-z0-9_.:-]{9,120}$/;
const HASH=/^[a-f0-9]{64}$/;
const isRecord=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const shape=(x,keys)=>isRecord(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function deny(){throw new Error('MMF_SHARED_PAYNOW_DENIED');}

// This stage only validates exact product identity; it MUST NOT initiate funds.
export function draftMmfFmiPaynowQuote(data){
 if(!shape(data,['tenantId','customerReference','contractReference','orderReference'])||
    !ID.test(data.tenantId)||!REF.test(data.customerReference)||
    !REF.test(data.contractReference)||!ORD.test(data.orderReference))deny();
 return Object.freeze({schema:'mmf-shared-paynow-quote-v1',
  ...MMF_PREPARATION_SKU,tenantId:data.tenantId,
  customerReference:data.customerReference,
  contractReference:data.contractReference,
  orderReference:data.orderReference,
  authorityWorker:SHARED_MUSITU_PAYNOW.authorityWorker,
  transportWorker:SHARED_MUSITU_PAYNOW.transportWorker});
}

// Provider URL allowlist: do not accept any URL merely containing paynow.co.zw.
export function validatePaynowCheckoutUrl(value){
 if(typeof value!=='string'||value.length>850||!value.startsWith('https://'))deny();
 let u;try{u=new URL(value);}catch{deny();}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||
    !SHARED_MUSITU_PAYNOW.allowlistedProviderHosts.includes(u.hostname.toLowerCase())||
    !/^\/Payment\/ConfirmPayment\/[0-9]{4,24}\/?$/.test(u.pathname)||
    u.search)deny();
 return u.toString();
}

/**
 * A complete receipt from the (future) MMF-specific billing bridge must be
 * independently signed by the trusted existing MUSITU payment authority's
 * separately provisioned and fingerprint-pinned Ed25519 signing key.
 * Existing FMI entitlements or FMI 'paid' statuses are NOT usable for MMF.
 * This does NOT enable sending or turn a receipt into a mail entitlement.
 */
const CLAIM_FIELDS=['schema','product','sku','tenantId','orderReference','contractReference',
 'provider','paymentAuthority','providerReferenceSha256','amountCents','currency','status','settledAtMs'];
export function canonicalMmfPaymentClaim(claim){
 if(!shape(claim,CLAIM_FIELDS)||claim.schema!=='mmf-paynow-settlement-v1'||
  claim.product!==MMF_PREPARATION_SKU.product||claim.sku!==MMF_PREPARATION_SKU.sku||
  !ID.test(claim.tenantId)||!ORD.test(claim.orderReference)||!REF.test(claim.contractReference)||
  claim.provider!=='paynow'||claim.paymentAuthority!==SHARED_MUSITU_PAYNOW.authorityWorker||
  !HASH.test(claim.providerReferenceSha256)||claim.amountCents!==MMF_PREPARATION_SKU.amountCents||
  claim.currency!=='USD'||claim.status!=='paid'||
  !Number.isSafeInteger(claim.settledAtMs)||claim.settledAtMs<=0)deny();
 return Buffer.from(JSON.stringify(Object.fromEntries(CLAIM_FIELDS.map(k=>[k,claim[k]]))));
}
export function verifyMmfPaynowSettlement({claim,signature},quote,{publicKeyPem,fingerprint,nowMs=Date.now()}={}){
 try{
  if(!shape(quote,['schema',...Object.keys(MMF_PREPARATION_SKU),'tenantId','customerReference',
       'contractReference','orderReference','authorityWorker','transportWorker'])||
     !shape({claim,signature},['claim','signature']))deny();
  const trustedQuote=draftMmfFmiPaynowQuote({tenantId:quote.tenantId,
    customerReference:quote.customerReference,contractReference:quote.contractReference,
    orderReference:quote.orderReference});
  if(JSON.stringify(quote)!==JSON.stringify(trustedQuote))deny();
  const bytes=canonicalMmfPaymentClaim(claim);
  if(claim.tenantId!==quote.tenantId||claim.orderReference!==quote.orderReference||
     claim.contractReference!==quote.contractReference||
     !Number.isSafeInteger(nowMs)||claim.settledAtMs>nowMs+300000||
     nowMs-claim.settledAtMs>366*86400000)deny();
  if(typeof publicKeyPem!=='string'||publicKeyPem.length>4000||
     typeof fingerprint!=='string'||!HASH.test(fingerprint)||
     typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))deny();
  const key=createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=='ed25519')deny();
  const observed=createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
  if(observed!==fingerprint||!verify(null,bytes,key,Buffer.from(signature,'base64url')))deny();
  return Object.freeze({verified:true,product:claim.product,sku:claim.sku,
   tenantId:claim.tenantId,orderReference:claim.orderReference,
   provider:'paynow',settlementConfirmed:true,
   canEnableMailSending:false,canProvisionFmiPlan:false,
   status:'PAYMENT_EVIDENCE_ONLY_CONTRACT_REVIEW_REQUIRED'});
 }catch{deny();}
}

/**
 * The existing FMI payment service has no verified MMF-specific quote/settlement
 * contract yet. This function must remain OFF until that isolated binding exists.
 * No raw Paynow keys, guessed /v1/billing/checkout use, speculative URL, or
 * FMI FOUNDING/PRO subscriptions are valid substitutes.
 */
export function requireMmfSpecificPaymentBinding(env){
 if(!env||env.MMF_COMMERCE_ENABLED!=='true'||env.MMF_PAYMENT_PRODUCT_BOUND!=='true'||
   env.MMF_PAYMENT_AUTHORITY_WORKER!==SHARED_MUSITU_PAYNOW.authorityWorker||
   env.MMF_PAYMENT_TRANSPORT_WORKER!==SHARED_MUSITU_PAYNOW.transportWorker||
   env.MMF_MAIL_SENDING_ENABLED!=='false')deny();
 // Contract intentionally remains unavailable until independent product-binding
 // deployment, invoice legality and exact live signature verification.
 deny();
}
