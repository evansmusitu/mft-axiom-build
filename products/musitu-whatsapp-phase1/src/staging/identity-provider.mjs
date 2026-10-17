/** Real provider transport. Tests inject HTTP at the network boundary only. */
import {createRemoteJWKSet,jwtVerify,customFetch} from 'jose';
import {assertActiveIntrospection,assertProviderDiscovery,providerClientRequest} from './identity-policy.mjs';
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
 return Object.freeze({
  async qualifyDiscovery(){
   const info=await identityJson(cfg.issuer+'/.well-known/openid-configuration',{},request);
   assertProviderDiscovery(info,cfg);
  },
  async exchange(code,verifier){
   return identityJson(cfg.endpoints.token,providerClientRequest(cfg,'token',{grant_type:'authorization_code',code,redirect_uri:cfg.origin+'/auth/callback',code_verifier:verifier}),request);
  },
  async verifyAccess(accessToken){
   const {payload}=await jwtVerify(accessToken,keys,{issuer:cfg.issuer,audience:cfg.audience,algorithms:['RS256'],maxTokenAge:'10m',requiredClaims:['sub','iat','exp']});
   if(typeof payload.sub!=='string'||!payload.sub||payload.azp!==cfg.client)throw Error('TOKEN_CLIENT_REJECTED');
   // Every request rechecks revocation online; an unavailable provider denies access.
   const info=await identityJson(cfg.endpoints.introspection,providerClientRequest(cfg,'introspection',{token:accessToken}),request);
   assertActiveIntrospection(info,payload,cfg);
   return payload;
  },
  async verifyId(idToken,flow,accessClaims){
   const {payload}=await jwtVerify(idToken,keys,{issuer:cfg.issuer,audience:cfg.client,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce']});
   if(payload.nonce!==flow.nonce||payload.sub!==accessClaims.sub||(payload.azp!==undefined&&payload.azp!==cfg.client))throw Error('OIDC_NONCE_OR_SUBJECT_REJECTED');
   return payload;
  }
 });
}
