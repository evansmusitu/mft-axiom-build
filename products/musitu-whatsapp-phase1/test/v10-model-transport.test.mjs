import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadableStream} from 'node:stream/web';
import {createEvidenceBoundModelGateway} from '../src/ai/provider-gateway.mjs';
const tenantId='b4bb08cf-875b-4c24-9520-4a92406aa6c2';
const approvedFaqs=[{tenantId,faqId:'opening',question:'Opening hours?',answer:'Eight in the morning',approved:true}];
const qualify=fetchImpl=>createEvidenceBoundModelGateway({qualified:true,allowedOrigins:['https://models.example.invalid'],url:'https://models.example.invalid/v1/chat/completions',token:'synthetic-no-network',model:'qualification',timeoutMs:100,fetchImpl});
const responseText=JSON.stringify({choices:[{message:{content:JSON.stringify({action:'ANSWER',faqId:'opening'})}}]});
test('real streamed response under 8KiB selects approved FAQ only',async()=>{
 const fetchImpl=async()=>new Response(responseText,{headers:{'content-type':'application/json','content-length':String(responseText.length)}});
 const result=await qualify(fetchImpl).select({tenantId,question:'Opening hours?',approvedFaqs});
 assert.equal(result.status,'DRAFT');assert.equal(result.body,'Eight in the morning');
});
test('misleading content-length cannot bypass actual 8KiB streaming limit',async()=>{
 const payload=responseText+' '.repeat(9000);
 const fetchImpl=async()=>new Response(payload,{headers:{'content-type':'application/json','content-length':'10'}});
 const result=await qualify(fetchImpl).select({tenantId,question:'Opening hours?',approvedFaqs});
 assert.equal(result.status,'HANDOVER_REQUIRED');
});
test('fetch implementation ignoring AbortSignal still times out without approving a result',async()=>{
 const fetchImpl=async()=>new Promise(()=>{});
 const start=Date.now();
 const result=await qualify(fetchImpl).select({tenantId,question:'Opening hours?',approvedFaqs});
 assert.equal(result.status,'HANDOVER_REQUIRED');
 assert.ok(Date.now()-start<1500,'uncooperative transport must be bounded');
});
