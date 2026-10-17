/** Explicit provider configuration. Provider metadata never chooses network destinations. */
export function identityConfig(env){
 const issuer=env.OIDC_ISSUER,client=env.OIDC_CLIENT_ID,secret=env.OIDC_CLIENT_SECRET,origin=env.APP_ORIGIN;
 if(!issuer||!client||!secret||!origin)throw Error('IDENTITY_NOT_CONFIGURED');
 const provider=env.OIDC_PROVIDER||'keycloak';
 let u,o;try{u=new URL(issuer);o=new URL(origin);}catch{throw Error('IDENTITY_CONFIGURATION_REJECTED');}
 if(u.protocol!=='https:'||u.search||u.hash||u.username||u.password||o.protocol!=='https:'||o.origin!==origin||o.username||o.password)throw Error('IDENTITY_CONFIGURATION_REJECTED');
 let endpoints,introspectionClient=client,introspectionSecret=secret,audience=env.OIDC_AUDIENCE||client;
 if(provider==='keycloak'){
  if(!/^\/realms\/[A-Za-z0-9._-]+$/.test(u.pathname)||u.origin+u.pathname!==issuer)throw Error('IDENTITY_CONFIGURATION_REJECTED');
  const base=issuer+'/protocol/openid-connect/';
  endpoints={authorization:base+'auth',token:base+'token',introspection:base+'token/introspect',jwks:base+'certs',logout:base+'logout'};
 }else if(provider==='zitadel'){
  // Only operator-pinned generated ZITADEL Cloud instance origins are supported.
  // Custom domains require separate review; no user-controlled discovery endpoints.
  if(issuer!==u.origin||u.port||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.zitadel\.cloud$/.test(u.hostname))throw Error('IDENTITY_CONFIGURATION_REJECTED');
  introspectionClient=env.OIDC_INTROSPECTION_CLIENT_ID;introspectionSecret=env.OIDC_INTROSPECTION_CLIENT_SECRET;
  if(!introspectionClient||!introspectionSecret||!env.OIDC_AUDIENCE||audience!==introspectionClient)throw Error('IDENTITY_INTROSPECTION_NOT_CONFIGURED');
  endpoints={authorization:issuer+'/oauth/v2/authorize',token:issuer+'/oauth/v2/token',introspection:issuer+'/oauth/v2/introspect',jwks:issuer+'/oauth/v2/keys',logout:issuer+'/oidc/v1/end_session'};
 }else throw Error('IDENTITY_PROVIDER_REJECTED');
 return {provider,issuer,client,secret,origin,audience,introspectionClient,introspectionSecret,endpoints};
}
const hasAudience=(audience,expected)=>audience===expected||(Array.isArray(audience)&&audience.every(a=>typeof a==='string')&&audience.includes(expected));
export function assertActiveIntrospection(info,claims,cfg,now=Math.floor(Date.now()/1000)){
 if(!info||info.active!==true||info.sub!==claims.sub||!Number.isSafeInteger(info.exp)||info.exp!==claims.exp||info.exp<=now||
  (info.client_id!==undefined&&info.client_id!==cfg.client)||(info.iss!==undefined&&info.iss!==cfg.issuer)||
  (cfg.provider==='zitadel'&&(info.client_id!==cfg.client||info.iss!==cfg.issuer||!hasAudience(info.aud,cfg.audience))))throw Error('SESSION_REVOKED');
}
export function providerClientRequest(cfg,purpose,parameters){
 if(!['token','introspection'].includes(purpose))throw Error('IDENTITY_REQUEST_REJECTED');
 const headers={'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body=new URLSearchParams(parameters);
 if(cfg.provider==='zitadel'){
  const client=purpose==='introspection'?cfg.introspectionClient:cfg.client,secret=purpose==='introspection'?cfg.introspectionSecret:cfg.secret;
  // RFC 6749 section 2.3.1: form-encode each credential before joining with ':'.
  const encode=value=>new URLSearchParams({v:value}).toString().slice(2);
  headers.authorization='Basic '+Buffer.from(encode(client)+':'+encode(secret)).toString('base64');
 }else{body.set('client_id',cfg.client);body.set('client_secret',cfg.secret);}
 return {method:'POST',headers,body};
}
export function assertProviderDiscovery(info,cfg){
 const pinned={issuer:cfg.issuer,authorization_endpoint:cfg.endpoints.authorization,token_endpoint:cfg.endpoints.token,introspection_endpoint:cfg.endpoints.introspection,jwks_uri:cfg.endpoints.jwks,end_session_endpoint:cfg.endpoints.logout};
 if(!info||Object.entries(pinned).some(([k,v])=>info[k]!==v)||
  ![['id_token_signing_alg_values_supported','RS256'],['code_challenge_methods_supported','S256'],['response_types_supported','code']].every(([key,value])=>Array.isArray(info[key])&&info[key].includes(value))||
  (cfg.provider==='zitadel'&&(!Array.isArray(info.token_endpoint_auth_methods_supported)||!info.token_endpoint_auth_methods_supported.includes('client_secret_basic'))))throw Error('OIDC_DISCOVERY_REJECTED');
}
export function assertIdentityFlow(flow,purpose,state){
 if(!flow||flow.purpose!==purpose||typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state)||flow.state!==state)throw Error('OIDC_STATE_REJECTED');
}
/** Standard RP-initiated logout. No access/refresh/ID token is put in a URL. */
export function providerLogoutUrl(cfg,state){
 if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw Error('OIDC_STATE_REJECTED');
 const url=new URL(cfg.endpoints.logout);
 url.search=new URLSearchParams({client_id:cfg.client,post_logout_redirect_uri:cfg.origin+'/auth/logged-out',state}).toString();
 return url.href;
}
