/** Bounded streamed body with a wall-clock deadline, regardless of Content-Length. */
export async function readBoundedJson(req,{maxBytes=4096,timeoutMs=3000}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('BODY_CONFIG_REJECTED');
 if(req.headers.get('content-type')!=='application/json')throw Error('BODY_MEDIA_REJECTED');
 const declared=req.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw Error('BODY_TOO_LARGE');
 if(!req.body)throw Error('BODY_REQUIRED');
 const reader=req.body.getReader();let timer,size=0;const parts=[];
 const run=async()=>{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('BODY_TOO_LARGE');parts.push(Buffer.from(value));}let v;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{throw Error('INVALID_JSON');}if(!v||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_INPUT');return v;};
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BODY_TIMEOUT')),timeoutMs);});
 try{return await Promise.race([run(),deadline]);}finally{clearTimeout(timer);reader.cancel().catch(()=>{});}
}
