// Shared bounded transport contract; no authority, credential store or activation.
export const handoffFormContentType=request=>/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(request.headers.get('content-type')||'');
export async function readHandoffText(message,limit=8192){
 if(!message.body?.getReader)throw Error('handoff_body_denied');const reader=message.body.getReader(),chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>limit){await reader.cancel();throw Error('handoff_body_denied');}chunks.push(value);}}
 finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function readHandoffForm(request){
 if(!handoffFormContentType(request))throw Error('handoff_body_denied');return new URLSearchParams(await readHandoffText(request));
}
