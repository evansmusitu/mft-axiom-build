import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 parseVerifiedMmfPaynowStatus,
 buildMmfPaynowInitiateRequest,
 validateMmfPaynowPollUrl,
 authorizeMmfPaynowStatusForOrder
} from '../src/commercial/paynow-native-protocol.mjs';
import {draftMmfFmiPaynowQuote} from '../src/commercial/fmi-paynow-reuse.mjs';
const key='FAKE_OFFLINE_TEST_INTEGRATION_KEY_NEVER_DEPLOY';
const quote=draftMmfFmiPaynowQuote({tenantId:'mail_tenant_a',customerReference:'customer:approved:01',contractReference:'contract:approved:02',orderReference:'MMF-PAYNOWTEST01'});
const poll='https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b';
function form(data,secret=key){
 const entries=Object.entries(data);
 const hash=createHash('sha512').update(entries.map(([,v])=>String(v)).join('')+secret).digest('hex').toUpperCase();
 return new URLSearchParams([...entries,['hash',hash]]).toString();
}
function event(status='Paid',extra={}){
 return form({reference:quote.orderReference,paynowreference:'567890',amount:'99.00',status,pollurl:poll,...extra});
}
test('Paynow native: authenticated paid status is evidence only, no mail or FMI entitlement',()=>{
 const r=parseVerifiedMmfPaynowStatus(event(),{integrationKey:key});
 assert.equal(r.providerVerified,true);assert.equal(r.kind,'PAID_OBSERVED');
 assert.equal(r.currency,'USD');assert.equal(r.amountCents,9900);
 assert.equal(r.reference,quote.orderReference);assert.equal(r.providerReference,'567890');
 assert.equal(r.grantsMailSending,false);assert.equal(r.canGrantFmiEntitlement,false);
 const matched=authorizeMmfPaynowStatusForOrder(r,quote,{tenantId:quote.tenantId});
 assert.equal(matched.kind,'PAID_OBSERVED');assert.equal(matched.canActivateMailService,false);
});
test('Paynow native: status classes distinguish paid, provisional, pending, disputed, reversed',()=>{
 const cases={Paid:'PAID_OBSERVED','Awaiting Delivery':'PROVISIONAL',Delivered:'PROVISIONAL',Created:'PENDING',Sent:'PENDING',Cancelled:'CANCELLED',Disputed:'DISPUTED',Refunded:'REFUNDED'};
 for(const [status,kind] of Object.entries(cases)){
  const r=parseVerifiedMmfPaynowStatus(event(status),{integrationKey:key});
  assert.equal(r.kind,kind,status);assert.equal(r.canIssueTaxInvoice,false);
 }
});
test('Paynow native: callback signatures fail without actual merchant key, with wrong key or edits',()=>{
 for(const secret of [undefined,'','wrong','PAYNOW_INTEGRATION_KEY'])
  assert.throws(()=>parseVerifiedMmfPaynowStatus(event(),{integrationKey:secret}),/DENIED/);
 const tampered=event().replace('99.00','98.00');
 assert.throws(()=>parseVerifiedMmfPaynowStatus(tampered,{integrationKey:key}),/DENIED/);
 const wrongAmount=event('Paid',{amount:'1.00'});
 assert.throws(()=>authorizeMmfPaynowStatusForOrder(parseVerifiedMmfPaynowStatus(wrongAmount,{integrationKey:key}),quote,{tenantId:quote.tenantId}),/DENIED/);
});
test('Paynow native: cross-product, tenant and order reference are strictly isolated',()=>{
 const paid=parseVerifiedMmfPaynowStatus(event(),{integrationKey:key});
 for(const q of [
  {...quote,sku:'FOUNDING'}, {...quote,amountCents:4900}, {...quote,tenantId:'fmi_tenant'},
  draftMmfFmiPaynowQuote({tenantId:'mail_tenant_b',customerReference:'customer:approved:01',contractReference:'contract:approved:02',orderReference:'MMF-PAYNOWTEST02'})
 ])assert.throws(()=>authorizeMmfPaynowStatusForOrder(paid,q,{tenantId:quote.tenantId}),/DENIED/);
});
test('Paynow native: duplicate and forbidden form fields fail even if correctly re-signed',()=>{
 assert.throws(()=>parseVerifiedMmfPaynowStatus(event()+'&status=Paid',{integrationKey:key}),/DENIED/);
 assert.throws(()=>parseVerifiedMmfPaynowStatus(event('Paid',{token:'TEST-SENSITIVE-TOKEN'}),{integrationKey:key}),/DENIED/);
 assert.throws(()=>parseVerifiedMmfPaynowStatus(event('paid'),{integrationKey:key}),/DENIED/);
 assert.throws(()=>parseVerifiedMmfPaynowStatus(event('INVALID'),{integrationKey:key}),/DENIED/);
 assert.throws(()=>parseVerifiedMmfPaynowStatus(event().replace('%3A','%INVALID'),{integrationKey:key}),/DENIED/);
});
test('Paynow native: poll URL SSRF protections accept exact official check payment URL only',()=>{
 assert.equal(validateMmfPaynowPollUrl(poll),poll);
 for(const x of [
  'http://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b',
  'https://www.paynow.co.zw.attacker.com/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b',
  'https://www.paynow.co.zw@attacker.com/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b',
  'https://www.paynow.co.zw:444/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b',
  'https://www.paynow.co.zw/Interface/CheckPayment/?guid=foo&extra=bar',
  'https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b#x',
  'https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b%0A'
 ])assert.throws(()=>validateMmfPaynowPollUrl(x),/DENIED/,x);
});
test('Paynow native: initiation is server-priced, never client-priced, signed, no provider call',()=>{
 const init=buildMmfPaynowInitiateRequest({quote,integrationId:'26343',integrationKey:key,
  returnUrl:`https://payments.mftintelligence.com/mmf/return/${quote.orderReference}`,
  resultUrl:`https://payments.mftintelligence.com/mmf/result/${quote.orderReference}`});
 assert.equal(init.method,'POST');assert.equal(init.url,'https://www.paynow.co.zw/interface/initiatetransaction');
 assert.equal(init.contentType,'application/x-www-form-urlencoded');assert.equal(init.providerCalled,false);
 const body=new URLSearchParams(init.body);
 assert.equal(body.get('id'),'26343');assert.equal(body.get('reference'),quote.orderReference);
 assert.equal(body.get('amount'),'99.00');assert.equal(body.get('status'),'Message');
 assert.match(body.get('hash'),/^[A-F0-9]{128}$/);
 assert.equal(JSON.stringify(init).includes(key),false);
});
test('Paynow native: initiation refuses unapproved destinations, price modifications, no key',()=>{
 const init={quote,integrationId:'26343',integrationKey:key,
  returnUrl:`https://payments.mftintelligence.com/mmf/return/${quote.orderReference}`,
  resultUrl:`https://payments.mftintelligence.com/mmf/result/${quote.orderReference}`};
 for(const change of [
  {quote:{...quote,amountCents:1}}, {integrationId:'26342'}, {integrationKey:undefined},
  {returnUrl:'https://attacker.example/mmf/return/'+quote.orderReference},
  {resultUrl:'https://payments.mftintelligence.com/chemistry/'},
  {resultUrl:`https://payments.mftintelligence.com/mmf/result/${quote.orderReference}?x=1`},
 ])assert.throws(()=>buildMmfPaynowInitiateRequest({...init,...change}),/DENIED/);
});
test('Paynow native: Paynow 2026 documented SHA512 outbound example reproduces official digest',()=>{
 const fields=[['id','1201'],['reference','TEST REF'],['amount','99.99'],['additionalinfo','A test ticket transaction'],
 ['returnurl','http://www.google.com/search?q=returnurl'],['resulturl','http://www.google.com/search?q=resulturl'],['status','Message']];
 const hash=createHash('sha512').update(fields.map(([,v])=>v).join('')+'3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977').digest('hex').toUpperCase();
 assert.equal(hash,'2A033FC38798D913D42ECB786B9B19645ADEDBDE788862032F1BD82CF3B92DEF84F316385D5B40DBB35F1A4FD7D5BFE73835174136463CDD48C9366B0749C689');
});
