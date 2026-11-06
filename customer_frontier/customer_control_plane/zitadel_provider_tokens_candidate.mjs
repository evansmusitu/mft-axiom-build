// Private provider-token verification candidate. Unmounted; NOT a session broker.
// Caller must separately consume durable state/nonce/PKCE, authorize canonical
// ownership, persist/revoke a secure session and qualify the private bindings.
export const ZITADEL_STAGING=Object.freeze({
 issuer:'https://musitu-whatsapp-staging-mpqgsc.eu1.zitadel.cloud',
 organization_id:'397931885717636395',project_id:'397932045671643204',
 application_id:'398295489964985900',client_id:'398295490183089708',
 jwks_uri:'https://musitu-whatsapp-staging-mpqgsc.eu1.zitadel.cloud/oauth/v2/keys',
 userinfo_endpoint:'https://musitu-whatsapp-staging-mpqgsc.eu1.zitadel.cloud/oidc/v1/userinfo',
 redirect_uri:'https://axiom-customer-staging.mftintelligence.com/auth/callback'
});
const fail=code=>{throw new Error(code);};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const b64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(value,code='idp_token_invalid'){
 if(!text(value,65536)||!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)fail(code);
 let bytes;try{bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}catch{fail(code);}
 if(b64(bytes)!==value)fail(code);
 return bytes;
}
export function parseIdentityJson(raw){
 let result;try{result=JSON.parse(raw);}catch{fail('idp_json_invalid');}
 // JSON.parse alone accepts duplicate members. Scan valid JSON tokens while
 // preserving escaped key identity; no regex normalization of claim values.
 const tokens=raw.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)||[];
 const stack=[];
 for(const token of tokens){
  if(token==='{'||token==='['){stack.push({object:token==='{',key:true,keys:new Set()});if(stack.length>16)fail('idp_json_invalid');}
  else if(token==='}'||token===']')stack.pop();
  else if(token===','&&stack.at(-1)?.object)stack.at(-1).key=true;
  else if(token.startsWith('"')&&stack.at(-1)?.object&&stack.at(-1).key){
   const frame=stack.at(-1),key=JSON.parse(token);if(frame.keys.has(key))fail('idp_json_invalid');frame.keys.add(key);frame.key=false;
  }
 }
 return result;
}
function tokenJson(encoded){
 let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(decode(encoded));}catch(e){if(e.message==='idp_token_invalid')throw e;fail('idp_json_invalid');}
 return parseIdentityJson(raw);
}
async function providerJson(url,{fetcher,accessToken,form}={}){
 let response;
 try{response=await fetcher(new Request(url,{method:form?'POST':'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(5000),
  headers:{accept:'application/json',...(accessToken?{authorization:'Bearer '+accessToken}:{}),...(form?{'content-type':'application/x-www-form-urlencoded'}:{})},...(form?{body:form}:{})}));}catch{fail('idp_provider_unavailable');}
 if(response?.status!==200||!response.body?.getReader)fail('idp_provider_unavailable');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536){await reader.cancel();fail('idp_provider_response_invalid');}chunks.push(value);}
 }catch(e){if(e.message==='idp_provider_response_invalid')throw e;fail('idp_provider_unavailable');}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('idp_json_invalid');}
 return parseIdentityJson(raw);
}
export async function exchangeZitadelAuthorizationCode({code,code_verifier}={}, {fetcher=globalThis.fetch}={}){
 if(!text(code,2048)||!/^[A-Za-z0-9._~+/-]+={0,2}$/.test(code)||typeof code_verifier!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(code_verifier)||typeof fetcher!=='function')fail('idp_code_invalid');
 const form=new URLSearchParams({grant_type:'authorization_code',client_id:ZITADEL_STAGING.client_id,
  redirect_uri:ZITADEL_STAGING.redirect_uri,code,code_verifier});
 const response=await providerJson(ZITADEL_STAGING.issuer+'/oauth/v2/token',{fetcher,form});
 if(!record(response)||!text(response.id_token,32768)||!text(response.access_token,8192)||response.token_type!=='Bearer')fail('idp_token_response_invalid');
 return {id_token:response.id_token,access_token:response.access_token};
}
function signingKey(jwks,kid){
 if(!record(jwks)||!Array.isArray(jwks.keys)||jwks.keys.length<1||jwks.keys.length>32)fail('idp_key_invalid');
 const candidates=jwks.keys.filter(k=>record(k)&&k.kid===kid);if(candidates.length!==1)fail('idp_key_invalid');
 const k=candidates[0];
 if(k.kty!=='RSA'||(k.alg!==undefined&&k.alg!=='RS256')||(k.use!==undefined&&k.use!=='sig')||
  (k.key_ops!==undefined&&(!Array.isArray(k.key_ops)||k.key_ops.length!==1||k.key_ops[0]!=='verify'))||
  ['d','p','q','dp','dq','qi','oth','k'].some(field=>Object.hasOwn(k,field))||k.e!=='AQAB')fail('idp_key_invalid');
 const modulus=decode(k.n,'idp_key_invalid');
 const bits=modulus.length?((modulus.length-1)*8+32-Math.clz32(modulus[0])):0;
 if(bits<2048||bits>8192||modulus[0]===0)fail('idp_key_invalid');
 return {kty:'RSA',n:k.n,e:k.e,alg:'RS256',ext:true,key_ops:['verify']};
}
function validateClaims(p,{nonce,now}){
 const issuer=ZITADEL_STAGING.issuer,client=ZITADEL_STAGING.client_id;
 const aud=typeof p?.aud==='string'?[p.aud]:p?.aud;
 if(!record(p)||p.iss!==issuer||!text(p.sub,240)||!Array.isArray(aud)||aud.length<1||aud.length>16||
  aud.some(a=>!text(a,200))||new Set(aud).size!==aud.length||!aud.includes(client)||
  (aud.length>1&&p.azp!==client)||(p.azp!==undefined&&p.azp!==client)||p.nonce!==nonce)fail('idp_claims_invalid');
 const seconds=now/1000;
 const numeric=x=>Number.isSafeInteger(x)&&x>=0&&x<=Math.floor(Number.MAX_SAFE_INTEGER/1000);
 if(![p.iat,p.exp,p.auth_time].every(numeric)||p.exp<=seconds||p.exp<=p.iat||p.exp-p.iat>86400||
  p.iat>seconds+30||seconds-p.iat>120||p.auth_time>seconds+30||p.auth_time>p.iat||seconds-p.auth_time>300||
  (p.nbf!==undefined&&(!numeric(p.nbf)||p.nbf>seconds+30||p.nbf>=p.exp))||
  !Array.isArray(p.amr)||p.amr.length>16||p.amr.some(a=>!text(a,32))||new Set(p.amr).size!==p.amr.length||!p.amr.includes('mfa')||
  (p.email_verified!==undefined&&p.email_verified!==true))fail('idp_claims_invalid');
}
export async function verifyZitadelCodeTokens({id_token,access_token,expected_nonce}={}, {fetcher=globalThis.fetch,clock=Date.now}={}){
 const now=typeof clock==='function'?clock():NaN;
 if(!Number.isSafeInteger(now)||now<0||typeof fetcher!=='function'||!text(expected_nonce,128)||!/^[A-Za-z0-9_-]{32,128}$/.test(expected_nonce))fail('idp_context_invalid');
 if(!text(id_token,32768)||!text(access_token,8192)||!/^[A-Za-z0-9._~+/-]+={0,2}$/.test(access_token))fail('idp_token_invalid');
 const parts=id_token.split('.');if(parts.length!==3||parts.some(p=>!p))fail('idp_token_invalid');
 const header=tokenJson(parts[0]),payload=tokenJson(parts[1]),signature=decode(parts[2]);
 if(!record(header)||header.alg!=='RS256'||!text(header.kid,200)||
  (header.typ!==undefined&&header.typ!=='JWT')||Object.keys(header).some(k=>!['alg','kid','typ'].includes(k)))fail('idp_header_invalid');
 const jwks=await providerJson(ZITADEL_STAGING.jwks_uri,{fetcher});
 const jwk=signingKey(jwks,header.kid);let valid=false;
 try{const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,new TextEncoder().encode(parts[0]+'.'+parts[1]));}catch{fail('idp_signature_invalid');}
 if(!valid)fail('idp_signature_invalid');
 let lastTime=now;
 const currentTime=()=>{const value=clock();if(!Number.isSafeInteger(value)||value<lastTime)fail('idp_context_invalid');lastTime=value;return value;};
 validateClaims(payload,{nonce:expected_nonce,now:currentTime()});
 if(payload.at_hash!==undefined){
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(access_token)));
  if(payload.at_hash!==b64(hash.slice(0,16)))fail('idp_claims_invalid');
 }
 // ZITADEL code-flow ID tokens need not include email claims. Fetch UserInfo
 // using only the pinned provider and require its subject to match the signed ID.
 const userinfo=await providerJson(ZITADEL_STAGING.userinfo_endpoint,{fetcher,accessToken:access_token});
 if(!record(userinfo)||userinfo.sub!==payload.sub||userinfo.email_verified!==true||!text(userinfo.email,254)||
  !userinfo.email.includes('@'))fail('idp_userinfo_invalid');
 validateClaims(payload,{nonce:expected_nonce,now:currentTime()});
 // Never copy tenant/customer UUID, roles, raw token or email into authority.
 return {issuer:payload.iss,subject:payload.sub,email_verified:true,mfa_verified:true,
  auth_time_ms:payload.auth_time*1000,issued_at_ms:payload.iat*1000,token_expires_at_ms:payload.exp*1000,
  provider_signature_verified:true,signing_key_id:header.kid};
}
