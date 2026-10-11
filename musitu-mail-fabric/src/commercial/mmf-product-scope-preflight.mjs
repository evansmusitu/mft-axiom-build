/**
 * MMF-only Paynow product-extension specification validator.
 * Preparation is data-only: NO fetch, merchant secrets, production edits,
 * checkout, billing entitlement or mail capability. An unauthenticated
 * read-only inventory is never an authorization even if all bindings appear.
 */
const ERROR='MMF_PRODUCT_SCOPE_PREPARATION_DENIED';
const deny=()=>{throw Error(ERROR)};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const equalKeys=(o,keys)=>plain(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const REQUIRED=Object.freeze([
 'MMF_AUTHORITY_PRODUCT_ROUTES','MMF_AUTHORITY_PRODUCT_TOKEN',
 'MMF_TRANSPORT_PRODUCT_TOKEN','MMF_TRANSPORT_PRODUCT_ROUTE'
]);
export const MMF_PAYNOW_PRODUCT_CONTRACT=Object.freeze({
 schema:'mmf-paynow-product-integration-candidate-v1',
 product:'musitu-mail-fabric',
 authorityWorker:'mft-phase8-external-authority',
 transportWorker:'mft-paynow-transport-gateway',
 authorityRoutes:Object.freeze(['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf']),
 transportRoute:'/internal/paynow/initiate-mmf',
 authorityTokenBinding:'MMF_AUTHORITY_BRIDGE_TOKEN',
 transportTokenBinding:'MMF_TRANSPORT_BRIDGE_TOKEN',
 credentialCustody:'EXISTING_MERCHANT_AUTHORITY_ONLY',
 interactionMode:'OFFLINE_PREPARATION_ONLY'
});
const EVIDENCE_KEYS=new Set([
 'schema','inventoryOnly','verifiedExistingMerchantStack','changedSharedWorkers','mmfPaymentAuthorityBound',
 'missingCapabilities','eligibleForPaidActivation','realProviderPollCertified','liveMerchantCredentialsTransferred',
 'existingWorkerMutationPermitted','customerPaymentInitiationPermitted','customerEmailSendingPermitted',
 'requiresIndependentCodeAndProviderCertification','sourceReadbackStableAcrossReads',
 'multipartSourceNormalized','historicalRawHashBaselineComparable','sourceHashDriftIndependentlyProven',
 'baselineMismatchMayBeNondeterministicSource','sourceCodeSemanticallyStableButBaselineUncomparable',
 'observedWorkerCount','cloudflareCalls','cloudflareMethod','transactionOrCustomerDataAccessed',
 'merchantSecretsRead','cloudflareMutations','customerFunds','customerEmail',
 'checkedAtUtc','gate','confirmedRealMoneyEligible'
]);
const MUST_FALSE=['cloudflareMutations','merchantSecretsRead','customerFunds','customerEmail',
 'transactionOrCustomerDataAccessed','eligibleForPaidActivation'];
const DANGER_TRUE=['realProviderPollCertified','liveMerchantCredentialsTransferred',
 'existingWorkerMutationPermitted','customerPaymentInitiationPermitted','customerEmailSendingPermitted',
 'confirmedRealMoneyEligible'];
/** The result explicitly cannot serve as an activation token or merchant approval. */
export function evaluateMmfProductScopePreflight(input){
 if(!equalKeys(input,['proposal','liveEvidence']))deny();
 const {proposal,liveEvidence:e}=input;
 const contract=MMF_PAYNOW_PRODUCT_CONTRACT;
 if(!equalKeys(proposal,Object.keys(contract)))deny();
 for(const [key,expected] of Object.entries(contract)){
  const value=proposal[key];
  if(Array.isArray(expected)){
   if(!Array.isArray(value)||value.length!==expected.length||
    value.some((x,i)=>x!==expected[i]))deny();
  }else if(value!==expected)deny();
 }
 if(!plain(e)||Object.keys(e).some(x=>!EVIDENCE_KEYS.has(x))||
   e.schema!=='mmf-paynow-live-scope-audit-v1'||e.inventoryOnly!==true||
   e.cloudflareMethod!=='GET'||MUST_FALSE.some(k=>e[k]!==false)||
   DANGER_TRUE.some(k=>e[k]!==false))deny();
 const missing=e.missingCapabilities;
 if(!Array.isArray(missing)||missing.length>REQUIRED.length||
  missing.some(x=>!REQUIRED.includes(x))||new Set(missing).size!==missing.length)deny();
 return Object.freeze({contractSchema:contract.schema,product:contract.product,
  proposedProductRoutesValidated:true,
  missingCapabilities:Object.freeze(REQUIRED.filter(x=>missing.includes(x))),
  proofType:'UNTRUSTED_SANITIZED_READONLY_INVENTORY',
  productScopeLiveProven:false,mayMutateSharedWorkers:false,
  mayInitiateRealPayments:false,maySendCustomerEmail:false,
  commercialEligible:false,
  blockers:Object.freeze(['SEPARATE_SHARED_PRODUCTION_CHANGE_AUTHORIZATION',
   'MMF_SCOPED_PROVIDER_PERMISSION_AND_SECRET_CUSTODY','INDEPENDENT_PROVIDER_AND_CODE_QUALIFICATION',
   'LEGAL_SETTLEMENT_AND_TWO_PARTY_RELEASE_APPROVAL'])});
}