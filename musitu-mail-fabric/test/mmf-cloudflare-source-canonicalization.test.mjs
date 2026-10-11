import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalCloudflareWorkerSource} from '../src/staging/canonical-cloudflare-worker-source.mjs';
import {auditLiveMmfPaynowScope} from '../src/staging/audit-live-paynow-merchant-scope.mjs';
const account='93f395f5121954671f92fffa453d6b61', token='SYNTHETIC_CLOUDFLARE_READONLY_TOKEN_12345';
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/`;
const workerNames=['mft-phase8-external-authority','mft-paynow-transport-gateway','mft-fmi-billing'];
const actualModule='// documented test-only module\n'+ '/internal/paynow/sign-initiate-fmi'.repeat(8);
function multipart(boundary,metadata='{}',source=actualModule){
 return `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Disposition: form-data; name="index.js"; filename="index.js"\r\nContent-Type: application/javascript+module\r\n\r\n${source}\r\n--${boundary}--\r\n`;
}
test('multipart boundary and metadata nonce do not change stable JS module digest; metadata route bait is ignored',async()=>{
 const a=await canonicalCloudflareWorkerSource(new Response(multipart('boundary-1','{"nonce":"A","url":"/internal/paynow/sign-initiate-mmf"}'),{headers:{'content-type':'multipart/form-data; boundary=boundary-1'}}));
 const b=await canonicalCloudflareWorkerSource(new Response(multipart('boundary-2','{"nonce":"B","url":"/internal/paynow/sign-initiate-mmf"}'),{headers:{'content-type':'multipart/form-data; boundary=boundary-2'}}));
 assert.equal(a.sourceSha256,b.sourceSha256);
 assert.equal(a.sourceText,b.sourceText);
 assert.ok(!a.sourceText.includes('/internal/paynow/sign-initiate-mmf'));
 assert.equal(a.multipartNormalized,true);
});
test('GET-only audit recognizes stable JS across Cloudflare multipart boundaries but never certifies baseline or payments',async()=>{
 const counts={};const fetchImpl=async(url,opts)=>{
  assert.equal(opts.method,'GET'); assert.equal(opts.redirect,'error');
  const name=url.slice(base.length).replace(/\/settings$/,'');assert.ok(workerNames.includes(name));
  if(url.endsWith('/settings'))return Response.json({success:true,result:{bindings:[]}});
  counts[name]=(counts[name]??0)+1;
  const boundary=`dynamic-boundary-${counts[name]}`;
  return new Response(multipart(boundary,JSON.stringify({read:counts[name],spoof:'/internal/paynow/sign-initiate-mmf'})),{headers:{'content-type':`multipart/form-data; boundary=${boundary}`}});
 };
 const r=await auditLiveMmfPaynowScope({accountId:account,token,fetchImpl});
 assert.equal(r.sourceReadbackStableAcrossReads,true);
 assert.equal(r.multipartSourceNormalized,true);
 assert.equal(r.mmfPaymentAuthorityBound,false);
 assert.equal(r.verifiedExistingMerchantStack,false);
 assert.equal(r.sourceHashDriftIndependentlyProven,false);
 assert.deepEqual(r.changedSharedWorkers,[]);
 assert.equal(r.eligibleForPaidActivation,false);
 assert.equal(r.cloudflareMethod,'GET');assert.equal(r.cloudflareCalls,9);
});
test('malformed multipart, duplicate script name, missing script, oversized and fake boundary fail closed',async()=>{
 const examples=[
  [multipart('safe').replaceAll('--safe','--other'),'multipart/form-data; boundary=safe'],
  [multipart('safe')+multipart('safe'),'multipart/form-data; boundary=safe'],
  [`--safe\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{}\r\n--safe--\r\n`,'multipart/form-data; boundary=safe'],
  ['bad '.repeat(500),'multipart/form-data; boundary=safe']
 ];
 for(const [raw,contentType] of examples){
  await assert.rejects(()=>canonicalCloudflareWorkerSource(new Response(raw,{headers:{'content-type':contentType}})),/MMF_CLOUDFLARE_SOURCE_DENIED/);
 }
});

test('changing actual script code changes canonical fingerprint even if metadata and boundary are identical',async()=>{
 const ct='multipart/form-data; boundary=same';
 const a=await canonicalCloudflareWorkerSource(new Response(multipart('same','{}',actualModule),{headers:{'content-type':ct}}));
 const b=await canonicalCloudflareWorkerSource(new Response(multipart('same','{}',actualModule+'\n// additional line'),{headers:{'content-type':ct}}));
 assert.notEqual(a.sourceSha256,b.sourceSha256);
});
test('Cloudflare classic Service Worker multipart with a single untyped script part is normalized',async()=>{
 const body=`--classic\r\nContent-Disposition: form-data; name="script"\r\n\r\n${actualModule}\r\n--classic--\r\n`;
 const r=await canonicalCloudflareWorkerSource(new Response(body,{headers:{'content-type':'multipart/form-data; boundary=classic'}}));
 assert.equal(r.multipartNormalized,true);
 assert.equal(r.sourceText,actualModule);
 assert.match(r.sourceSha256,/^[a-f0-9]{64}$/);
});
