import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerEntry } from './customer_entry.mjs';
const e=new TextEncoder(),b64=(v)=>Buffer.from(typeof v==='string'?v:v).toString('base64url');
const now=1800000000,nowMs=now*1000;
const key='only synthetic integration capability key '.repeat(3);
const jwkkeys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pubkey=await crypto.subtle.exportKey('jwk',jwkkeys.publicKey);
for(const k of ['ext','key_ops'])delete pubkey[k];
const policy={issuer:'https://identity.example.test',audience:'https://inference.mftintelligence.com',jwks:[{...pubkey,kid:'issuer_k1',alg:'RS256',use:'sig'}]};
const input={model:'@cf/zai-org/glm-4.7-flash',provider:'cloudflare',max_tokens:32,messages:[{role:'user',content:'SYNTHETIC TEST ONLY'}]};
const raw=JSON.stringify(input);
const sha=async raw=>Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256',e.encode(raw)))).toString('hex');
const signedJwt=async (claims={})=>{
 const payload={iss:policy.issuer,aud:policy.audience,sub:'customer_1',project:'project_1',scope:'axiom.inference',iat:now-10,nbf:now-10,exp:now+60,...claims};
 const content=b64(JSON.stringify({alg:'RS256',kid:'issuer_k1',typ:'JWT'}))+'.'+b64(JSON.stringify(payload));
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',jwkkeys.privateKey,e.encode(content));return content+'.'+b64(new Uint8Array(sig));
};
const signedCap=async (subject='customer_1')=>{
 const cap={schema:'musitu.axiom.public-inference-capability.v1',subject,project:'project_1',nonce:'a'.repeat(64),provider:'cloudflare',model:input.model,request_sha256:await sha(raw),classification:'EXTERNAL_PROVIDER_APPROVED',consent:true,max_tokens:32,issued_ms:nowMs-5000,expires_ms:nowMs+5000,risk_class:'S2',external_read_only:true,public_release_authority:false};
 const token=b64(JSON.stringify(cap));const k=await crypto.subtle.importKey('raw',e.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const hmac=Buffer.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,e.encode(token)))).toString('hex');
 return {token,hmac};
};
const env={AXIOM_INFERENCE_IDP_POLICY:policy,AXIOM_CAPABILITY_HMAC_KEY:key};
let forwarded=0;const wrapped=createCustomerEntry({delegate:{async fetch(){forwarded++;return new Response('synthetic-admitted',{status:202})}},now:()=>nowMs});
const request=async (jwt,subject='customer_1')=>{const c=await signedCap(subject);return new Request('https://inference.example.test/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+jwt,'x-axiom-signed-capability':c.token,'x-axiom-capability-hmac':c.hmac},body:raw})};
test('accepts matching independent identity and issuer-authorized request to isolated delegate',async()=>{
 forwarded=0;const r=await wrapped.fetch(await request(await signedJwt()),env);assert.equal(r.status,202);assert.equal(forwarded,1);
});
test('rejects MCP-only identity, wrong subject, absent OIDC policy',async()=>{
 forwarded=0;
 assert.equal((await wrapped.fetch(await request(await signedJwt({scope:'axiom.execute'})),env)).status,403);
 assert.equal((await wrapped.fetch(await request(await signedJwt(),'another_customer'),env)).status,403);
 assert.equal((await wrapped.fetch(await request(await signedJwt()),{AXIOM_CAPABILITY_HMAC_KEY:key})).status,503);
 assert.equal(forwarded,0);
});
test('missing independently signed capability and bare client JWT alone cannot authorize inference',async()=>{
 forwarded=0;const req=await request(await signedJwt());req.headers.delete('x-axiom-signed-capability');
 assert.equal((await wrapped.fetch(req,env)).status,403);assert.equal(forwarded,0);
});
test('no unauthenticated route exists and health must be explicit disabled',async()=>{
 forwarded=0;const r=await wrapped.fetch(new Request('https://inference.example.test/healthz'),env);
 assert.equal(r.status,200);assert.match(await r.text(),/DISABLED/);
 const unknown=await wrapped.fetch(new Request('https://inference.example.test/admin'),env);
 assert.equal(unknown.status,404);assert.equal(forwarded,0);
});

test('rejects cross-project identity even with valid independent subject and S2 capability',async()=>{
 forwarded=0;
 const cross=await request(await signedJwt({project:'project_OTHER'}));
 const r=await wrapped.fetch(cross,env);
 assert.equal(r.status,403);
 assert.equal(forwarded,0);
});
test('rejects signed identity lacking explicit project authorization',async()=>{
 forwarded=0;
 const r=await wrapped.fetch(await request(await signedJwt({project:undefined})),env);
 assert.equal(r.status,403);
 assert.equal(forwarded,0);
});
