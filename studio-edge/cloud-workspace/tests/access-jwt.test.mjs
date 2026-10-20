import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyAccessJWT,AccessVerificationError,accessConfiguration} from '../access-jwt.mjs';
globalThis.crypto??=webcrypto;
const encoder=new TextEncoder();
const env={ACCESS_TEAM_DOMAIN:'https://verified-team.cloudflareaccess.com',ACCESS_AUD:'my_staging_application_audience'};
const b64=bytes=>Buffer.from(bytes).toString('base64url');
const now=Math.floor(Date.now()/1000);
const keyPair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keyPair.publicKey);
const key={...jwk,kid:'real-test-kid',use:'sig',alg:'RS256'};
function fetchKeys(override={keys:[key]}){
  return async (url,config)=>{
    assert.equal(url,env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs');
    assert.equal(config.redirect,'error');
    return new Response(JSON.stringify(override),{status:200,headers:{'content-type':'application/json'}});
  };
}
async function token({header={},claims={},keyOverride=keyPair.privateKey}={}){
  const h=b64(JSON.stringify({typ:'JWT',alg:'RS256',kid:key.kid,...header}));
  const p=b64(JSON.stringify({iss:env.ACCESS_TEAM_DOMAIN,aud:[env.ACCESS_AUD],sub:'user-unique-1234',iat:now-60,nbf:now-60,exp:now+3600,...claims}));
  const signed=h+'.'+p;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keyOverride,encoder.encode(signed));
  return signed+'.'+b64(sig);
}
const verify=(t,overrides={})=>verifyAccessJWT(t,env,{fetchImpl:fetchKeys(),now,...overrides});
test('real RS256 Access signature validates pinned issuer, audience, exact subject',async()=>{
  const principal=await verify(await token());
  assert.deepEqual(principal,{subject:'user-unique-1234'});
});
test('missing/invalid configuration and token are rejected closed',async()=>{
  for(const t of [null,'','a.b.c',await token({header:{alg:'none'}})]){
    await assert.rejects(verify(t),AccessVerificationError);
  }
  for(const bad of [{...env,ACCESS_TEAM_DOMAIN:'http://evil.local'},
    {...env,ACCESS_TEAM_DOMAIN:'https://verified-team.cloudflareaccess.com.evil.org'},
    {...env,ACCESS_AUD:''},{}]){
    assert.throws(()=>accessConfiguration(bad),AccessVerificationError);
  }
});
test('signed JWT with incorrect pinned audience, issuer, exp, iat or nbf must fail',async()=>{
  const bad=[
    {aud:['some-other-aud']},{iss:'https://attacker.cloudflareaccess.com'},
    {exp:now-1},{iat:now+100},{nbf:now+100},
    {exp:now+100000},{sub:'unsafe subj with spaces'},
    {sub:''},{exp:'tomorrow'},
  ];
  for(const claims of bad)await assert.rejects(verify(await token({claims})),AccessVerificationError);
});
test('tampered payload, swapped signing key, mismatched kid, unknown alg fail',async()=>{
  const valid=await token();
  const seg=valid.split('.');
  const changed=seg[0]+'.'+b64(JSON.stringify({iss:env.ACCESS_TEAM_DOMAIN,aud:[env.ACCESS_AUD],sub:'attacker-identity',iat:now-60,exp:now+300}))+'.'+seg[2];
  await assert.rejects(verify(changed),AccessVerificationError);
  const other=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  await assert.rejects(verify(await token({keyOverride:other.privateKey})),AccessVerificationError);
  await assert.rejects(verify(await token({header:{kid:'different-kid'}})),AccessVerificationError);
  await assert.rejects(verify(await token({header:{alg:'HS256'}})),AccessVerificationError);
});
test('unavailable/replaced/malformed signing keys always deny identity',async()=>{
  const signed=await token();
  for(const keys of [{keys:[]},{keys:[{...key,kid:'elsewhere'}]},
    {keys:[key,key]},{keys:[{...key,alg:'HS256'}]},{keys:null}]){
    await assert.rejects(verifyAccessJWT(signed,env,{fetchImpl:fetchKeys(keys),now}),AccessVerificationError);
  }
  await assert.rejects(verifyAccessJWT(signed,env,{fetchImpl:()=>{throw Error('offline');},now}),AccessVerificationError);
});
test('JWKS response never controls identity: verified claims determine subject only',async()=>{
  const t=await token({claims:{role:'owner',tenant:'other-tenant',custom:{admin:true}}});
  assert.deepEqual(await verify(t),{subject:'user-unique-1234'});
});
