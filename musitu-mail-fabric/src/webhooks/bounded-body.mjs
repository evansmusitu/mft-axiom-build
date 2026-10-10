/**
 * Cloudflare-safe bounded JSON webhook input.
 * Never call request.text() on untrusted unbounded streams.
 * Returns a redacted status/error rather than logging signed bodies.
 */
export async function readBoundedWebhookBody(request,{maxBytes=65536,requireJsonMime=true}={}){
 const mime=request?.headers?.get('content-type')||'';
 if(requireJsonMime&&!/^application\/json(?:\s*;|$)/i.test(mime))
  return {error:'UNSUPPORTED_MEDIA_TYPE',status:415};
 const declared=request.headers.get('content-length');
 if(declared!==null){
  if(!/^[0-9]{1,16}$/.test(declared))
   return {error:'INVALID_CONTENT_LENGTH',status:400};
  if(Number(declared)>maxBytes)return {error:'PAYLOAD_TOO_LARGE',status:413};
 }
 if(!request.body?.getReader)return {error:'INVALID_JSON',status:400};
 let chunks=[],total=0;
 const reader=request.body.getReader();
 try{
  for(;;){
   const {value,done}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))return {error:'INVALID_JSON',status:400};
   total+=value.byteLength;
   if(total>maxBytes){
    await reader.cancel().catch(()=>{});
    return {error:'PAYLOAD_TOO_LARGE',status:413};
   }
   chunks.push(value);
  }
 }catch{return {error:'INVALID_JSON',status:400};}
 finally{try{reader.releaseLock();}catch{}}
 if(total===0)return {error:'INVALID_JSON',status:400};
 let raw;
 try{raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total));}
 catch{return {error:'INVALID_UTF8',status:400};}
 if(!raw)return {error:'INVALID_JSON',status:400};
 return {raw};
}
