/** Manual-evidence inventory for MUSITU Mail Fabric Phase-1.
 * Read-only; no sending, charging, customer onboarding, public deployment or
 * release signatures. Operator-entered references are NOT independently
 * verified by this module, and complete references can NEVER activate mail.
 */
const GATES=[
 ['businessLegalPosition',['preparation','delivery'],'Applicable business/sole-trader permission reviewed'],
 ['taxInvoicePolicy',['preparation','delivery'],'Tax treatment and invoice issuer reviewed'],
 ['approvedCustomerScope',['preparation','delivery'],'Specific paid scope and contract authority approved'],
 ['verifiedPaymentCollection',['preparation','delivery'],'An owned, operational payment/settlement rail verified'],
 ['providerResaleRights',['delivery'],'Resend service/provider resale and acceptable-use rights established'],
 ['privacyCrossBorderCounsel',['delivery'],'Zimbabwe and applicable cross-border data duties independently reviewed'],
 ['independentSecurityAssessment',['delivery'],'Independent assessment of the actual proposed deployment approved'],
 ['backupRestoreAndKeyCustody',['delivery'],'Production managed key custody and offsite backup restore exercised'],
 ['senderDomainOwnership',['delivery'],'Exact customer sender DNS ownership authenticated and verified'],
 ['liveMmfOutboxReconciliation',['delivery'],'Real provider message reconciled in a dedicated durable MMF outbox'],
 ['signedBounceSuppression',['delivery'],'Genuine provider feedback and suppression qualified without forged events'],
 ['productionWebhookAndReplay',['delivery'],'Registered production webhook and duplicate replay controls proven'],
 ['consentCustomerDataAuthority',['delivery'],'Recipient permissions, retention and data processor terms accepted'],
 ['twoOperatorRelease',['delivery'],'Valid distinct signers and bounded tenant-specific live-release authorization'],
 ['onCallSupport',['delivery'],'Monitoring, incident response, provider-failure runbook and staffed contact'],
 ['customerAcceptance',['delivery'],'Controlled pilot customer acceptance and operational limits approved'],
 ['standaloneResendEvent',['delivery'],'Real Resend signed notification at standalone isolated receiver observed']
];
export const PHASE1_GATES=Object.freeze(GATES.map(([id,tracks,description])=>Object.freeze({id,tracks:Object.freeze(tracks),description})));
const KEYS=new Set(PHASE1_GATES.map(g=>g.id));
const isPlain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const validRef=r=>typeof r==='string'&&r.length>=15&&r.length<=240&&
 /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/.test(r)&&!r.includes('//')&&!/(?:whsec_|sk[_-]|secret|token|bearer|password|privatekey)/i.test(r);
export function assessPhase1CommercialReadiness(proof={}){
 if(!isPlain(proof)||Object.keys(proof).length>PHASE1_GATES.length)
   throw Error('INVALID_PHASE1_EVIDENCE');
 const states=Object.create(null);
 for(const [id,item] of Object.entries(proof)){
  if(!KEYS.has(id))throw Error('UNRECOGNIZED_PHASE1_GATE');
  if(!isPlain(item)||Object.keys(item).length!==2||
     !Object.hasOwn(item,'status')||!Object.hasOwn(item,'reference')||
     !['verified','not_verified'].includes(item.status)||
     !validRef(item.reference))throw Error('INVALID_PHASE1_EVIDENCE');
  states[id]=item.status;
 }
 const check=track=>{
  const missing=PHASE1_GATES.filter(g=>g.tracks.includes(track)&&states[g.id]!=='verified').map(g=>g.id);
  return Object.freeze({status:missing.length?'BLOCKED':track==='preparation'?'HUMAN_CONTRACT_REVIEW_REQUIRED':'HUMAN_RELEASE_REVIEW_REQUIRED',missing});
 };
 const evidence=Object.fromEntries(PHASE1_GATES.map(g=>[g.id,states[g.id]||'not_verified']));
 return Object.freeze({schema:'mmf-phase1-commercial-gate-v1',
  paidPreparation:check('preparation'),liveDelivery:check('delivery'),
  evidence,productionActivationAuthorized:false,
  warning:'Manual references are not validated facts or a release authorization. This read-only report cannot send, invoice, certify, charge or deploy.'});
}
