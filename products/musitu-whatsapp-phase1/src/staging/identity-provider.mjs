/** Real provider transport. Tests inject HTTP at the network boundary only. */
import {createRemoteJWKSet,jwtVerify,customFetch} from 'jose';
import {assertActiveIntrospection,assertProviderDiscovery,providerClientRequest,ZITADEL_MAX_AUTH_AGE_SECONDS} from './identity-policy.mjs';
export async function identityJson(url,options={},request=globalThis.fetch,timeoutMs=5000){
 const controller=new AbortController();let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('IDENTITY_PROVIDER_TIMEOUT'));},timeoutMs);});
 const work=async()=>{
  const response=await request(url,{...options,redirect:'error',cache:'no-store',credentials:'omit',signal:controller.signal});
  if(response?.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw Error('IDENTITY_PROVIDER_UNAVAILABLE');
  if(Number(response.headers.get('content-length')||0)>65536||!response.body?.getReader)throw Error('IDENTITY_RESPONSE_LIMIT');
  const reader=response.body.getReader();let size=0,parts=[];
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('IDENTITY_RESPONSE_LIMIT');parts.push(Buffer.from(value));}}
  finally{void reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
 };
 try{return await Promise.race([work(),deadline]);}finally{clearTimeout(timer);}
}
export function createIdentityProvider(cfg,{request=globalThis.fetch}={}){
 // No URL from a JWT, request body or discovery response ever selects the JWKS.
 const keys=createRemoteJWKSet(new URL(cfg.endpoints.jwks),{timeoutDuration:3000,cooldownDuration:30000,cacheMaxAge:300000,
  [customFetch]:async(url,options)=>Response.json(await identityJson(url,{...options,method:'GET'},request,3000))});
 const service={
  async qualifyDiscovery(){
   const info=await identityJson(cfg.issuer+'/.well-known/openid-configuration',{},request);
   assertProviderDiscovery(info,cfg);
  },
  async exchange(code,verifier){
   return identityJson(cfg.endpoints.token,providerClientRequest(cfg,'token',{grant_type:'authorization_code',code,redirect_uri:cfg.origin+'/auth/callback',code_verifier:verifier}),request);
  },
  async verifyAccess(accessToken){
   const {payload}=await jwtVerify(accessToken,keys,{issuer:cfg.issuer,audience:cfg.audience,algorithms:['RS256'],maxTokenAge:'10m',requiredClaims:['sub','iat','exp']});
   if(typeof payload.sub!=='string'||!payload.sub)throw Error('TOKEN_SUBJECT_REJECTED');
   // ZITADEL may use the signed OAuth client_id instead of OIDC azp. Every
   // supplied identifier must match; a matching claim cannot hide a conflict.
   const clients=cfg.provider==='zitadel'?[payload.azp,payload.client_id].filter(value=>value!==undefined):[payload.azp];
   if(!clients.length||clients.some(value=>value!==cfg.client))throw Error('TOKEN_CLIENT_REJECTED');
   // Every request rechecks revocation online; an unavailable provider denies access.
   const info=await identityJson(cfg.endpoints.introspection,providerClientRequest(cfg,'introspection',{token:accessToken}),request);
   assertActiveIntrospection(info,payload,cfg);
   return payload;
  },
  async verifyId(idToken,flow,accessClaims){
   const {payload}=await jwtVerify(idToken,keys,{issuer:cfg.issuer,audience:cfg.client,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce']});
   if(payload.nonce!==flow.nonce||payload.sub!==accessClaims.sub||(payload.azp!==undefined&&payload.azp!==cfg.client))throw Error('OIDC_NONCE_OR_SUBJECT_REJECTED');
   if(cfg.provider==='zitadel'){
    // Authentication proof is accepted only from the verified ID token; access
    // tokens, introspection, browser fields and general admin roles cannot supply it.
    if(!Array.isArray(payload.amr)||!payload.amr.every(method=>typeof method==='string'&&method.length>0)||!payload.amr.includes('mfa'))throw Error('OIDC_MFA_REQUIRED');
    const now=Math.floor(Date.now()/1000);
    if(!Number.isSafeInteger(payload.auth_time)||payload.auth_time<=0||!Number.isSafeInteger(payload.iat)||payload.iat>now||payload.auth_time>payload.iat||now-payload.auth_time>ZITADEL_MAX_AUTH_AGE_SECONDS)throw Error('OIDC_AUTH_TIME_REJECTED');
   }
   return payload;
  },
  async verifySession(session){
   // Older/restored access-token-only ZITADEL sessions must sign in again.
   if(cfg.provider==='zitadel'&&(!session||typeof session.idToken!=='string'||!session.idToken||typeof session.nonce!=='string'||!session.nonce))throw Error('SESSION_MFA_REQUIRED');
   const claims=await service.verifyAccess(session?.accessToken);
   if(cfg.provider==='zitadel')await service.verifyId(session.idToken,{nonce:session.nonce},claims);
   return claims;
  }
 };
 return Object.freeze(service);
}
