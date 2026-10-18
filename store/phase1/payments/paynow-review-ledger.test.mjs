import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,chmodSync,symlinkSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordPaynowReviewEvent} from './paynow-review-ledger.mjs';

const integrationKey='isolated-payment-ledger-key-NOT-a-real-Paynow-merchant-key';
const pollurl='https://www.paynow.co.zw/Interface/CheckPayment/?guid=ad1a986c-3434-44a4-8f5b-111111111111';
const order={reference:'ORDER-LEDGER-004',amount:'12.34',pollurl};
function signed(fields={}){
  const values={reference:order.reference,paynowreference:'PAYNOW-FIXTURE-1',amount:order.amount,
    status:'Paid',pollurl,...fields};
  const items=Object.entries(values);
  const hash=createHash('sha512').update(items.map(([,v])=>String(v)).join('')+integrationKey).digest('hex').toUpperCase();
  return items.map(([k,v])=>k+'='+encodeURIComponent(String(v))).join('&')+'&hash='+hash;
}
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'store-paynow-review-ledger-'));
  const ledgerDirectory=join(root,'ledger');mkdirSync(ledgerDirectory,{mode:0o700});
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,ledgerDirectory};
}
function record(d,overrides={}){
  return recordPaynowReviewEvent({ledgerDirectory:d.ledgerDirectory,callbackBody:signed(),
    polledBody:signed(),integrationKey,order,...overrides});
}
function paths(d){
  const name=createHash('sha256').update('musitu.store.paynow.review.v1\0'+order.reference).digest('hex');
  return {ledger:join(d.ledgerDirectory,name+'.json'),
    lock:join(d.ledgerDirectory,name+'.lock'),pending:join(d.ledgerDirectory,name+'.pending')};
}
test('two independently supplied signed views persist review-only evidence, never entitlement or payout',t=>{
  const d=fixture(t),r=record(d);assert.equal(r.state,'REVIEW_RECORDED_PRIVATE_ONLY');
  assert.equal(r.reused,false);assert.equal(r.entitlementGranted,false);
  assert.equal(r.publisherSettlementAuthorized,false);assert.equal(r.refundFinalized,false);
  const p=paths(d),s=JSON.parse(readFileSync(p.ledger,'utf8'));
  assert.equal(s.merchantReference,order.reference);assert.equal(s.providerReference,'PAYNOW-FIXTURE-1');
  assert.equal(s.events.length,1);assert.equal(s.events[0].providerStatus,'Paid');
  assert.equal(statSync(p.ledger).mode&0o777,0o600);
  assert.equal(existsSync(p.lock),false);assert.equal(existsSync(p.pending),false);
});
test('same event replay is idempotent and does not rewrite ledger',t=>{
  const d=fixture(t);record(d);const p=paths(d),old=readFileSync(p.ledger,'utf8');
  const repeat=record(d);assert.equal(repeat.reused,true);
  assert.equal(readFileSync(p.ledger,'utf8'),old);
});
test('conflicting provider transaction identity cannot replace an earlier signed order',t=>{
  const d=fixture(t);record(d);const old=readFileSync(paths(d).ledger,'utf8');
  assert.throws(()=>record(d,{callbackBody:signed({paynowreference:'PAYNOW-FIXTURE-2'}),
    polledBody:signed({paynowreference:'PAYNOW-FIXTURE-2'})}),/provider|identity|conflict/i);
  assert.equal(readFileSync(paths(d).ledger,'utf8'),old);
});
test('provider reports refunded after Paid: lock review and never restore entitlement on later Paid',t=>{
  const d=fixture(t);record(d);
  const refund=record(d,{polledBody:signed({status:'Refunded'})});
  assert.equal(refund.manualReviewLocked,true);assert.equal(refund.entitlementGranted,false);
  const r=record(d,{polledBody:signed({status:'Paid'})});
  assert.equal(r.manualReviewLocked,true);
  assert.equal(JSON.parse(readFileSync(paths(d).ledger,'utf8')).events.length,3);
});
test('invalid signature or missing independent poll never opens or changes durable ledger',t=>{
  const d=fixture(t);
  assert.throws(()=>record(d,{polledBody:undefined}),/poll|required|independent/i);
  assert.throws(()=>record(d,{callbackBody:signed().replace('Paid','Refunded')}),/hash|signature/i);
  assert.deepEqual(readdirSync(d.ledgerDirectory),[]);
});
test('abandoned transaction lock fails closed without deleting evidence',t=>{
  const d=fixture(t),p=paths(d);writeFileSync(p.lock,'abandoned',{mode:0o600});
  assert.throws(()=>record(d),/lock|concurrent|review/i);
  assert.equal(readFileSync(p.lock,'utf8'),'abandoned');assert.equal(existsSync(p.ledger),false);
});
test('incomplete prior pending write fails closed, not silently recovered',t=>{
  const d=fixture(t),p=paths(d);writeFileSync(p.pending,'interrupted',{mode:0o600});
  assert.throws(()=>record(d),/pending|recovery|review/i);
  assert.equal(readFileSync(p.pending,'utf8'),'interrupted');assert.equal(existsSync(p.ledger),false);
});
test('corrupted or symlinked existing ledger cannot be reset by a new signed callback',t=>{
  const d=fixture(t),p=paths(d),victim=join(d.root,'victim.txt');
  writeFileSync(p.ledger,'{',{mode:0o600});
  assert.throws(()=>record(d),/corrupt|canonical|ledger|review/i);
  rmSync(p.ledger);writeFileSync(victim,'protected',{mode:0o600});symlinkSync(victim,p.ledger);
  assert.throws(()=>record(d),/symlink|ledger|unsafe/i);
  assert.equal(readFileSync(victim,'utf8'),'protected');
});
test('directory must be private, owner-controlled and not a symlink',t=>{
  const d=fixture(t);chmodSync(d.ledgerDirectory,0o755);
  assert.throws(()=>record(d),/private|permission|directory/i);
  chmodSync(d.ledgerDirectory,0o700);
  const alias=join(d.root,'alias');symlinkSync(d.ledgerDirectory,alias);
  assert.throws(()=>record(d,{ledgerDirectory:alias}),/private|directory|symlink/i);
});
test('stored evidence never includes integration key, raw callback, phone, or secrets',t=>{
  const d=fixture(t);record(d);const text=readFileSync(paths(d).ledger,'utf8');
  assert.equal(text.includes(integrationKey),false);assert.equal(text.includes('pollurl'),false);
  assert.equal(text.includes('www.paynow.co.zw'),false);
  const saved=JSON.parse(text);assert.equal(saved.entitlementGranted,false);
  assert.equal(saved.publisherSettlementAuthorized,false);
});
