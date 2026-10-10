import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyExternalInferenceIdentity, IdentityDenied } from './inference_identity.mjs';
const enc=new TextEncoder();
const b64=(raw)=>Buffer.from(typeof raw==='string'?raw:raw).toString('base64url');
let keys, jwk, pub;
const now=1800000000;
async function fixture(){
 keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'kid_1',alg:'RS256',use:'sig'};
 delete jwk.key_ops;delete jwk.ext;
 pub={issuer:'https://identity.example.test',audience:'https://inference.mftintelligence.com',jwks:[jwk]};
}
function claims(extra={}){return {iss:pub.issuer, aud:pub.audience,sub:'customer_123',scope:'axiom.inference',iat:now-10,nbf:now-10,exp:now+60,...extra}}
async function sign(payload=claims(),header={alg:'RS256',kid:'kid_1',typ:'JWT'}){
 const t=b64(JSON.stringify(header))+'.'+b64(JSON.stringify(payload));
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,enc.encode(t));return t+'.'+b64(new Uint8Array(sig));
}
await fixture();
test('accepts explicitly scoped independent JWT only as identity, never provider authority',async()=>{
 const r=await verifyExternalInferenceIdentity(await sign(),pub,now);
 assert.equal(r.subject,'customer_123');
 assert.equal(r.audience,pub.audience);
 assert.equal(r.inference_scope_verified,true);
 assert.equal(r.external_provider_consent_verified,false);
 assert.equal(r.capability_issued,false);
 assert.equal(r.production_authority,false);
});
test('MCP token without inference audience/scope denied',async()=>{
 for(const o of [{aud:'https://mcp.mftintelligence.com',scope:'axiom.execute'},{scope:'axiom.execute'},{scope:'billing.write'}])
  await assert.rejects(verifyExternalInferenceIdentity(await sign(claims(o)),pub,now),IdentityDenied);
});
test('expired, prematurely used, stale, wrong issuer and altered subject fail closed',async()=>{
 for(const o of [{exp:now-1},{nbf:now+1},{iat:now-800},{iss:'https://evil.example'},{sub:'../customer'}])
   await assert.rejects(verifyExternalInferenceIdentity(await sign(claims(o)),pub,now),IdentityDenied);
});
test('none algorithm, wrong key ID, unauthorized crit, and malformed JWT denied',async()=>{
 for(const h of [{alg:'none',kid:'kid_1',typ:'JWT'},{alg:'RS256',kid:'unknown',typ:'JWT'},
                 {alg:'RS256',kid:'kid_1',typ:'JWT',crit:['exp']}])
  await assert.rejects(verifyExternalInferenceIdentity(await sign(claims(),h),pub,now),IdentityDenied);
 for(const s of ['x','x.y.z','', 'a'.repeat(4500)])
  await assert.rejects(verifyExternalInferenceIdentity(s,pub,now),IdentityDenied);
});
test('signature tampering and attacker-controlled JWKS rejected',async()=>{
 let token=await sign();token=token.slice(0,-2)+'xx';
 await assert.rejects(verifyExternalInferenceIdentity(token,pub,now),IdentityDenied);
 await assert.rejects(verifyExternalInferenceIdentity(await sign(),{...pub,jwks:[{...jwk,kid:'bad'}]},now),IdentityDenied);
 await assert.rejects(verifyExternalInferenceIdentity(await sign(),{...pub,jwks:[{...jwk,d:'secret'}]},now),IdentityDenied);
});
test('issuer and audience must be preconfigured by independent gateway, no wildcard trust',async()=>{
 for(const policy of [{issuer:'*',audience:pub.audience,jwks:[jwk]},
                     {...pub, audience:'*'},{...pub,jwks:[jwk,jwk]},
                     {...pub,jwks:[]},{...pub,issuer:'https://evil.example'}])
  await assert.rejects(verifyExternalInferenceIdentity(await sign(),policy,now),IdentityDenied);
});
