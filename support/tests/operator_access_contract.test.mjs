import assert from 'node:assert/strict';
import test from 'node:test';
import * as worker from '../worker.js';

const enc=value=>Buffer.from(value).toString('base64url');

async function signedAccessFixture(overrides={}){
  const pair=await crypto.subtle.generateKey(
    {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify']
  );
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
  jwk.kid='kid-1'; jwk.alg='RS256'; jwk.use='sig';
  const now=Math.floor(Date.now()/1000);
  const header={alg:'RS256',kid:'kid-1',typ:'JWT'};
  const payload={
    iss:'https://musitu.cloudflareaccess.com',
    aud:['support-console-aud'],
    exp:now+300,
    iat:now-5,
    email:'operator@example.test',
    sub:'operator-subject',
    ...overrides,
  };
  const input=`${enc(JSON.stringify(header))}.${enc(JSON.stringify(payload))}`;
  const sig=await crypto.subtle.sign({name:'RSASSA-PKCS1-v1_5'},pair.privateKey,new TextEncoder().encode(input));
  return {token:`${input}.${Buffer.from(sig).toString('base64url')}`,jwk};
}

function envFor(jwk){
  return {
    SUPPORT_ACCESS_TEAM_DOMAIN:'https://musitu.cloudflareaccess.com',
    SUPPORT_ACCESS_AUD:'support-console-aud',
    SUPPORT_OPERATOR_BINDINGS_JSON:JSON.stringify({
      'operator@example.test':{actor_ref:'support_agent:owner',role:'support_agent'},
    }),
    SUPPORT_ACCESS_CERTS_FETCH:async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'content-type':'application/json'}}),
  };
}

test('Cloudflare Access verification returns only bounded operator identity, not raw email',async()=>{
  assert.equal(typeof worker.verifyOperatorAccess,'function');
  const {token,jwk}=await signedAccessFixture();
  const request=new Request('https://support-ops.example/',{headers:{'cf-access-jwt-assertion':token}});
  const principal=await worker.verifyOperatorAccess(request,envFor(jwk));
  assert.deepEqual(principal,{actor_ref:'support_agent:owner',role:'support_agent'});
  assert.equal('email' in principal,false);
});

test('operator Access verification fails closed on missing token, wrong audience, expiry or unmapped identity',async()=>{
  assert.equal(typeof worker.verifyOperatorAccess,'function');
  const missing=await worker.verifyOperatorAccess(new Request('https://support-ops.example/'),envFor({}));
  assert.equal(missing,null);

  const wrong=await signedAccessFixture({aud:['other-aud']});
  assert.equal(await worker.verifyOperatorAccess(new Request('https://support-ops.example/',{headers:{'cf-access-jwt-assertion':wrong.token}}),envFor(wrong.jwk)),null);

  const expired=await signedAccessFixture({exp:Math.floor(Date.now()/1000)-60});
  assert.equal(await worker.verifyOperatorAccess(new Request('https://support-ops.example/',{headers:{'cf-access-jwt-assertion':expired.token}}),envFor(expired.jwk)),null);

  const unknown=await signedAccessFixture({email:'unknown@example.test'});
  assert.equal(await worker.verifyOperatorAccess(new Request('https://support-ops.example/',{headers:{'cf-access-jwt-assertion':unknown.token}}),envFor(unknown.jwk)),null);
});
