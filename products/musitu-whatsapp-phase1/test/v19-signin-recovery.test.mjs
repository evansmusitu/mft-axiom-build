import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../app/auth/[action]/route.js';

test('failed browser callback leaves credential-bearing URL for a fixed recovery page',async()=>{
 const env={OIDC_PROVIDER:'zitadel',OIDC_ISSUER:'https://recovery-synthetic.zitadel.cloud',OIDC_CLIENT_ID:'synthetic-web',OIDC_CLIENT_SECRET:'synthetic-web-secret',OIDC_AUDIENCE:'synthetic-api',OIDC_INTROSPECTION_CLIENT_ID:'synthetic-api',OIDC_INTROSPECTION_CLIENT_SECRET:'synthetic-api-secret',APP_ORIGIN:'https://app.example.invalid',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')};
 const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),oldWarn=console.warn,oldFetch=globalThis.fetch,diagnostics=[];
 Object.assign(process.env,env);console.warn=value=>diagnostics.push(value);
 globalThis.fetch=()=>assert.fail('Rejected flow must not reach provider transport');
 try{
  const request=new Request('https://app.example.invalid/auth/callback?code=synthetic-private-code&state=synthetic-private-state',{headers:{accept:'text/html,application/xhtml+xml'}});
  const response=await GET(request,{params:Promise.resolve({action:'callback'})});
  assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),'/sign-in-help');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(response.headers.has('set-cookie'),false);
  assert.equal(await response.text(),'');
  assert.equal(JSON.parse(diagnostics[0]).stage,'FLOW_VALIDATION');
  assert.equal(JSON.stringify(diagnostics).includes('synthetic-private'),false);
 }finally{console.warn=oldWarn;globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('non-browser and POST failures retain the denied JSON contract without navigation',async()=>{
 const saved=process.env.OIDC_ISSUER,oldWarn=console.warn;delete process.env.OIDC_ISSUER;console.warn=()=>{};
 try{
  for(const [handler,method,action,accept]of [[GET,'GET','callback','application/json'],[POST,'POST','logout','text/html'],[GET,'GET','login','text/html']]){
   const response=await handler(new Request('https://app.example.invalid/auth/'+action,{method,headers:{accept}}),{params:Promise.resolve({action})});
   assert.equal(response.status,503);assert.equal(response.headers.get('location'),null);
   assert.deepEqual(await response.json(),{error:'IDENTITY_UNAVAILABLE_OR_DENIED'});
   assert.equal(response.headers.get('cache-control'),'no-store');
  }
 }finally{console.warn=oldWarn;if(saved===undefined)delete process.env.OIDC_ISSUER;else process.env.OIDC_ISSUER=saved;}
});
