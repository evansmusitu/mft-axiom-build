import test from 'node:test';
import assert from 'node:assert/strict';
import {identityConfig,assertActiveIntrospection,providerLogoutUrl,providerClientRequest,assertProviderDiscovery} from '../src/staging/identity-policy.mjs';
const env={OIDC_PROVIDER:'zitadel',OIDC_ISSUER:'https://musitu-synthetic.zitadel.cloud',OIDC_CLIENT_ID:'web-synthetic',OIDC_CLIENT_SECRET:'synthetic-web-secret',OIDC_AUDIENCE:'api-synthetic',OIDC_INTROSPECTION_CLIENT_ID:'api-synthetic',OIDC_INTROSPECTION_CLIENT_SECRET:'synthetic-api-secret',APP_ORIGIN:'https://app.example.invalid'};
const cfg=()=>identityConfig(env);
function discovery(c){return {issuer:c.issuer,authorization_endpoint:c.endpoints.authorization,token_endpoint:c.endpoints.token,introspection_endpoint:c.endpoints.introspection,jwks_uri:c.endpoints.jwks,end_session_endpoint:c.endpoints.logout,id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],response_types_supported:['code'],token_endpoint_auth_methods_supported:['client_secret_basic']};}
test('ZITADEL requires explicit provider, canonical generated HTTPS origin and separate API audience credentials',()=>{
 const c=cfg();assert.equal(c.provider,'zitadel');assert.equal(c.endpoints.authorization,env.OIDC_ISSUER+'/oauth/v2/authorize');assert.equal(c.endpoints.jwks,env.OIDC_ISSUER+'/oauth/v2/keys');
 for(const changes of [{OIDC_PROVIDER:'unknown'},{OIDC_PROVIDER:undefined},{OIDC_ISSUER:env.OIDC_ISSUER+'/'},{OIDC_ISSUER:env.OIDC_ISSUER+'/realms/private'},{OIDC_ISSUER:'https://musitu-synthetic.zitadel.cloud.evil.invalid'},{OIDC_ISSUER:'https://zitadel.cloud'},{OIDC_ISSUER:'http://musitu-synthetic.zitadel.cloud'},{OIDC_ISSUER:'https://user@musitu-synthetic.zitadel.cloud'},{OIDC_INTROSPECTION_CLIENT_SECRET:''},{OIDC_INTROSPECTION_CLIENT_ID:''},{OIDC_AUDIENCE:'other-api'},{APP_ORIGIN:'https://user@app.example.invalid'}])assert.throws(()=>identityConfig({...env,...changes}),/IDENTITY_/);
});
test('Keycloak remains the default with its original pinned realm paths',()=>{
 const c=identityConfig({...env,OIDC_PROVIDER:undefined,OIDC_ISSUER:'https://identity.example.invalid/realms/private'});
 assert.equal(c.provider,'keycloak');assert.equal(c.endpoints.introspection,c.issuer+'/protocol/openid-connect/token/introspect');
 assert.throws(()=>identityConfig({...env,OIDC_PROVIDER:'keycloak'}),/IDENTITY_/);
});
test('ZITADEL uses separately scoped Basic authentication for token exchange and introspection',()=>{
 const c=cfg(),exchange=providerClientRequest(c,'token',{grant_type:'authorization_code',code:'synthetic-code',code_verifier:'synthetic-verifier'}),intro=providerClientRequest(c,'introspection',{token:'synthetic-access'});
 assert.equal(exchange.headers.authorization,'Basic '+Buffer.from('web-synthetic:synthetic-web-secret').toString('base64'));
 assert.equal(intro.headers.authorization,'Basic '+Buffer.from('api-synthetic:synthetic-api-secret').toString('base64'));
 assert.equal(exchange.body.has('client_secret'),false);assert.equal(intro.body.has('client_id'),false);assert.equal(intro.body.get('token'),'synthetic-access');
 assert.throws(()=>providerClientRequest(c,'authorization',{}),/IDENTITY_/);
 const escaped=providerClientRequest({...c,client:'client: one',secret:'secret:+ two'},'token',{});
 assert.equal(Buffer.from(escaped.headers.authorization.slice(6),'base64').toString(),'client%3A+one:secret%3A%2B+two');
});
test('discovery is an assertion against pinned endpoints, never an instruction to follow an arbitrary URL',()=>{
 const c=cfg(),d=discovery(c);assert.doesNotThrow(()=>assertProviderDiscovery(d,c));
 for(const [key,value] of Object.entries({issuer:'https://other.zitadel.cloud',token_endpoint:'https://evil.invalid/token',jwks_uri:c.endpoints.jwks+'?source=evil',introspection_endpoint:c.endpoints.introspection+'/',authorization_endpoint:'http://evil.invalid',end_session_endpoint:'https://evil.invalid/logout',id_token_signing_alg_values_supported:['none'],code_challenge_methods_supported:['plain'],response_types_supported:['token'],token_endpoint_auth_methods_supported:['none']}))assert.throws(()=>assertProviderDiscovery({...d,[key]:value},c),/DISCOVERY_REJECTED/);
});
test('ZITADEL online validation requires exact issuer, client, subject, expiration and API audience',()=>{
 const c=cfg(),claims={sub:'synthetic-staff',exp:2000},info={active:true,sub:claims.sub,exp:2000,iss:c.issuer,client_id:c.client,aud:[c.audience,c.client]};
 assert.doesNotThrow(()=>assertActiveIntrospection(info,claims,c,1000));
 for(const changes of [{active:false},{iss:undefined},{client_id:undefined},{aud:undefined},{aud:['other-api']},{aud:[c.audience,42]},{sub:'foreign-staff'},{exp:2001},{exp:'2000'}])assert.throws(()=>assertActiveIntrospection({...info,...changes},claims,c,1000),/SESSION_REVOKED/);
});
test('ZITADEL logout preserves exact callback and state without exposing tokens or secrets',()=>{
 const c=cfg(),url=new URL(providerLogoutUrl(c,'s'.repeat(43)));assert.equal(url.pathname,'/oidc/v1/end_session');assert.equal(url.searchParams.get('post_logout_redirect_uri'),c.origin+'/auth/logged-out');assert.deepEqual([...url.searchParams.keys()],['client_id','post_logout_redirect_uri','state']);assert.equal(url.href.includes(c.secret),false);
});
