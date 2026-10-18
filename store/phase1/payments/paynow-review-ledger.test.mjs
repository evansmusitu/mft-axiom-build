import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,chmodSync,symlinkSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordPaynowReviewEvent,auditPaynowReviewDirectory} from './paynow-review-ledger.mjs';

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
  // Distinct provider message after refund, not a replay of the original event.
  const r=record(d,{callbackBody:signed({status:'Refunded'}),polledBody:signed({status:'Paid'})});
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

test('dangling symlink masquerading as absent prior ledger cannot reset order history',t=>{
  const d=fixture(t),p=paths(d),missing=join(d.root,'never-created-target');
  symlinkSync(missing,p.ledger);
  assert.throws(()=>record(d),/symlink|unsafe|ledger/i);
  assert.equal(existsSync(missing),false);
});


function signedOtherOrder(otherOrder, fields={}){
  const fieldsToSign={reference:otherOrder.reference,paynowreference:'PAYNOW-FIXTURE-1',
    amount:otherOrder.amount,status:'Paid',pollurl:otherOrder.pollurl,...fields};
  const items=Object.entries(fieldsToSign);
  const hash=createHash('sha512').update(items.map(([,v])=>String(v)).join('')+integrationKey).digest('hex').toUpperCase();
  return items.map(([k,v])=>k+'='+encodeURIComponent(String(v))).join('&')+'&hash='+hash;
}
test('one provider transaction cannot be claimed by a second separately signed merchant order',t=>{
  const d=fixture(t);
  record(d);
  const second={...order,reference:'ORDER-LEDGER-005'};
  const before=readFileSync(paths(d).ledger,'utf8');
  assert.throws(()=>record(d,{order:second,
    callbackBody:signedOtherOrder(second),
    polledBody:signedOtherOrder(second)}),/provider|transaction|claimed|other order/i);
  assert.equal(readFileSync(paths(d).ledger,'utf8'),before);
  const secondName=createHash('sha256').update('musitu.store.paynow.review.v1\\0'+second.reference).digest('hex');
  assert.equal(existsSync(join(d.ledgerDirectory,secondName+'.json')),false);
});
test('deleted order history cannot be silently restarted while provider claim remains',t=>{
  const d=fixture(t);record(d);
  rmSync(paths(d).ledger);
  assert.throws(()=>record(d),/provider|claim|history|recovery|review/i);
  assert.equal(existsSync(paths(d).ledger),false);
});
test('provider transaction claim is private, immutable under normal replay, and corrupt state blocks reviews',t=>{
  const d=fixture(t);record(d);
  const providerKey=createHash('sha256').update('musitu.store.paynow.provider-claim.v1'+String.fromCharCode(0)+'PAYNOW-FIXTURE-1').digest('hex');
  const claim=join(d.ledgerDirectory,'provider-'+providerKey+'.json');
  assert.equal(existsSync(claim),true,'provider reference must be claimed globally before review');
  assert.equal(statSync(claim).mode&0o777,0o600);
  const original=readFileSync(claim,'utf8');
  const replay=record(d);
  assert.equal(replay.reused,true);
  assert.equal(readFileSync(claim,'utf8'),original);
  writeFileSync(claim,'{',{mode:0o600});
  assert.throws(()=>record(d),/provider|claim|corrupt|review/i);
  assert.equal(readFileSync(claim,'utf8'),'{');
});


test('historical refund review lock cannot be cleared by replacing canonical JSON state',t=>{
  const d=fixture(t);
  record(d);
  record(d,{polledBody:signed({status:'Refunded'})});
  const file=paths(d).ledger;
  const data=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(data.manualReviewLocked,true);
  data.manualReviewLocked=false;
  writeFileSync(file,JSON.stringify(data)+'\n',{mode:0o600});
  const corrupted=readFileSync(file,'utf8');
  assert.throws(()=>record(d,{
    callbackBody:signed({status:'Refunded'}),
    polledBody:signed({status:'Paid'})
  }),/lock|histor|inconsistent|invalid|ledger|corrupt/i);
  assert.equal(readFileSync(file,'utf8'),corrupted,
    'corrupt prior review state may never be promoted');
});
test('historical refunded provider status cannot falsely claim confirmed Paid outcome',t=>{
  const d=fixture(t);
  record(d);
  record(d,{polledBody:signed({status:'Refunded'})});
  const file=paths(d).ledger;
  const data=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(data.events[1].outcome,'PAYMENT_HOLD_REVIEW_REQUIRED');
  data.events[1].outcome='PAYMENT_CONFIRMED_REVIEW_REQUIRED';
  writeFileSync(file,JSON.stringify(data)+'\n',{mode:0o600});
  const corrupted=readFileSync(file,'utf8');
  assert.throws(()=>record(d,{
    callbackBody:signed({status:'Refunded'}),
    polledBody:signed({status:'Paid'})
  }),/histor|refund|event|outcome|invalid|ledger|corrupt/i);
  assert.equal(readFileSync(file,'utf8'),corrupted);
});


test('read-only operator audit detects exactly one internally consistent reserved payment review',t=>{
  const d=fixture(t);
  const empty=auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory});
  assert.equal(empty.state,'OFFLINE_REVIEW_AUDIT_ONLY');
  assert.equal(empty.orders,0);
  record(d);
  const before=readdirSync(d.ledgerDirectory).map(name=>[name,readFileSync(join(d.ledgerDirectory,name),'utf8')]);
  const result=auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory});
  assert.equal(result.state,'OFFLINE_REVIEW_AUDIT_ONLY');
  assert.equal(result.orders,1);
  assert.equal(result.providerClaims,1);
  assert.equal(result.manualReviewLocked,0);
  assert.equal(result.entitlementGranted,false);
  assert.equal(result.publisherSettlementAuthorized,false);
  assert.deepEqual(readdirSync(d.ledgerDirectory).map(name=>[name,readFileSync(join(d.ledgerDirectory,name),'utf8')]),before);
});
test('audit counts refunded/held reviews without granting settlement',t=>{
  const d=fixture(t);record(d);
  record(d,{polledBody:signed({status:'Refunded'})});
  const result=auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory});
  assert.equal(result.orders,1);
  assert.equal(result.manualReviewLocked,1);
  assert.equal(result.entitlementGranted,false);
});
test('operator audit fails closed if an order journal lost its immutable provider claim',t=>{
  const d=fixture(t);record(d);
  const claim=readdirSync(d.ledgerDirectory).find(n=>n.startsWith('provider-'));
  assert.ok(claim);
  rmSync(join(d.ledgerDirectory,claim));
  assert.throws(()=>auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory}),/provider|claim|unmatched|orphan|audit/i);
  assert.equal(existsSync(paths(d).ledger),true);
});
test('operator audit fails closed if a provider claim lost its order history',t=>{
  const d=fixture(t);record(d);rmSync(paths(d).ledger);
  assert.throws(()=>auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory}),/provider|claim|orphan|history|audit/i);
});
test('read-only audit rejects fabricated second order journal using same transaction claim',t=>{
  const d=fixture(t);record(d);
  const other='ORDER-LEDGER-005';
  const original=JSON.parse(readFileSync(paths(d).ledger,'utf8'));
  original.merchantReference=other;
  const newName=createHash('sha256').update('musitu.store.paynow.review.v1'+String.fromCharCode(0)+other).digest('hex')+'.json';
  writeFileSync(join(d.ledgerDirectory,newName),JSON.stringify(original)+'\n',{mode:0o600});
  assert.throws(()=>auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory}),/provider|claim|duplicate|audit/i);
});
test('audit rejects dangling symlinks, unfinished locks and unknown ledger files',t=>{
  const d=fixture(t);record(d);
  const spoof=join(d.ledgerDirectory,'provider-untrusted.json');
  symlinkSync(join(d.root,'absent'),spoof);
  assert.throws(()=>auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory}),/unsafe|unknown|symlink|claim|audit/i);
  rmSync(spoof);
  writeFileSync(paths(d).lock,'abandoned',{mode:0o600});
  assert.throws(()=>auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory}),/lock|unfinished|pending|audit/i);
  rmSync(paths(d).lock);
  writeFileSync(join(d.ledgerDirectory,'unknown.json'),'{}',{mode:0o600});
  assert.throws(()=>auditPaynowReviewDirectory({ledgerDirectory:d.ledgerDirectory}),/unknown|unsafe|audit/i);
});
