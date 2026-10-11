import test from 'node:test';
import assert from 'node:assert/strict';
import {PHASE1_GATES,assessPhase1CommercialReadiness} from '../src/commercial/readiness.mjs';

const attestation=(name)=>({status:'verified',reference:`independent-reviewed-record:${name}:20261011`});
function allVerified(){return Object.fromEntries(PHASE1_GATES.map(g=>[g.id,attestation(g.id)]));}

test('absent or empty proof cannot silently authorize even one commercial track',()=>{
 const result=assessPhase1CommercialReadiness({});
 assert.equal(result.schema,'mmf-phase1-commercial-gate-v1');
 assert.equal(result.paidPreparation.status,'BLOCKED');
 assert.equal(result.liveDelivery.status,'BLOCKED');
 assert.equal(result.productionActivationAuthorized,false);
 assert.ok(result.paidPreparation.missing.length>0);
 assert.ok(result.liveDelivery.missing.length>0);
 assert.equal(Object.hasOwn(result,'approvedSender'),false);
});

test('genuine provider standalone proof is insufficient to claim actual MMF outbox round trip',()=>{
 const result=assessPhase1CommercialReadiness({standaloneResendEvent:attestation('real-resend-event')});
 assert.equal(result.evidence.standaloneResendEvent,'verified');
 assert.equal(result.liveDelivery.status,'BLOCKED');
 assert.ok(result.liveDelivery.missing.includes('liveMmfOutboxReconciliation'));
 assert.equal(result.productionActivationAuthorized,false);
});

test('commercial setup and live delivery are different gates',()=>{
 const enough={businessLegalPosition:attestation('legal'),taxInvoicePolicy:attestation('tax'),
  approvedCustomerScope:attestation('scope'), verifiedPaymentCollection:attestation('payments')};
 const result=assessPhase1CommercialReadiness(enough);
 assert.equal(result.paidPreparation.status,'HUMAN_CONTRACT_REVIEW_REQUIRED');
 assert.equal(result.liveDelivery.status,'BLOCKED');
 assert.equal(result.productionActivationAuthorized,false);
});

test('even all manually verified references never switch on live mail automatically',()=>{
 const result=assessPhase1CommercialReadiness(allVerified());
 assert.equal(result.paidPreparation.status,'HUMAN_CONTRACT_REVIEW_REQUIRED');
 assert.equal(result.liveDelivery.status,'HUMAN_RELEASE_REVIEW_REQUIRED');
 assert.equal(result.productionActivationAuthorized,false);
});

test('fail closed on missing references, unknown keys, prototypes and malformed evidence',()=>{
 assert.throws(()=>assessPhase1CommercialReadiness({garbage:attestation('garbage')}),/UNRECOGNIZED/);
 assert.throws(()=>assessPhase1CommercialReadiness({standaloneResendEvent:{status:'verified'}}),/INVALID/);
 assert.throws(()=>assessPhase1CommercialReadiness({standaloneResendEvent:{status:'verified',reference:'http://user:pass@host.invalid/'}}),/INVALID/);
 assert.throws(()=>assessPhase1CommercialReadiness({standaloneResendEvent:{status:'verified',reference:'secret-whsec_abcdefghijklmnopqrstuvwxyz'}}),/INVALID/);
 assert.throws(()=>assessPhase1CommercialReadiness({standaloneResendEvent:{status:'verified',reference:'fine-record:001',rogue:true}}),/INVALID/);
 assert.throws(()=>assessPhase1CommercialReadiness(JSON.parse('{"__proto__":{"status":"verified","reference":"xxx-0000000000"}}')),/UNRECOGNIZED/);
});

test('unknown claimed verification states cannot be treated as verified',()=>{
 for(const x of ['true','passed','certified','done',true,1,null]){
  const evidence={standaloneResendEvent:{status:x,reference:'independent-evidence:reference:ok'}};
  assert.throws(()=>assessPhase1CommercialReadiness(evidence),/INVALID/);
 }
});

test('readiness report does not echo potentially sensitive input references',()=>{
 const report=assessPhase1CommercialReadiness({businessLegalPosition:{status:'verified',reference:'private-case-record:12345678901234567890'}});
 assert.ok(!JSON.stringify(report).includes('private-case-record'));
 assert.equal(report.productionActivationAuthorized,false);
});

test('CLI with actual evidence snapshot exits blocked but emits no secrets', async()=>{
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,['src/commercial/check-cli.mjs','docs/2026-10-11-phase1-evidence-snapshot.json'],{cwd:new URL('..',import.meta.url).pathname,encoding:'utf8'});
 assert.equal(result.status,2,result.stderr);
 const report=JSON.parse(result.stdout);
 assert.equal(report.evidence.standaloneResendEvent,'verified');
 assert.equal(report.liveDelivery.status,'BLOCKED');
 assert.equal(report.productionActivationAuthorized,false);
 assert.equal(Object.hasOwn(report,'claim'),false);
});
