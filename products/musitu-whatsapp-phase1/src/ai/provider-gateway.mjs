/**
 * PRIVATE QUALIFICATION MODEL GATEWAY. Inactive unless an operator supplies a
 * qualified provider and transport. The provider selects FAQ ids only and
 * cannot write customer-facing message text or invoke tools.
 */
import {selectEvidenceBoundReply} from './evidence-bound-selector.mjs';
const HANDOVER={status:'HANDOVER_REQUIRED',sourceFaqId:null,body:null,requiresHumanReview:true};
// Conservative preflight only. Not general PII detection and not privacy
// certification. Potential personal/secret-bearing prompts are routed to a
// human WITHOUT exposing them to a third-party model selection endpoint.
function containsPotentialSensitiveData(value){
 if(typeof value!=='string')return false;
 return /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(value)||
  /\b(?:https?:\/\/|www\.)\S+/i.test(value)||
  /(?:\+?\d[\d\s().-]{7,}\d)/.test(value)||
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|(?:api\s*key|bearer|password)\s*(?::|=|is)?\s*[A-Za-z0-9_-]{8,})/i.test(value);
}

export function createEvidenceBoundModelGateway({qualified=false,url,token,model,fetchImpl=globalThis.fetch,timeoutMs=3000,allowedOrigins}={}){
 if(!qualified)throw new Error('MODEL_GATEWAY_DISABLED');
 let target;
 try{target=new URL(url);}catch{throw new Error('MODEL_ENDPOINT_NOT_ALLOWED');}
 if(target.protocol!=='https:'||!target.hostname.includes('.')||
    /(^localhost$|\.localhost$|\.local$|\.internal$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^\[)/i.test(target.hostname)||
    target.username||target.password||target.port||target.search||target.hash||
    target.pathname!=='/v1/chat/completions')throw new Error('MODEL_ENDPOINT_NOT_ALLOWED');
 if(typeof model!=='string'||!/^[-_./A-Za-z0-9]{1,120}$/.test(model))throw new Error('INVALID_MODEL_ID');
 if(typeof token!=='string'||!token.trim()||token.length>10000||typeof fetchImpl!=='function')throw new Error('MODEL_CREDENTIAL_REQUIRED');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>15000)throw new Error('MODEL_TIMEOUT_INVALID');
 if(!Array.isArray(allowedOrigins)||allowedOrigins.length!==1||
    typeof allowedOrigins[0]!=='string'||allowedOrigins[0]!==target.origin)
  throw new Error('MODEL_ORIGIN_NOT_ALLOWED');
 return Object.freeze({
  enabled:true,mode:'ISOLATED_PROVIDER_QUALIFICATION',
  async select({tenantId,question,approvedFaqs}){
   // A trusted provider can still retain prompts. Never disclose obvious
   // customer identifiers or credentials as part of the FAQ ID selection.
   if(containsPotentialSensitiveData(question)||
     (Array.isArray(approvedFaqs)&&approvedFaqs.some(faq=>faq?.approved===true&&
      containsPotentialSensitiveData(faq?.question))))return {...HANDOVER};
   return selectEvidenceBoundReply({tenantId,question,approvedFaqs,provider:{
    async propose({question,candidates}){
     const controller=new AbortController();
     let timer;
     const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(new Error('MODEL_PROVIDER_TIMEOUT'));},timeoutMs);
     });
     const run=async()=>{
      // Identifiers and questions only: never disclose merchant-approved answers.
      const body=JSON.stringify({model,temperature:0,max_tokens:96,
       messages:[{role:'system',content:'Select a matching FAQ identifier only. Return a JSON object {"action":"ANSWER","faqId":"..."} or {"action":"HANDOVER"}. Never use tools, invent prices, make commitments or answer directly.'},
        {role:'user',content:JSON.stringify({question,candidates:candidates.map(c=>({faqId:c.faqId,question:c.question}))})}]});
      const response=await fetchImpl(target.href,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body,signal:controller.signal,redirect:'error'});
      if(!response?.ok)return {action:'HANDOVER'};
      const declared=Number(response.headers?.get?.('content-length'));
      if(Number.isFinite(declared)&&declared>8192)return {action:'HANDOVER'};
      let payload;
      if(response.body&&typeof response.body.getReader==='function'){
       if(!/^application\/json(?:\s*;|\s*$)/i.test(response.headers?.get?.('content-type')||''))return {action:'HANDOVER'};
       const reader=response.body.getReader();let size=0;const chunks=[];
       try{
        while(true){
         const {done,value}=await reader.read();if(done)break;
         size+=value.byteLength;
         if(size>8192){await reader.cancel().catch(()=>{});return {action:'HANDOVER'};}
         chunks.push(Buffer.from(value));
        }
        payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
       }finally{reader.releaseLock();}
      }else{
       // Legacy injected-test transport without a readable stream. Enforce a
       // post-parse size cap; native fetch always uses bounded streaming above.
       payload=await response.json();
       if(Buffer.byteLength(JSON.stringify(payload))>8192)return {action:'HANDOVER'};
      }
      const content=payload?.choices?.[0]?.message?.content;
      if(typeof content!=='string'||content.length>512)return {action:'HANDOVER'};
      const result=JSON.parse(content);
      if(!result||typeof result!=='object'||Array.isArray(result))return {action:'HANDOVER'};
      return result;
     };
     try{return await Promise.race([run(),timeout]);}
     catch{return {action:'HANDOVER'};}
     finally{clearTimeout(timer);}

    }
   }}).catch(()=>({...HANDOVER}));
  }
 });
}
