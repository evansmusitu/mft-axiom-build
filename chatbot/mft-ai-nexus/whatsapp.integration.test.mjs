import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

async function signedReq(payload,secret='test-secret') {
 const body=JSON.stringify(payload);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const value=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
 return new Request('https://mft.local/webhook',{method:'POST',body,headers:{'x-hub-signature-256':'sha256='+value}});
}
function event(phone='445566') {
 return {object:'whatsapp_business_account',entry:[{id:'WABA_TEST',changes:[{field:'messages',value:{metadata:{phone_number_id:phone},messages:[{id:'wamid.test.1',from:'263781000000',type:'text',text:{body:'1'}}]}}]}]};
}
function whatsappEnv(budgetClaims){
 let i=0;
 return {
  ENABLE_WHATSAPP_MESSAGES:'true',WHATSAPP_APP_SECRET:'test-secret',
  WHATSAPP_VERIFY_TOKEN:'test-verify',WHATSAPP_ACCESS_TOKEN:'test-meta-access',
  WHATSAPP_PHONE_NUMBER_ID:'445566',AI_BUDGET:{
   idFromName:()=>({}),
   get:()=>({fetch:async()=>new Response(JSON.stringify({allowed:budgetClaims[i++]??false}),{status:200})})
  }
 };
}
test('signed WhatsApp event cannot activate with valid credentials alone',async()=>{
 const env=whatsappEnv([true]);delete env.ENABLE_WHATSAPP_MESSAGES;
 const r=await worker.fetch(await signedReq(event()),env,{waitUntil(){}});
 assert.equal(r.status,503);
});
test('configured phone number ID must match signed Meta webhook metadata',async()=>{
 const env=whatsappEnv([true]);
 const old=globalThis.fetch;
 let outbound=0;
 globalThis.fetch=async()=>{outbound++;return new Response('{}',{status:200})};
 try {
  const pending=[];
  const r=await worker.fetch(await signedReq(event('WRONG_SENDER')),env,{waitUntil(x){pending.push(x)}});
  await Promise.all(pending);
  assert.equal(r.status,200);
  assert.equal(outbound,0);
 } finally {globalThis.fetch=old}
});
test('duplicated signed WhatsApp message id triggers at most one outbound message',async()=>{
 const env=whatsappEnv([true,false]);
 const old=globalThis.fetch;
 let outbound=0;
 globalThis.fetch=async()=>{outbound++;return new Response('{}',{status:200})};
 try {
  for(let i=0;i<2;i++){
   const pending=[];
   const r=await worker.fetch(await signedReq(event()),env,{waitUntil(x){pending.push(x)}});
   assert.equal(r.status,200);
   await Promise.all(pending);
  }
  assert.equal(outbound,1);
 }finally{globalThis.fetch=old}
});
test('webhook verify challenge never enables delivery by itself',async()=>{
 const env=whatsappEnv([true]);
 const r=await worker.fetch(new Request('https://mft.local/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=24680'),env);
 assert.equal(r.status,200);
 assert.equal(await r.text(),'24680');
});
