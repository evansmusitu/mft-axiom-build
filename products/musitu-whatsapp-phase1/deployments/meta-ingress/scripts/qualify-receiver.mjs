import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Execute from an authorized hosted build when local egress cannot reach Vercel.
// No tokens, signed valid events, database mutations or provider sends.
const target=new URL(process.argv[2]||'https://invalid.invalid');
if(target.protocol!=='https:'||!/^musitu-whatsapp-meta-receiver-20261015-[a-z0-9]+-evansmusitu\.vercel\.app$/.test(target.hostname)||target.pathname!=='/'||target.search||target.username||target.password||target.port)throw Error('ISOLATED_HTTP_TARGET_REQUIRED');
const results=[];
async function probe(name,path,options,status,body){
 const result=await fetch(new URL(path,target),{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
 const text=await result.text();assert.equal(result.status,status,name);
 assert.equal(text,body,name);
 const headers={};for(const key of ['cache-control','content-security-policy','x-frame-options','x-content-type-options','x-robots-tag','strict-transport-security'])headers[key]=result.headers.get(key);
 assert.equal(headers['cache-control'],'no-store');assert.equal(headers['x-frame-options'],'DENY');
 assert.equal(headers['x-content-type-options'],'nosniff');assert.equal(headers['x-robots-tag'],'noindex, nofollow, noarchive');
 assert.match(headers['content-security-policy'],/default-src 'none'/);
 results.push({name,status:result.status,body:text,headers});
 console.log('MUSITU_ISOLATED_HTTP_CASE='+JSON.stringify(results.at(-1)));
}
await probe('unconfigured webhook refuses verification','/api/meta/webhook?hub.mode=subscribe&hub.verify_token=qualification-not-a-secret&hub.challenge=123',{},503,'DEVELOPMENT_CHANNEL_UNAVAILABLE');
for(const path of ['/','/api/status','/package.json','/package-lock.json','/vercel.json','/runtime/source-digests.json','/runtime/src/staging/meta-ingress.mjs','/api/index.mjs','/node_modules/pg/package.json','/api/send'])await probe('no exposed surface '+path,path,{},404,'NOT_FOUND');
await probe('missing signature refused','/api/meta/webhook',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},401,'SIGNATURE_REJECTED');
await probe('non-JSON refused','/api/meta/webhook',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'},415,'UNSUPPORTED_MEDIA_TYPE');
await probe('unsupported method refused','/api/meta/webhook',{method:'DELETE'},405,'METHOD_NOT_ALLOWED');
await probe('malformed signature refused before oversized body','/api/meta/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256:'+'0'.repeat(64)},body:' '.repeat(262145)},401,'SIGNATURE_REJECTED');
// A syntactically valid signature lets the boundary check the size before
// accessing missing credentials. This still never passes HMAC authentication.
await probe('oversize with well-formed signature refused','/api/meta/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64)},body:' '.repeat(262145)},413,'BODY_TOO_LARGE');
console.log('MUSITU_ISOLATED_HTTP_QUALIFICATION='+JSON.stringify({runId:randomUUID(),observedAt:new Date().toISOString(),target:target.origin,scope:'GENUINE_HOSTED_HTTP_NO_META_PROVIDER_OR_DATABASE_ADMISSION',pass:results.length,fail:0,requestsCarryCredentials:false}));
