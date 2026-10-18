import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {verifiedV03Identity} from '../src/v03_identity.mjs';

const team='https://musitu-ci-test.cloudflareaccess.com';
const aud='d'.repeat(64);
const env={STUDIO_ACCESS_TEAM_DOMAIN:team,STUDIO_ACCESS_POLICY_AUD:aud};
const actor={sub:'staff-subject-001',email:'Verified.Staff@Example.ORG',type:'app'};
const req=(token)=>new Request('https://studio-v03.mftintelligence.com/api/session',
  {headers:token?{'cf-access-jwt-assertion':token}:{}});

async function signed(privateKey,claims={},change={}){
 const token=new SignJWT({...actor,...claims})
   .setProtectedHeader({alg:'RS256',kid:'staff-ci-only-key'})
   .setIssuer(change.issuer??team)
   .setAudience(change.aud??aud)
   .setIssuedAt()
   .setExpirationTime(change.exp??'10m');
 return token.sign(privateKey);
}

test('real RS256-signed correct staff Access JWT is required and email is normalized',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwt=await signed(privateKey);
 const result=await verifiedV03Identity(req(jwt),env,{keySet:publicKey});
 assert.deepEqual(result,{sub:actor.sub,email:'verified.staff@example.org'});
 assert.equal(await verifiedV03Identity(req(null),env,{keySet:publicKey}),null);
});
test('wrong signature, wrong issuer, wrong audience and expired Access JWT cannot impersonate staff',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const another=await generateKeyPair('RS256');
 for(const jwt of [
   await signed(another.privateKey),
   await signed(privateKey,{}, {issuer:'https://attacker.cloudflareaccess.com'}),
   await signed(privateKey,{}, {aud:'e'.repeat(64)}),
   await signed(privateKey,{}, {exp:Math.floor(Date.now()/1000)-500})
 ]){
   assert.equal(await verifiedV03Identity(req(jwt),env,{keySet:publicKey}),null);
 }
 assert.equal(await verifiedV03Identity(req(await signed(privateKey)),{
   ...env,STUDIO_ACCESS_POLICY_AUD:'0'.repeat(64)},{keySet:publicKey}),null);
});
test('Access service identities, malformed email, absent subject and unsupported issuer cannot grant membership',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 for(const claims of [
   {type:'service'}, {email:''},{email:'no-at-sign'},
   {sub:''},{sub:'has\nnewline'}, {email:'spaces @example.org'}
 ]){
   assert.equal(await verifiedV03Identity(req(await signed(privateKey,claims)),env,{keySet:publicKey}),null);
 }
 const valid=await signed(privateKey);
 assert.equal(await verifiedV03Identity(req(valid),{
   ...env,STUDIO_ACCESS_TEAM_DOMAIN:'https://lookalike.cloudflareaccess.com.evil.example'},{keySet:publicKey}),null);
 assert.equal(await verifiedV03Identity(req(valid),{
   ...env,STUDIO_ACCESS_TEAM_DOMAIN:'https://musitu-ci-test.cloudflareaccess.com/'},{keySet:publicKey}),null);
});
