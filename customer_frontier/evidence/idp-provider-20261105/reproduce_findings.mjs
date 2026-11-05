import {webcrypto as wc} from 'node:crypto';
import {verifyZitadelCodeTokens,ZITADEL_STAGING as pin} from '/workspace/scratch/cf664c251767/idp-session-continuation/axiom-source/customer_frontier/customer_control_plane/zitadel_provider_tokens_candidate.mjs';
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const nonce='Z'.repeat(43),access='synthetic-no-live-access';
async function make(bits,overrides={}){
 const pair=await wc.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:bits,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await wc.subtle.exportKey('jwk',pair.publicKey),kid:'review-key',alg:'RS256',use:'sig'};
 const sec=Math.floor(Date.now()/1000);
 const claims={iss:pin.issuer,sub:'synthetic-review-sub',aud:pin.client_id,nonce,iat:sec,exp:sec+3600,auth_time:sec,amr:['pwd','mfa'],...overrides};
 const input=enc({alg:'RS256',kid:'review-key'})+'.'+enc(claims);
 const signature=await wc.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(input));
 return {jwk,claims,id_token:input+'.'+Buffer.from(signature).toString('base64url')};
}
async function run(sample,delay=0){
 return verifyZitadelCodeTokens({id_token:sample.id_token,access_token:access,expected_nonce:nonce},{fetcher:async req=>{
  if(req.url===pin.jwks_uri)return Response.json({keys:[sample.jwk]});
  if(delay)await new Promise(r=>setTimeout(r,delay));
  return Response.json({sub:sample.claims.sub,email:'synthetic@example.test',email_verified:true});
 }});
}
const weak=await make(2047);let weakAccepted=false;try{await run(weak);weakAccepted=true;}catch(e){console.log('weak-denied',e.message);}
const modulus=BigInt('0x'+Buffer.from(weak.jwk.n,'base64url').toString('hex'));
console.log(JSON.stringify({case:'sub-2048-RSA',actualBits:modulus.toString(2).length,modulusBytes:Buffer.from(weak.jwk.n,'base64url').length,accepted:weakAccepted}));
const expiring=await make(2048,{exp:Math.floor(Date.now()/1000)+1});let expiredAccepted=false;try{await run(expiring,1300);expiredAccepted=true;}catch(e){console.log('expired-denied',e.message);}
console.log(JSON.stringify({case:'expiry-during-UserInfo',expiredAtReturn:Date.now()>=expiring.claims.exp*1000,accepted:expiredAccepted}));
