import test from 'node:test';
import assert from 'node:assert/strict';
import {auditLiveMmfPaynowScope} from '../src/staging/audit-live-paynow-merchant-scope.mjs';
const base='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts/';
const authority='mft-phase8-external-authority',transport='mft-paynow-transport-gateway',billing='mft-fmi-billing';
const secret='SECURE_TEST_ONLY_RANDOM_TOKEN_ABSOLUTELY_NOT_REAL';
const js='/* synthetic */ '.repeat(10)+'\n';
function trial(mutate){const calls=[];const bindings={
 [authority]:['PAYNOW_INTEGRATION_KEY','FMI_AUTHORITY_BRIDGE_TOKEN'],
 [transport]:['FMI_TRANSPORT_BRIDGE_TOKEN'],[billing]:['PAYMENT_AUTHORITY','PAYNOW_TRANSPORT']};
 const request=async(url,init)=>{calls.push({url,method:init.method,redirect:init.redirect});
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,`Bearer ${secret}`);
  const short=url.slice(base.length),name=short.replace(/\/settings$/,'');
  if(![authority,transport,billing].includes(name))return new Response('not found',{status:404});
  if(short.endsWith('/settings'))return Response.json({success:true,result:{bindings:bindings[name].map(name=>({name,type:'secret_text'}))}});
  const t=js+(name===authority?'/internal/paynow/verify-callback-fmi':name===transport?'/internal/paynow/initiate':'/fmi/checkout');
  return new Response(t);
 };
 return {calls,fetchImpl:mutate??request};}
test('six read-only requests never reveal source, key, transaction, or assume real payment enablement',async()=>{
 const o=trial();const r=await auditLiveMmfPaynowScope({accountId:'93f395f5121954671f92fffa453d6b61',token:secret,fetchImpl:o.fetchImpl});
 assert.equal(o.calls.length,6);assert.equal(r.cloudflareMethod,'GET');
 assert.equal(r.eligibleForPaidActivation,false);assert.equal(r.realProviderPollCertified,false);
 assert.equal(r.transactionOrCustomerDataAccessed,false);assert.equal(r.cloudflareMutations,false);
 assert.equal(JSON.stringify(r).includes(secret),false);assert.equal(JSON.stringify(r).includes('PAYNOW_INTEGRATION_KEY'),false);
});
test('incorrect account and missing token always fail before network call',async()=>{
 const o=trial();for(const cfg of [{accountId:'wrong',token:secret},{accountId:'93f395f5121954671f92fffa453d6b61',token:'short'}]){
  await assert.rejects(()=>auditLiveMmfPaynowScope({...cfg,fetchImpl:o.fetchImpl}),/DENIED/);
 }assert.equal(o.calls.length,0);
});
test('malformed, excessive or failed worker response fails closed',async()=>{
 const fns=[async()=>new Response('',{status:403}),async()=>new Response('a'.repeat(2_000_001)),
  async url=>url.endsWith('/settings')?Response.json({success:false}):new Response(js)];
 for(const fetchImpl of fns){await assert.rejects(()=>auditLiveMmfPaynowScope({accountId:'93f395f5121954671f92fffa453d6b61',token:secret,fetchImpl}),/DENIED/);}
});
