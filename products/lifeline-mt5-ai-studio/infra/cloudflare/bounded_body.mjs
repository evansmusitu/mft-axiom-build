/** Fail-closed, bounded request reader. Cloudflare Request.text() buffers an
 * untrusted stream before any later size check; enforce limits while reading.
 * UTF-8 validity and byte count are checked before parsing or forwarding.
 */
export async function readBoundedUtf8(request,maxBytes=65536){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>65536)
    throw Error('invalid_request_limit');
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d{1,15}$/.test(declared)||Number(declared)>maxBytes))
    return {status:'oversized'};
  if(!request.body)return {status:'ok',text:''};
  let reader;
  try{reader=request.body.getReader();}
  catch{return {status:'invalid'};}
  const chunks=[];
  let length=0;
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array)){
        void reader.cancel().catch(()=>{});
        return {status:'invalid'};
      }
      if(value.byteLength>maxBytes-length){
        void reader.cancel().catch(()=>{});
        return {status:'oversized'};
      }
      length+=value.byteLength;
      chunks.push(value);
    }
  }catch{return {status:'invalid'};}
  finally{reader.releaseLock();}
  const payload=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks){payload.set(chunk,offset);offset+=chunk.byteLength;}
  try{return {status:'ok',text:new TextDecoder('utf-8',{fatal:true}).decode(payload)};}
  catch{return {status:'invalid'};}
}
