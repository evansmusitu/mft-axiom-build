/**
 * Read-only live contract assessment for EXISTING MUSITU Paynow backend.
 * A successful result asserts NO right to initiate/check a payment and is NOT
 * evidence that a MUSITU Mail Fabric specific billing route exists.
 * The read-only workflow owns the observation, not the merchant secret.
 */
const ERR='MMF_PAYNOW_READBACK_DENIED';
const names=['mft-phase8-external-authority','mft-paynow-transport-gateway','mft-fmi-billing'];
const record=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const has=(worker,name)=>worker.binding_names_and_types.some(x=>x.binding_name===name&&x.type==='service');
function deny(){throw new Error(ERR)}
export function assessMmfSharedPaynowReadback(audit,{nowMs=Date.now()}={}){
 if(!record(audit)||audit.schema!=='mmf-existing-paynow-readonly-interface-v1'||
  audit.account_verified!==true||audit.inventory_only!==true||
  audit.source_exposed!==false||audit.cloudflare_mutations!==false||
  audit.raw_merchant_secrets_exposed!==false||audit.customer_database_read!==false||
  audit.provider_transaction_called!==false||
  !Number.isSafeInteger(audit.auditWorkflowRun)||audit.auditWorkflowRun<1||
  !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.\d{3}Z$/.test(audit.observedAtUtc)||
  !Number.isFinite(nowMs)||!Array.isArray(audit.workers)||audit.workers.length!==3)deny();
 const observedMs=Date.parse(audit.observedAtUtc);
 if(!Number.isFinite(observedMs)||nowMs<observedMs-300000||nowMs-observedMs>86400000)deny();
 const actual=audit.workers.map(x=>x?.name);
 if(new Set(actual).size!==3||names.some(n=>!actual.includes(n)))deny();
 const m=Object.fromEntries(audit.workers.map(x=>[x.name,x]));
 for(const name of names){const w=m[name];
  if(!record(w)||!(/^[a-f0-9]{64}$/.test(w.source_sha256))||
     !Number.isSafeInteger(w.source_bytes)||w.source_bytes<1000||w.source_bytes>2000000||
     !Array.isArray(w.route_candidates)||!w.route_candidates.every(x=>typeof x==='string'&&x.startsWith('/')&&x.length<=125)||
     !Array.isArray(w.binding_names_and_types)||!w.binding_names_and_types.every(x=>
        record(x)&&typeof x.binding_name==='string'&&typeof x.type==='string'&&
        (x.service===null||typeof x.service==='string')))deny();
 }
 const a=m[names[0]],t=m[names[1]],f=m[names[2]];
 if(!a.route_candidates.includes('/internal/paynow/sign-initiate-fmi')||
    !a.route_candidates.includes('/internal/paynow/verify-callback-fmi')||
    !t.route_candidates.includes('/internal/paynow/initiate')||
    !t.route_candidates.includes('/internal/paynow/poll')||
    !f.route_candidates.includes('/billing/checkout')||
    !f.route_candidates.includes('/billing/poll')||
    !has(f,'PAYMENT_AUTHORITY')||!has(f,'PAYNOW_TRANSPORT')||
    !f.binding_names_and_types.some(x=>x.binding_name==='PAYMENT_AUTHORITY'&&x.service===names[0])||
    !f.binding_names_and_types.some(x=>x.binding_name==='PAYNOW_TRANSPORT'&&x.service===names[1]))deny();
 const mmfAuthority=a.route_candidates.includes('/internal/paynow/sign-initiate-mmf')&&
  a.route_candidates.includes('/internal/paynow/verify-callback-mmf');
 const mmfTransport=t.binding_names_and_types.some(x=>x.binding_name==='MMF_TRANSPORT_BRIDGE_TOKEN');
 // Read-only inventory observes FMI billing only, not a separate MMF billing worker.
 // This function intentionally never returns "ready" from an inventory report.
 const missing=[
  ...(!mmfAuthority?['MMF_SCOPED_AUTHORITY']:[]),
  ...(!mmfTransport?['MMF_SCOPED_TRANSPORT']:[]),
  'MMF_SCOPED_BILLING_WORKER',
  'INDEPENDENT_SETTLEMENT_VERIFICATION',
  'LEGAL_INVOICE_AND_PRODUCTION_RELEASE_APPROVAL'
 ];
 return Object.freeze({schema:'mmf-paynow-binding-readiness-v1',
  sharedMerchantStack:'READ_ONLY_VERIFIED',
  fmiPaymentIsolationPreserved:true,
  mmfBillingStatus:'BLOCKED_MMF_BINDING_ABSENT',
  missing:Object.freeze(missing),
  mayInitiateCheckout:false,mayAcceptRealMoney:false,maySendCustomerMail:false,
  observedAtUtc:audit.observedAtUtc,auditWorkflowRun:audit.auditWorkflowRun,
  note:'Presence of an existing MUSITU Paynow merchant is not permission to treat FMI or Chemistry checkout as MMF billing.'});
}
