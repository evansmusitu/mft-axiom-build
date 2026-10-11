import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMmfProductScopePreflight, MMF_PAYNOW_PRODUCT_CONTRACT} from '../src/commercial/mmf-product-scope-preflight.mjs';
// Minimal sanitized values from the verified 2026-10-11 GET-only audit; offline fixture,
// NOT a current live connection, approval or cryptographically authenticated statement.
const evidence={schema:'mmf-paynow-live-scope-audit-v1',inventoryOnly:true,cloudflareMethod:'GET',
 cloudflareMutations:false,merchantSecretsRead:false,customerFunds:false,customerEmail:false,
 transactionOrCustomerDataAccessed:false,eligibleForPaidActivation:false,
 realProviderPollCertified:false,liveMerchantCredentialsTransferred:false,
 existingWorkerMutationPermitted:false,customerPaymentInitiationPermitted:false,
 customerEmailSendingPermitted:false,confirmedRealMoneyEligible:false,
 missingCapabilities:['MMF_AUTHORITY_PRODUCT_ROUTES','MMF_AUTHORITY_PRODUCT_TOKEN',
  'MMF_TRANSPORT_PRODUCT_TOKEN','MMF_TRANSPORT_PRODUCT_ROUTE']};
const planned={
 schema:'mmf-paynow-product-integration-candidate-v1',
 product:'musitu-mail-fabric',
 authorityWorker:'mft-phase8-external-authority',
 transportWorker:'mft-paynow-transport-gateway',
 authorityRoutes:['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf'],
 transportRoute:'/internal/paynow/initiate-mmf',
 authorityTokenBinding:'MMF_AUTHORITY_BRIDGE_TOKEN',
 transportTokenBinding:'MMF_TRANSPORT_BRIDGE_TOKEN',
 credentialCustody:'EXISTING_MERCHANT_AUTHORITY_ONLY',
 interactionMode:'OFFLINE_PREPARATION_ONLY'
};
test('fresh sanitized read-only evidence binds explicit MMF-only merchant integration specification without activating money or mail',()=>{
 const result=evaluateMmfProductScopePreflight({proposal:planned,liveEvidence:evidence});
 assert.equal(result.contractSchema,'mmf-paynow-product-integration-candidate-v1');
 assert.equal(MMF_PAYNOW_PRODUCT_CONTRACT.authorityWorker,planned.authorityWorker);
 assert.deepEqual(result.missingCapabilities,[
  'MMF_AUTHORITY_PRODUCT_ROUTES','MMF_AUTHORITY_PRODUCT_TOKEN',
  'MMF_TRANSPORT_PRODUCT_TOKEN','MMF_TRANSPORT_PRODUCT_ROUTE']);
 assert.equal(result.productScopeLiveProven,false);
 assert.equal(result.mayMutateSharedWorkers,false);
 assert.equal(result.mayInitiateRealPayments,false);
 assert.equal(result.maySendCustomerEmail,false);
 assert.equal(result.commercialEligible,false);
 assert.equal(result.proposedProductRoutesValidated,true);
});
test('even all capabilities claimed present in untrusted inventory cannot promote MMF to production',()=>{
 const declared={...evidence,missingCapabilities:[],mmfPaymentAuthorityBound:true};
 const result=evaluateMmfProductScopePreflight({proposal:planned,liveEvidence:declared});
 assert.equal(result.missingCapabilities.length,0);
 assert.equal(result.productScopeLiveProven,false);
 assert.equal(result.mayInitiateRealPayments,false);
 assert.equal(result.commercialEligible,false);
});
test('fail closed on inherited product access, new merchant key custody, drifted routes and embedded secrets',()=>{
 const mutations=[
  {product:'musitu-fmi'}, {authorityWorker:'mft-fmi-billing'},
  {transportWorker:'musitu-mail-fabric-payment-private-stage-20261011'},
  {authorityRoutes:['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-fmi']},
  {transportRoute:'/internal/paynow/initiate-fmi'},
  {authorityTokenBinding:'FMI_AUTHORITY_BRIDGE_TOKEN'},
  {transportTokenBinding:'FMI_TRANSPORT_BRIDGE_TOKEN'},
  {credentialCustody:'MMF_WORKER'}, {interactionMode:'PROVIDER_POST'},
  {rawMerchantIntegrationKey:'secret-test'},
  {authorityRoutes:[planned.authorityRoutes[0],planned.authorityRoutes[0]]},
 ];
 for(const patch of mutations){
  assert.throws(()=>evaluateMmfProductScopePreflight({proposal:{...planned,...patch},liveEvidence:evidence}),/MMF_PRODUCT_SCOPE_PREPARATION_DENIED/,JSON.stringify(patch));
 }
});
test('fail closed on unsafe, forged or incomplete inventory metadata, and unexpected inputs',()=>{
 for(const patch of [
  {cloudflareMethod:'POST'}, {cloudflareMutations:true},{merchantSecretsRead:true},
  {customerFunds:true},{customerEmail:true},{eligibleForPaidActivation:true},
  {inventoryOnly:false},{missingCapabilities:['UNRECOGNIZED']},
  {missingCapabilities:['MMF_AUTHORITY_PRODUCT_ROUTES','MMF_AUTHORITY_PRODUCT_ROUTES']},
  {schema:'unspecified'},{transactionOrCustomerDataAccessed:true},
  {realProviderPollCertified:undefined},{customerPaymentInitiationPermitted:undefined}
 ])assert.throws(()=>evaluateMmfProductScopePreflight({proposal:planned,liveEvidence:{...evidence,...patch}}),/MMF_PRODUCT_SCOPE_PREPARATION_DENIED/,JSON.stringify(patch));
 for(const inputs of [null,{}, {proposal:planned}, {proposal:planned,liveEvidence:evidence,merchantToken:'unsafe'},
  {proposal:planned,liveEvidence:{...evidence,missingCapabilities:'all'}}])
  assert.throws(()=>evaluateMmfProductScopePreflight(inputs),/MMF_PRODUCT_SCOPE_PREPARATION_DENIED/);
});