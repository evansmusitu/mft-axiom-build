import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectMmfCanaryBindingsReadOnly} from '../src/staging/mmf-canary-bindings-getonly.mjs';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const BASE=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/mmf-paynow-isolated-deny-canary-20261012`;
const canary=readFileSync(new URL('../src/staging/mmf-paynow-canary.mjs',import.meta.url),'utf8');
const json=x=>new Response(JSON.stringify({success:true,result:x}),{headers:{'content-type':'application/json'}});
const makeFetcher=(bindings)=>{const history=[];return {history,async fetchImpl(url,opts){history.push({url,method:opts.method});assert.equal(opts.method,'GET');
 if(url===BASE)return new Response(canary,{headers:{'content-type':'application/javascript'}});
 if(url===BASE+'/settings')return json({bindings});
 if(url===BASE+'/subdomain')return json({enabled:false,previews_enabled:false});
 throw Error('unexpected-url');}}};
const opts={accountId:ACCOUNT,token:'TEST_ONLY_CLOUDFLARE_TOKEN_1234567890123456'};
test('GET-only inspection reports both exact existing payment targets with 3 GETs and no writes',async()=>{
 const f=makeFetcher([{type:'service',name:'MMF_PAYNOW_AUTHORITY',service:'mft-phase8-external-authority'},
  {type:'service',name:'MMF_PAYNOW_TRANSPORT',service:'mft-paynow-transport-gateway'}]);
 const r=await inspectMmfCanaryBindingsReadOnly({...opts,fetchImpl:f.fetchImpl});
 assert.equal(r.exactServiceBindingsMatch,true);assert.equal(r.sourceHashMatchesOriginal,true);
 assert.equal(r.publicWorkersDevDisabled,true);assert.equal(r.previewDisabled,true);
 assert.equal(r.cloudflareMutationCount,0);assert.equal(r.commercialActivationAllowed,false);
 assert.equal(r.getCount,3);assert.equal(f.history.length,3);
});
test('inspection discloses mismatch rather than claiming bindings installed',async()=>{
 const f=makeFetcher([]);const r=await inspectMmfCanaryBindingsReadOnly({...opts,fetchImpl:f.fetchImpl});
 assert.equal(r.exactServiceBindingsMatch,false);assert.equal(r.observedBindingCount,0);assert.equal(f.history.length,3);
});
test('invalid account or missing authentication refuses before any fetch',async()=>{
 let n=0;await assert.rejects(inspectMmfCanaryBindingsReadOnly({...opts,accountId:'invalid',fetchImpl:async()=>{n++}}),/DENIED/);
 await assert.rejects(inspectMmfCanaryBindingsReadOnly({...opts,token:'',fetchImpl:async()=>{n++}}),/DENIED/);assert.equal(n,0);
});