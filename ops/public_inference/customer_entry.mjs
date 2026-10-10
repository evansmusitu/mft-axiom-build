/**
 * Candidate external-customer trust boundary, NOT a public release endpoint.
 * Delegates to existing gateway ONLY after independently signed inference-only
 * user identity matches a separately issued exact-request S2 capability.
 * Production requires independent issuer/JWKS, revocation, data consent, security
 * approval and S4 release; this module does not provide or certify them.
 */
import { verifyExternalInferenceIdentity } from './inference_identity.mjs';
import { authorizeRequest } from './signed_capability.mjs';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const denied=(code,status)=>new Response(JSON.stringify({error:{code}}),{status,headers:HEADERS});
export function createCustomerEntry({delegate,now=()=>Date.now()}={}) {
  if(!delegate||typeof delegate.fetch!=='function'||typeof now!=='function')throw Error('IDENTITY_GATE_REQUIRES_EXPLICIT_DELEGATE');
  return {
    async fetch(request,env){
      let url;
      try{url=new URL(request.url)}catch{return denied('NOT_FOUND',404)}
      if(request.method==='GET'&&url.pathname==='/healthz')return new Response(
        JSON.stringify({state:'DISABLED_UNTIL_INDEPENDENT_S4_RELEASE',live_customer_identity:'NOT_PROVEN'}),
        {status:200,headers:HEADERS});
      if(url.pathname!=='/v1/chat/completions'||url.search)return denied('NOT_FOUND',404);
      if(request.method!=='POST')return denied('METHOD_NOT_ALLOWED',405);
      if(!env||typeof env!=='object'||!env.AXIOM_INFERENCE_IDP_POLICY||
         typeof env.AXIOM_CAPABILITY_HMAC_KEY!=='string')return denied('INDEPENDENT_IDENTITY_NOT_CONFIGURED',503);
      const auth=request.headers.get('authorization');
      if(typeof auth!=='string'||auth.length>4105||!/^Bearer ([A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+$/.test(auth))
        return denied('INFERENCE_IDENTITY_DENIED',403);
      if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||'')||
          request.headers.has('content-encoding'))return denied('REQUEST_CONTENT_TYPE_DENIED',415);
      let raw;
      try{
        const body=request.clone().body;
        if(!body)throw Error('EMPTY_BODY');
        const reader=body.getReader();let count=0;const chunks=[];
        while(true){
          const {done,value}=await reader.read();if(done)break;
          count+=value.byteLength;
          if(count>5000){await reader.cancel().catch(()=>{});return denied('BOUNDED_INPUT_REQUIRED',413)}
          chunks.push(value);
        }
        const buffer=new Uint8Array(count);let i=0;
        for(const chunk of chunks){buffer.set(chunk,i);i+=chunk.byteLength}
        raw=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
      }catch{return denied('INVALID_REQUEST',400)}
      try{
        const identity=await verifyExternalInferenceIdentity(auth.slice(7),env.AXIOM_INFERENCE_IDP_POLICY,Math.floor(now()/1000));
        const capability=await authorizeRequest(request.headers,env.AXIOM_CAPABILITY_HMAC_KEY,raw,now());
        if(identity.subject!==capability.subject||identity.project!==capability.project||
            identity.inference_scope_verified!==true||
            capability.consent!==true||capability.classification!=='EXTERNAL_PROVIDER_APPROVED')throw Error('SCOPE_DENIED');
      }catch{return denied('IDENTITY_OR_CAPABILITY_DENIED',403)}
      try{return await delegate.fetch(request,env)}
      catch{return denied('DELEGATED_SERVICE_UNAVAILABLE',503)}
    }
  };
}
