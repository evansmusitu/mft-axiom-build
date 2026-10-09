import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { runGroq, ProviderDenied } from './providers.mjs';
import { reserveQuota } from './quota.mjs';

const groqBody={ model:'openai/gpt-oss-120b', messages:[{role:'user',content:'Synthetic public request'}], max_tokens:80 };
const KEY='TEST_CREDENTIAL_ONLY_NOT_REAL';
function requestDb(){
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  return {raw:db,prepare(sql){return {bind(...params){return {async run(){const r=db.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)}};}}}}}};
}
function claims(i,provider='cloudflare',max_tokens=80){return {nonce:(i+9000).toString(16).padStart(64,'0'),subject:`customer${i}`,project:'private_qualification',provider,max_tokens};}
const now=Date.UTC(2026,9,9,9,0);

// High-severity: arrayBuffer() reads an arbitrarily big upstream response into
// memory before the current 40KiB limit, allowing uncontrolled memory use.
test('Groq response is read with a streaming byte limit, never an unbounded arrayBuffer',async()=>{
  let readCalls=0, cancelled=false;
  const first=Buffer.from('z'.repeat(41000));
  const upstream={ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
    arrayBuffer(){throw Error('unbounded buffer must never be called')},
    body:{getReader(){return {async read(){readCalls++;return {done:false,value:first}},async cancel(){cancelled=true}}}}};
  await assert.rejects(()=>runGroq(async()=>upstream,KEY,groqBody),ProviderDenied);
  assert.equal(readCalls,1,'must stop reading before second chunk');
  assert.equal(cancelled,true,'must cancel upstream when size exceeds limit');
});

test('Groq response requires streaming reader and a JSON media type',async()=>{
  const noStream={ok:true,status:200,headers:new Headers({'content-type':'application/json'}),arrayBuffer(){throw Error('not allowed')}};
  await assert.rejects(()=>runGroq(async()=>noStream,KEY,groqBody),ProviderDenied);
  const notJson=new Response('<html>not json</html>',{status:200,headers:{'content-type':'text/html'}});
  await assert.rejects(()=>runGroq(async()=>notJson,KEY,groqBody),ProviderDenied);
});

test('Groq streaming response accepts a valid bounded synthetic result',async()=>{
  const response=new Response(JSON.stringify({choices:[{message:{content:'SAFE_RESPONSE'}}]}),{status:200,headers:{'content-type':'application/json'}});
  const text=await runGroq(async()=>response,KEY,groqBody);
  assert.equal(text,'SAFE_RESPONSE');
});

test('quota refuses provider-level reserved output-token overrun even below request limits',async()=>{
  const db=requestDb();
  let count=0;
  for(let i=0;i<20;i++){
    try{await reserveQuota(db,claims(i,'cloudflare',256),now+i*60000);count++;}
    catch{break;}
  }
  assert.ok(count<20,'must cap Cloudflare daily reserved output-token exposure below 5120');
  assert.ok(count>=10,'a small synthetic development allowance should remain available');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM public_inference_reservations').get().n,count);
});

test('quota keeps provider-specific output budgets separate and bounded',async()=>{
  const db=requestDb();let admitted=0;
  for(let i=0;i<20;i++){
    try{await reserveQuota(db,claims(i,'groq',256),now+i*60000);admitted++;}catch{break;}
  }
  assert.ok(admitted<20,'must not permit 5120 Groq reserved tokens on zero-cost candidate');
  await reserveQuota(db,claims(45,'cloudflare',80),now+25*60000);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM public_inference_reservations').get().n,admitted+1);
});

// Identity scope must reject non-string values BEFORE quota. JavaScript regexes
// coerce null, numbers and arrays to strings, which is unsafe for issuer claims.
test('signed capability refuses null and numeric customer/project identities',async()=>{
  const { authorizeRequest, sha256hex }=await import('./signed_capability.mjs');
  const {createHmac}=await import('node:crypto');
  const body=JSON.stringify({provider:'cloudflare',model:'@cf/zai-org/glm-4.7-flash',messages:[{role:'user',content:'Public synthetic request'}],max_tokens:10});
  const signingKey='L'.repeat(64);
  for(const mutation of [{subject:null},{subject:123},{project:null},{project:123}]){
    const claim={schema:'musitu.axiom.public-inference-capability.v1',subject:'user1',project:'project1',
      nonce:'a'.repeat(64),provider:'cloudflare',model:'@cf/zai-org/glm-4.7-flash',
      request_sha256:await sha256hex(body),classification:'EXTERNAL_PROVIDER_APPROVED',consent:true,
      max_tokens:10,issued_ms:now-1000,expires_ms:now+30000,risk_class:'S2',
      external_read_only:true,public_release_authority:false,...mutation};
    const token=Buffer.from(JSON.stringify(claim)).toString('base64url');
    const signature=createHmac('sha256',signingKey).update(token).digest('hex');
    const headers=new Headers({'x-axiom-signed-capability':token,'x-axiom-capability-hmac':signature});
    await assert.rejects(()=>authorizeRequest(headers,signingKey,body,now),Error);
  }
});
