import {createDevelopmentMetaHandler} from '../runtime/src/adapters/meta-development-http.mjs';
import {developmentIngress} from '../runtime/src/staging/meta-ingress.mjs';

const handler=createDevelopmentMetaHandler({getIngress:developmentIngress,getVerifyToken:()=>process.env.META_VERIFY_TOKEN});
const securityHeaders={
 'cache-control':'no-store','content-type':'text/plain; charset=utf-8',
 'x-content-type-options':'nosniff','x-frame-options':'DENY',
 'referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow, noarchive',
 'content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
 'strict-transport-security':'max-age=31536000'
};
export default {
 async fetch(request){
  // All hosting paths are rewritten here. Never serve a dashboard, source,
  // configuration, health database details or an outbound operation.
  if(new URL(request.url).pathname!=='/api/meta/webhook')return new Response('NOT_FOUND',{status:404,headers:securityHeaders});
  const result=await handler(request);
  for(const [key,value] of Object.entries(securityHeaders))result.headers.set(key,value);
  const query=new URL(request.url).searchParams;
  // Fixed-size operational metadata only: no URL, token, signature, sender,
  // message content, IP address or caller-controlled query-key text is logged.
  console.log(JSON.stringify({event:'MUSITU_META_CALLBACK_HTTP',method:['GET','POST'].includes(request.method)?request.method:'OTHER',status:result.status,queryCount:query.size,modeKeyCount:query.getAll('hub.mode').length,tokenKeyCount:query.getAll('hub.verify_token').length,challengeKeyCount:query.getAll('hub.challenge').length}));
  return result;
 }
};
