import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMmfLivePaynowScope} from '../src/commercial/mmf-live-paynow-scope-audit.mjs';
const healthy={
 'mft-phase8-external-authority':{sourceSha256:'d7a154e74eca75658d489c37b958a7bdffa07315a3ecaf9184988f6ca618aefb',
  bindingNames:['FMI_AUTHORITY_BRIDGE_TOKEN','CHEMISTRY_AUTHORITY_BRIDGE_TOKEN','PAYNOW_INTEGRATION_KEY'],
  paths:['/internal/paynow/sign-initiate-fmi','/internal/paynow/verify-callback-fmi','/internal/paynow/sign-initiate-chemistry']},
 'mft-paynow-transport-gateway':{sourceSha256:'e53ecc1b6bcb5e53162518c89a03e8e00b9627f29bf28aa27b6a78a9f74dc9f3',
  bindingNames:['FMI_TRANSPORT_BRIDGE_TOKEN','CHEMISTRY_TRANSPORT_BRIDGE_TOKEN'],paths:['/internal/paynow/initiate','/internal/paynow/poll']},
 'mft-fmi-billing':{sourceSha256:'19d7654046f09b15e832517fa7ac1acbb8ce5ccb94b77b5c3f27da17629cf5c0',
  bindingNames:['PAYMENT_AUTHORITY','PAYNOW_TRANSPORT'],paths:['/fmi/checkout']}
};
const current=()=>structuredClone(healthy);
test('live observed FMI and Chemistry Paynow infrastructure is reused by plan, but MMF merchant scope fails closed',()=>{
 const r=assessMmfLivePaynowScope(current());
 assert.equal(r.verifiedExistingMerchantStack,true);
 assert.equal(r.mmfPaymentAuthorityBound,false);
 assert.equal(r.eligibleForPaidActivation,false);
 assert.equal(r.realProviderPollCertified,false);
 assert.deepEqual(r.missingCapabilities.toSorted(),[
  'MMF_AUTHORITY_PRODUCT_ROUTES','MMF_AUTHORITY_PRODUCT_TOKEN',
  'MMF_TRANSPORT_PRODUCT_TOKEN','MMF_TRANSPORT_PRODUCT_ROUTE'
 ].sort());
 assert.deepEqual(r.changedSharedWorkers,[]);
 assert.equal(JSON.stringify(r).includes('PAYNOW_INTEGRATION_KEY'),false);
});
test('unexpected shared production source hash requires new review; never claim verified baseline',()=>{
 const x=current();x['mft-phase8-external-authority'].sourceSha256='a'.repeat(64);
 const r=assessMmfLivePaynowScope(x);
 assert.equal(r.verifiedExistingMerchantStack,false);
 assert.equal(r.eligibleForPaidActivation,false);
 assert.deepEqual(r.changedSharedWorkers,['mft-phase8-external-authority']);
});
test('route names without dedicated product tokens, or tokens without routes, never establish MMF scope',()=>{
 const x=current();x['mft-phase8-external-authority'].paths.push('/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf');
 x['mft-paynow-transport-gateway'].paths.push('/internal/paynow/initiate-mmf');
 assert.equal(assessMmfLivePaynowScope(x).mmfPaymentAuthorityBound,false);
 x['mft-phase8-external-authority'].bindingNames.push('MMF_AUTHORITY_BRIDGE_TOKEN');
 x['mft-paynow-transport-gateway'].bindingNames.push('MMF_TRANSPORT_BRIDGE_TOKEN');
 const r=assessMmfLivePaynowScope(x);
 assert.equal(r.mmfPaymentAuthorityBound,true);
 assert.equal(r.eligibleForPaidActivation,false); // routes and bindings alone are NEVER settlement proof
 assert.equal(r.realProviderPollCertified,false);
});
test('missing, duplicate or ill-formed live inventory fails closed without leaking input',()=>{
 for(const x of [null,{},[],{'mft-phase8-external-authority':{sourceSha256:'bad',bindingNames:['SECRET123'],paths:['evil']}},
  {...current(),'mft-paynow-transport-gateway':{...current()['mft-paynow-transport-gateway'],bindingNames:['FMI_TRANSPORT_BRIDGE_TOKEN','FMI_TRANSPORT_BRIDGE_TOKEN']}}]){
  assert.throws(()=>assessMmfLivePaynowScope(x),/MMF_SHARED_PAYNOW_READONLY_INVENTORY_DENIED/);
 }
});
