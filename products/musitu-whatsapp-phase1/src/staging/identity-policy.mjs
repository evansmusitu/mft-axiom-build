/** Configuration and online-token policy shared by the real staging identity path. */
export function identityConfig(env){
 const issuer=env.OIDC_ISSUER,client=env.OIDC_CLIENT_ID,secret=env.OIDC_CLIENT_SECRET,origin=env.APP_ORIGIN;
 if(!issuer||!client||!secret||!origin)throw Error('IDENTITY_NOT_CONFIGURED');
 const u=new URL(issuer),o=new URL(origin);
 if(u.protocol!=='https:'||u.search||u.hash||u.username||u.password||!/^\/realms\/[^/]+$/.test(u.pathname)||o.protocol!=='https:'||o.origin!==origin)throw Error('IDENTITY_CONFIGURATION_REJECTED');
 return {issuer,client,secret,origin,audience:env.OIDC_AUDIENCE||client};
}
export function assertActiveIntrospection(info,claims,cfg,now=Math.floor(Date.now()/1000)){
 if(!info||info.active!==true||info.sub!==claims.sub||!Number.isSafeInteger(info.exp)||info.exp!==claims.exp||info.exp<=now||
  (info.client_id!==undefined&&info.client_id!==cfg.client)||(info.iss!==undefined&&info.iss!==cfg.issuer))throw Error('SESSION_REVOKED');
}
export function assertIdentityFlow(flow,purpose,state){
 if(!flow||flow.purpose!==purpose||typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state)||flow.state!==state)throw Error('OIDC_STATE_REJECTED');
}
/** Standard RP-initiated logout. No access/refresh/ID token is put in a URL. */
export function providerLogoutUrl(cfg,state){
 if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw Error('OIDC_STATE_REJECTED');
 const url=new URL(cfg.issuer+'/protocol/openid-connect/logout');
 url.search=new URLSearchParams({client_id:cfg.client,post_logout_redirect_uri:cfg.origin+'/auth/logged-out',state}).toString();
 return url.href;
}
