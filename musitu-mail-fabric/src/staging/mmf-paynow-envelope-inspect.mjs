/** No source or secret logging: one GET to inspect only the MIME structure of an existing Worker. */
const account='93f395f5121954671f92fffa453d6b61';
const worker='mft-phase8-external-authority';
if(process.env.GITHUB_REF_NAME!=='product/musitu-mail-fabric-isolated-20261009'||
  process.env.CLOUDFLARE_ACCOUNT_ID!==account||
  typeof process.env.CLOUDFLARE_API_TOKEN!=='string'||
  process.env.CLOUDFLARE_API_TOKEN.length<20)process.exit(2);
const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`,{
 method:'GET',headers:{authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(15000)});
if(!r.ok)process.exit(2);
const ct=r.headers.get('content-type')||'';
const type=ct.split(';')[0].trim().toLowerCase();
const source=await r.text();if(source.length>2_000_000)process.exit(2);
const b=ct.match(/(?:^|;)\s*boundary=(?:"([^"\r\n]{1,70})"|([^;\s]{1,70}))(?:\s*;|\s*$)/i);
const boundary=b?.[1]||b?.[2];
const parts=boundary?source.split('--'+boundary).slice(1,-1):[];
// No module names, source, raw MIME headers or object IDs leave the runner.
const counts={metadata:0,named:0,jsMime:0,contentDisposition:0,filename:0,otherMime:0};
for(const part of parts){const head=part.split('\r\n\r\n')[0]||'';
 counts.metadata+=Number(/name=["']metadata["']/.test(head));
 counts.named+=Number(/\bname=/.test(head));
 counts.filename+=Number(/\bfilename=/.test(head));
 counts.jsMime+=Number(/(?:application|text)\/(?:javascript|ecmascript)/i.test(head));
 counts.contentDisposition+=Number(/content-disposition/i.test(head));
 counts.otherMime+=Number(/content-type/i.test(head)&&!/(?:application|text)\/(?:javascript|ecmascript)/i.test(head));
}
console.log(JSON.stringify({gate:'MMF_CLOUDFLARE_SOURCE_ENVELOPE_GET_ONLY',safe:true,
 mimeClass:type,bodyLengthClass:source.length<100?'short':source.length<100000?'medium':'large',
 boundaryPresent:Boolean(boundary),partCount:parts.length,parts:counts,
 paymentInitiation:false,merchantSourceLogged:false,merchantSecretLogged:false,cloudflareMutations:false}));
