/**
 * Conservative normalization of Cloudflare's Workers source GET representation.
 * The multipart wire boundary and metadata part may change without script code
 * changing. Hash JS module *payloads* instead. Never persist/emit any source.
 * Unknown formats fail closed; stable digest is inventory proof, NOT approval.
 */
import {createHash} from 'node:crypto';
const deny=()=>{throw Error('MMF_CLOUDFLARE_SOURCE_DENIED')};
const hash=data=>createHash('sha256').update(data).digest('hex');
const VALID_NAME=/^(?:[A-Za-z0-9_-]{1,64}\/)*[A-Za-z0-9_.-]{1,128}$/;
const isJsMime=v=>/^(?:application|text)\/(?:javascript|ecmascript)(?:\+module)?(?:\s*;|\s*$)/i.test(v);
export async function canonicalCloudflareWorkerSource(response){
 try{
  if(!(response instanceof Response)||!response.ok)deny();
  const type=response.headers.get('content-type')||'';
  const size=response.headers.get('content-length');
  if(size!==null&&(!/^\d+$/.test(size)||Number(size)>2_000_000))deny();
  const raw=await response.text();
  if(Buffer.byteLength(raw)>2_000_000||raw.includes('\ufffd'))deny();
  let sourceText,sourceSha256,multipartNormalized=false;
  if(/^multipart\/form-data\s*;/i.test(type)){
   const b=type.match(/(?:^|;)\s*boundary=(?:"([^"\r\n]{1,70})"|([^;\s]{1,70}))(?:\s*;|\s*$)/i);
   const boundary=b?.[1]||b?.[2];
   if(!boundary||!/^[A-Za-z0-9_'()+,./:=?\-]{1,70}$/.test(boundary))deny();
   const chunks=raw.split('--'+boundary);
   if(chunks.length<3||chunks[0]!==''||!/^--\r?\n?$/.test(chunks.at(-1))||chunks.length>36)deny();
   const scripts=new Map();let meta=0;
   for(const rawPart of chunks.slice(1,-1)){
    if(!rawPart.startsWith('\r\n')||!rawPart.endsWith('\r\n'))deny();
    const part=rawPart.slice(2,-2),sep=part.indexOf('\r\n\r\n');
    if(sep<=0||sep>3000)deny();
    const head=part.slice(0,sep),body=part.slice(sep+4);
    const hs=head.split('\r\n');if(hs.length<1||hs.length>10||hs.some(x=>x.length>500))deny();
    const disposition=hs.find(x=>/^content-disposition\s*:/i.test(x));
    if(!disposition||hs.filter(x=>/^content-disposition\s*:/i.test(x)).length!==1)deny();
    const name=disposition.match(/(?:^|;)\s*name="([^"]{1,128})"(?:;|$)/i)?.[1];
    if(!name||!VALID_NAME.test(name))deny();
    const contentType=hs.find(x=>/^content-type\s*:/i.test(x))?.replace(/^content-type\s*:\s*/i,'')||'';
    if(name==='metadata'){
     if(++meta!==1||body.length>30000||!/^(?:application\/json|text\/plain)(?:\s*;|\s*$)/i.test(contentType))deny();
     continue;
    }
    if(scripts.has(name)||!/^(?:[A-Za-z0-9_./-]+\.(?:m?js|cjs)|script)$/.test(name)||!isJsMime(contentType)||body.length===0)deny();
    scripts.set(name,body);
   }
   if(!scripts.size||meta!==1)deny();
   const entries=[...scripts].sort(([a],[b])=>a.localeCompare(b));
   sourceText=entries.map(([,body])=>body).join('\n');
   sourceSha256=hash(JSON.stringify(entries));multipartNormalized=true;
  }else{
   if(!/^(?:application\/(?:javascript|octet-stream)|text\/(?:plain|javascript))(?:\s*;|\s*$)/i.test(type))deny();
   sourceText=raw;sourceSha256=hash(raw);
  }
  if(sourceText.length<100||Buffer.byteLength(sourceText)>2_000_000)deny();
  return Object.freeze({sourceText,sourceSha256,multipartNormalized});
 }catch{deny()}
}
