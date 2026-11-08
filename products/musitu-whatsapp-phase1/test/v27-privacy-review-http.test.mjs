import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {createConversationPrivacyReviewHandler} from '../src/staging/privacy-review.mjs';
import {requestConversationPrivacyReview} from '../src/dashboard/privacy-review.mjs';

const tenant='986eb904-7296-46a9-9e9b-94074db9b547',conversation='00000000-0000-4000-8000-000000000001';
const origin='https://private.example',requestId='00000000-0000-4000-8000-000000000002';
const encrypted=Buffer.concat([Buffer.from('MUSITU_CONVERSATION_EXPORT_V1\0'),Buffer.alloc(64,19)]);
const sha=createHash('sha256').update(encrypted).digest('hex');
const input=()=>({requestId,approveReview:true,exportKey:Buffer.alloc(32,7).toString('base64')});
const context=()=>({params:Promise.resolve({tenant,conversation})});
function request(body=input(),requestOrigin=origin){return new Request(origin+'/api/export',{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify(body)});}
function fixture(patch={}){
 const seen={sessions:0,exports:0,ownerChecks:0,scope:null,key:null};
 const handler=createConversationPrivacyReviewHandler({enabled:true,appOrigin:origin,authenticate:async()=>{seen.sessions++;return{subject:'genuine-session-subject'};},authorizeOwner:async args=>{seen.ownerChecks++;assert.equal(args.tenantId,tenant);assert.equal(args.actorId,'genuine-session-subject');},exportConversation:async args=>{seen.exports++;seen.scope=args;seen.key=args.exportKey;await args.recheckSession();await args.recheckSession();return{encrypted,receipt:{sha256:sha,bytes:encrypted.length,delivered:false,erased:false}};},...patch});
 return{handler,seen};
}

test('private review export is disabled by default and rejects foreign business/origin before export',async()=>{
 for(const enabled of [false,undefined,'true',1]){const {handler,seen}=fixture({enabled});assert.equal((await handler(request(),context())).status,404);assert.equal(seen.sessions,0);}
 const f=fixture();assert.equal((await f.handler(request(input(),'https://foreign.example'),context())).status,403);
 assert.equal((await f.handler(request(),{params:{tenant:'00000000-0000-4000-8000-000000000099',conversation}})).status,404);
 assert.equal(f.seen.exports,0);
});

test('review approval, canonical fresh-key representation and exact input shape are mandatory',async()=>{
 for(const patch of [{approveReview:false},{exportKey:'private'},{exportKey:Buffer.alloc(31).toString('base64')},{requestId:'../path'},{actorId:'forged-owner'}]){
  const f=fixture();const r=await f.handler(request({...input(),...patch}),context());assert.equal(r.status,400);assert.equal(f.seen.exports,0);
 }
});

test('authenticated scope is bound by server and response contains only encrypted bytes with safe receipt headers',async()=>{
 const {handler,seen}=fixture();const r=await handler(request(),context());
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('content-type'),'application/octet-stream');
 assert.equal(r.headers.get('x-musitu-export-sha256'),sha);assert.equal(r.headers.get('x-musitu-export-key'),null);
 assert.deepEqual(Buffer.from(await r.arrayBuffer()),encrypted);assert.equal(seen.scope.actorId,'genuine-session-subject');assert.equal(seen.scope.tenantId,tenant);assert.equal(seen.scope.conversationId,conversation);
 assert.ok(seen.sessions>=3);assert.deepEqual(seen.key,Buffer.alloc(32));
 assert.equal(seen.ownerChecks,1);
});

test('owner revocation committed during encryption prevents delivery after export work finishes',async()=>{
 const {handler,seen}=fixture({authorizeOwner:async()=>{throw Error('ACCESS_DENIED');}});
 const response=await handler(request(),context());assert.equal(seen.exports,1);assert.equal(response.status,403);
 assert.equal((await response.text()).includes(encrypted.toString('base64')),false);assert.deepEqual(seen.key,Buffer.alloc(32));
});

test('expired/replaced sessions, denied owner membership and corrupt/oversize results fail without disclosure',async()=>{
 let calls=0;
 const scenarios=[{authenticate:async()=>({subject:++calls===1?'original':'replaced'})},
  {exportConversation:async()=>{throw Error('ACCESS_DENIED');}},
  {exportConversation:async()=>({encrypted:Buffer.from('PLAINTEXT_PRIVATE_CONTENT'),receipt:{}})},
  {exportConversation:async()=>({encrypted:Buffer.alloc(2*1024*1024+1),receipt:{}})},
  {exportConversation:async()=>{throw Error('secret-provider-error '+input().exportKey);}}];
 for(const patch of scenarios){const f=fixture(patch);const r=await f.handler(request(),context());assert.ok([403,503].includes(r.status));const text=await r.text();assert.equal(text.includes('PRIVATE_CONTENT'),false);assert.equal(text.includes(input().exportKey),false);}
});

test('browser download preparation uses a new key per request and verifies ciphertext digest',async()=>{
 const keys=[];
 const fetchImpl=async(path,options)=>{const body=JSON.parse(options.body);keys.push(body.exportKey);const f=fixture();return f.handler(request(body),context());};
 const args={tenantId:tenant,conversationId:conversation,fetchImpl,cryptoImpl:webcrypto};
 const a=await requestConversationPrivacyReview(args),b=await requestConversationPrivacyReview(args);
 assert.notEqual(keys[0],keys[1]);assert.notEqual(a.keyFile.exportKeyBase64,b.keyFile.exportKeyBase64);
 assert.equal(a.keyFile.tenantId,tenant);assert.equal(a.keyFile.conversationId,conversation);assert.equal(a.keyFile.ciphertextSha256,sha);assert.deepEqual(Buffer.from(a.encrypted),encrypted);
 const changed=encrypted.map(x=>x^1);
 await assert.rejects(requestConversationPrivacyReview({...args,fetchImpl:async()=>new Response(changed,{headers:{'content-type':'application/octet-stream','x-musitu-export-sha256':sha}})}),/PRIVACY_REVIEW_DOWNLOAD_FAILED/);
});

test('browser preparation rejects oversized, stalled and redirected downloads without returning a key',async()=>{
 const args={tenantId:tenant,conversationId:conversation,cryptoImpl:webcrypto,timeoutMs:25};
 const fetches=[async()=>new Response(Buffer.alloc(2*1024*1024+1),{headers:{'content-type':'application/octet-stream','x-musitu-export-sha256':sha}}),
  async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/octet-stream','x-musitu-export-sha256':sha}}),
  async()=>({ok:true,redirected:true})];
 for(const fetchImpl of fetches)await assert.rejects(requestConversationPrivacyReview({...args,fetchImpl}),/PRIVACY_REVIEW_DOWNLOAD_FAILED/);
});
