/**
 * Read-only, fail-closed assessment of a SANITIZED Cloudflare shared-payment inventory.
 * This never receives production source, secret values or customer data. Even a full
 * binding/route inventory cannot authorize real money: source semantics, signer
 * custody, integration approval, settlement and legal review require separate proof.
 */
const BASELINES=Object.freeze({
 'mft-phase8-external-authority':'d7a154e74eca75658d489c37b958a7bdffa07315a3ecaf9184988f6ca618aefb',
 'mft-paynow-transport-gateway':'e53ecc1b6bcb5e53162518c89a03e8e00b9627f29bf28aa27b6a78a9f74dc9f3',
 'mft-fmi-billing':'19d7654046f09b15e832517fa7ac1acbb8ce5ccb94b77b5c3f27da17629cf5c0'
});
const REC=/^[A-Z][A-Z0-9_]{2,80}$/;
const HASH=/^[a-f0-9]{64}$/;
const ROUTE=/^\/[a-zA-Z0-9_./-]{1,145}$/;
const isPlain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function deny(){throw Error('MMF_SHARED_PAYNOW_READONLY_INVENTORY_DENIED')}
function validatedWorker(value){
 if(!isPlain(value)||!HASH.test(value.sourceSha256)||
    !Array.isArray(value.bindingNames)||!Array.isArray(value.paths)||
    value.bindingNames.length>120||value.paths.length>200||
    value.bindingNames.some(x=>typeof x!=='string'||!REC.test(x))||
    value.paths.some(x=>typeof x!=='string'||!ROUTE.test(x))||
    new Set(value.bindingNames).size!==value.bindingNames.length||
    new Set(value.paths).size!==value.paths.length)deny();
 return value;
}
export function assessMmfLivePaynowScope(inventory){
 if(!isPlain(inventory)||Object.keys(inventory).sort().join('|')!==Object.keys(BASELINES).sort().join('|'))deny();
 const byName=Object.fromEntries(Object.keys(BASELINES).map(k=>[k,validatedWorker(inventory[k])]));
 const authority=byName['mft-phase8-external-authority'],transport=byName['mft-paynow-transport-gateway'];
 const billing=byName['mft-fmi-billing'];
 const changedSharedWorkers=Object.entries(BASELINES).filter(([k,sha])=>byName[k].sourceSha256!==sha).map(([k])=>k).sort();
 const verifiedExistingMerchantStack=changedSharedWorkers.length===0&&
   authority.bindingNames.includes('PAYNOW_INTEGRATION_KEY')&&
   authority.bindingNames.includes('FMI_AUTHORITY_BRIDGE_TOKEN')&&
   transport.bindingNames.includes('FMI_TRANSPORT_BRIDGE_TOKEN')&&
   billing.bindingNames.includes('PAYMENT_AUTHORITY')&&
   billing.bindingNames.includes('PAYNOW_TRANSPORT');
 const checks=[
  ['MMF_AUTHORITY_PRODUCT_ROUTES',['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf'].every(x=>authority.paths.includes(x))],
  ['MMF_AUTHORITY_PRODUCT_TOKEN',authority.bindingNames.includes('MMF_AUTHORITY_BRIDGE_TOKEN')],
  ['MMF_TRANSPORT_PRODUCT_TOKEN',transport.bindingNames.includes('MMF_TRANSPORT_BRIDGE_TOKEN')],
  ['MMF_TRANSPORT_PRODUCT_ROUTE',transport.paths.includes('/internal/paynow/initiate-mmf')]
 ];
 return Object.freeze({schema:'mmf-paynow-live-scope-audit-v1',inventoryOnly:true,
  verifiedExistingMerchantStack,changedSharedWorkers:Object.freeze(changedSharedWorkers),
  mmfPaymentAuthorityBound:checks.every(([,pass])=>pass),
  missingCapabilities:Object.freeze(checks.filter(([,pass])=>!pass).map(([k])=>k)),
  eligibleForPaidActivation:false,realProviderPollCertified:false,
  liveMerchantCredentialsTransferred:false,existingWorkerMutationPermitted:false,
  customerPaymentInitiationPermitted:false,customerEmailSendingPermitted:false,
  requiresIndependentCodeAndProviderCertification:true});
}
