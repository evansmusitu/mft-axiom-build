import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleMmfSharedProductRoute} from '../src/commercial/mmf-shared-product-route-stage.mjs';

const paths={
 AUTHORITY:['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf'],
 TRANSPORT:['/internal/paynow/initiate-mmf']
};
const TOKENS={AUTHORITY:'authority-'.padEnd(48,'a'),TRANSPORT:'transport-'.padEnd(48,'b')};
function env(role){
 return {
  MMF_PRODUCT_STAGE_ONLY:'true',MMF_PRODUCTION_PAYMENTS_ENABLED:'false',
  MMF_COMMERCE_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',
  MMF_MAIL_SENDING_ENABLED:'false',
  MMF_PRODUCT_STAGE_TENANT:'mmf_stage_20261011',
  MMF_AUTHORITY_BRIDGE_TOKEN:TOKENS.AUTHORITY,
  MMF_TRANSPORT_BRIDGE_TOKEN:TOKENS.TRANSPORT,
  FMI_AUTHORITY_BRIDGE_TOKEN:'fmi-'.padEnd(48,'c'),
  CHEMISTRY_TRANSPORT_BRIDGE_TOKEN:'chem-'.padEnd(48,'d'),
 };
}
function req(path,role,{token=TOKENS[role],body,method='POST',contentType='application/json',query=''}={}){
 const payload=body===undefined?{schema:'mmf-scope-probe-v1',product:'musitu-mail-fabric',tenant:'mmf_stage_20261011',stageOnly:true,operation:'PROBE',nonce:'N'.repeat(24)}:body;
 return new Request('https://example.invalid'+path+query,{method,headers:{authorization:`Bearer ${token}`,'content-type':contentType},body:method==='POST'?JSON.stringify(payload):undefined});
}
test('isolated authority admits only stage-only capability probes at both exact MMF routes, not merchant operations',async()=>{
 for(const path of paths.AUTHORITY){const result=await handleMmfSharedProductRoute(req(path,'AUTHORITY'),env('AUTHORITY'),'AUTHORITY');
  assert.equal(result.status,200);const p=await result.json();
  assert.equal(p.product,'musitu-mail-fabric');assert.equal(p.syntheticOnly,true);
  assert.equal(p.realProviderPaymentInitiated,false);assert.equal(p.merchantAuthorityProven,false);
  assert.equal(p.customerEmailEnabled,false);assert.equal(p.commercialReleaseAuthorized,false);
  assert.equal(result.headers.get('cache-control'),'no-store');
 }
});
test('transport admits only its own MMF route and is unable to initiate a provider transaction',async()=>{
 const result=await handleMmfSharedProductRoute(req(paths.TRANSPORT[0],'TRANSPORT'),env('TRANSPORT'),'TRANSPORT');
 assert.equal(result.status,200);const value=await result.json();assert.equal(value.realProviderPaymentInitiated,false);
 for(const path of paths.AUTHORITY){const bad=await handleMmfSharedProductRoute(req(path,'TRANSPORT'),env('TRANSPORT'),'TRANSPORT');assert.equal(bad.status,404)}
});
test('default disabled environment, credential reuse, unsafe flags and unexpected provider credentials fail closed',async()=>{
 const path=paths.AUTHORITY[0];
 for(const changes of [{MMF_PRODUCT_STAGE_ONLY:'false'},{MMF_PRODUCTION_PAYMENTS_ENABLED:'true'},
  {MMF_COMMERCE_ENABLED:'true'},{MMF_REAL_SEND_ENABLED:'true'},
  {MMF_AUTHORITY_BRIDGE_TOKEN:TOKENS.TRANSPORT},
  {FMI_AUTHORITY_BRIDGE_TOKEN:TOKENS.AUTHORITY}]){
  assert.equal((await handleMmfSharedProductRoute(req(path,'AUTHORITY'),{...env('AUTHORITY'),...changes},'AUTHORITY')).status,503);
 }
 const blank={...env('AUTHORITY')};delete blank.MMF_AUTHORITY_BRIDGE_TOKEN;
 assert.equal((await handleMmfSharedProductRoute(req(path,'AUTHORITY'),blank,'AUTHORITY')).status,503);
});
test('rejects untrusted caller and exact route/method/query mismatches',async()=>{
 const path=paths.AUTHORITY[0],e=env('AUTHORITY');
 assert.equal((await handleMmfSharedProductRoute(req(path,'AUTHORITY',{token:'wrong'}),e,'AUTHORITY')).status,401);
 assert.equal((await handleMmfSharedProductRoute(req(path+'-fmi','AUTHORITY'),e,'AUTHORITY')).status,404);
 assert.equal((await handleMmfSharedProductRoute(req(path,'AUTHORITY',{query:'?secret=1'}),e,'AUTHORITY')).status,404);
 assert.equal((await handleMmfSharedProductRoute(req(path,'AUTHORITY',{method:'GET'}),e,'AUTHORITY')).status,404);
 assert.equal((await handleMmfSharedProductRoute(req(path,'AUTHORITY',{contentType:'text/plain'}),e,'AUTHORITY')).status,415);
});
test('strict schema rejects extra merchant fields, cross-product tenant, checkout/refund intents and stale request identity',async()=>{
 const path=paths.AUTHORITY[0],e=env('AUTHORITY');
 const original={schema:'mmf-scope-probe-v1',product:'musitu-mail-fabric',tenant:'mmf_stage_20261011',stageOnly:true,operation:'PROBE',nonce:'N'.repeat(24)};
 for(const altered of [{...original,merchantIntegrationKey:'leak'},
  {...original,product:'fmi'}, {...original,tenant:'fmi_stage'},
  {...original,operation:'INITIATE'}, {...original,operation:'POLL'},
  {...original,operation:'REFUND'}, {...original,stageOnly:false},
  {...original,nonce:'tiny'}]){
  const answer=await handleMmfSharedProductRoute(req(path,'AUTHORITY',{body:altered}),e,'AUTHORITY');
  assert.equal(answer.status,422);
 }
});
test('no payment/network requests, actual provider callbacks, legacy aliases or mail entitlement can be produced by stage probe',async()=>{
 let networkCalled=false;const e={...env('AUTHORITY'),PAYNOW_TRANSPORT:{fetch:async()=>{networkCalled=true;throw Error('should not call')}}};
 for(const path of paths.AUTHORITY){const response=await handleMmfSharedProductRoute(req(path,'AUTHORITY'),e,'AUTHORITY');assert.equal(response.status,200);
  const txt=await response.text();assert.equal(txt.includes(TOKENS.AUTHORITY),false);assert.equal(txt.includes('Paid'),false);}
 assert.equal(networkCalled,false);
});