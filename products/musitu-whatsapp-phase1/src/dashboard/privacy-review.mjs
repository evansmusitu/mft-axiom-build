/** Keys remain in the owner tab until saved; never use browser storage or logs. */
const TENANT='986eb904-7296-46a9-9e9b-94074db9b547';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES=2*1024*1024;

export async function requestConversationPrivacyReview({tenantId,conversationId,fetchImpl=fetch,cryptoImpl=globalThis.crypto,signal,timeoutMs=15000}={}){
 let timer,reader;const key=new Uint8Array(32),controller=new AbortController();
 const abort=()=>controller.abort();
 try{
  if(tenantId!==TENANT||typeof conversationId!=='string'||!UUID.test(conversationId)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000||signal?.aborted)throw Error();
  signal?.addEventListener('abort',abort,{once:true});
  cryptoImpl.getRandomValues(key);const requestId=cryptoImpl.randomUUID();
  const exportKey=btoa(String.fromCharCode(...key));
  const work=async()=>{
   const response=await fetchImpl(`/api/tenants/${encodeURIComponent(tenantId)}/conversations/${encodeURIComponent(conversationId)}/privacy-review-export`,{
    method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,
    body:JSON.stringify({requestId,approveReview:true,exportKey})});
   if(!response.ok||response.redirected||response.headers.get('content-type')!=='application/octet-stream'||!response.body)throw Error();
   const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))throw Error();
   const expected=response.headers.get('x-musitu-export-sha256');if(!/^[a-f0-9]{64}$/.test(expected??''))throw Error();
   reader=response.body.getReader();const chunks=[];let length=0;
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES)throw Error();chunks.push(value);}
   if(!length||(declared!==null&&Number(declared)!==length))throw Error();
   const encrypted=new Uint8Array(length);let offset=0;for(const chunk of chunks){encrypted.set(chunk,offset);offset+=chunk.length;}
   const actual=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',encrypted)),x=>x.toString(16).padStart(2,'0')).join('');
   if(actual!==expected||controller.signal.aborted)throw Error();
   return{encrypted,requestId,keyFile:{version:1,purpose:'SINGLE_CONVERSATION_OPERATOR_REVIEW',tenantId,conversationId,requestId,
    exportKeyBase64:exportKey,ciphertextSha256:actual,deliveredToDataSubject:false,erased:false}};
  };
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},timeoutMs);controller.signal.addEventListener('abort',()=>reject(Error()),{once:true});});
  return await Promise.race([work(),deadline]);
 }catch{throw Error('PRIVACY_REVIEW_DOWNLOAD_FAILED');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();key.fill(0);reader?.cancel().catch(()=>{});}
}
