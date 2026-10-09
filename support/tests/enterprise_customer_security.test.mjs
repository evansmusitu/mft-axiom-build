import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {verifyEnterpriseAccess,handleSupportRequest,handleOperatorRequest} from '../worker.js';
import {D1CaseStore} from '../d1_case_store.js';

const enc=value=>Buffer.from(value).toString('base64url');

async function signedAccess(overrides={}){
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='enterprise-kid';jwk.alg='RS256';jwk.use='sig';
  const now=Math.floor(Date.now()/1000);
  const payload={iss:'https://team.cloudflareaccess.com',aud:['enterprise-aud'],sub:'opaque-enterprise-subject',email:'member@example.test',exp:now+300,iat:now-5,...overrides};
  const input=enc(JSON.stringify({alg:'RS256',kid:'enterprise-kid',typ:'JWT'}))+'.'+enc(JSON.stringify(payload));
  const sig=await crypto.subtle.sign({name:'RSASSA-PKCS1-v1_5'},pair.privateKey,new TextEncoder().encode(input));
  return {token:input+'.'+Buffer.from(sig).toString('base64url'),jwk};
}
function accessEnv(jwk){
  return {
    ENVIRONMENT:'production',
    SUPPORT_ENTERPRISE_ACCESS_TEAM_DOMAIN:'https://team.cloudflareaccess.com',
    SUPPORT_ENTERPRISE_ACCESS_AUD:'enterprise-aud',
    SUPPORT_ENTERPRISE_ACCESS_CERTS_FETCH:async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'content-type':'application/json'}})
  };
}

test('enterprise Access JWT verification exposes no raw email and fails closed on audience expiry or subject errors',async()=>{
  const {token,jwk}=await signedAccess();
  const principal=await verifyEnterpriseAccess(new Request('https://support.example/enterprise/',{headers:{'cf-access-jwt-assertion':token}}),accessEnv(jwk));
  assert.deepEqual(principal,{issuer:'https://team.cloudflareaccess.com',subject:'opaque-enterprise-subject'});
  assert.equal('email' in principal,false);
  for(const overrides of [{aud:['wrong']},{exp:Math.floor(Date.now()/1000)-1},{sub:''}]){
    const signed=await signedAccess(overrides);
    assert.equal(await verifyEnterpriseAccess(new Request('https://support.example/enterprise/',{headers:{'cf-access-jwt-assertion':signed.token}}),accessEnv(signed.jwk)),null);
  }
});

test('invite consumption source atomically claims token with UPDATE RETURNING before membership insert',async()=>{
  const source=await readFile(new URL('../d1_case_store.js',import.meta.url),'utf8');
  const idx=source.indexOf('async consumeOrganizationInvite');
  assert.ok(idx>0);
  const slice=source.slice(idx,idx+3500);
  assert.match(slice,/UPDATE support_org_invites SET consumed_at=\?/);
  assert.match(slice,/consumed_at IS NULL/);
  assert.match(slice,/RETURNING invite_id,org_ref,role,expires_at/);
  assert.ok(slice.indexOf('UPDATE support_org_invites')<slice.indexOf('INSERT INTO support_org_memberships'));
});

test('organization admin may issue member invite but ordinary member is denied',async()=>{
  const calls=[];
  const base={
    async getEnterpriseOrganizationContext(org,identity){return {org_ref:org,role:'ORG_MEMBER',membership_id:'AXL-0123456789ABCDEF',plan:'ENTERPRISE',entitlements:[]};},
    async createOrganizationInvite(org,input,p){calls.push([org,input,p]);return {invite_id:'AXV-0123456789ABCDEF',org_ref:org,role:input.role,invite_code:'ABCDEFGH-JKMNPQRS-TVWXYZ01'};}
  };
  const env={ENVIRONMENT:'test',SUPPORT_STORE:base,SUPPORT_ENTERPRISE_IDENTITY_VERIFY:async()=>({issuer:'https://team.cloudflareaccess.com',subject:'subject-1'})};
  const denied=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/orgs/org%3Aacme001/invites',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'ORG_MEMBER'})}),env);
  assert.equal(denied.status,403);
  base.getEnterpriseOrganizationContext=async org=>({org_ref:org,role:'ORG_ADMIN',membership_id:'AXL-0123456789ABCDEF',plan:'ENTERPRISE',entitlements:[]});
  const ok=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/orgs/org%3Aacme001/invites',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'ORG_MEMBER'})}),env);
  assert.equal(ok.status,201);assert.equal(calls.length,1);
});

test('operator membership listing and revocation routes exist',async()=>{
  const store={
    async listOrganizationMemberships(org){return [{membership_id:'AXL-0123456789ABCDEF',role:'ORG_MEMBER',active:true}]},
    async revokeOrganizationMembership(org,id,p){return {org_ref:org,membership_id:id,revoked:true}}
  };
  const env={ENVIRONMENT:'test',SUPPORT_STORE:store,SUPPORT_OPERATOR_VERIFY:async()=>({actor_ref:'support_agent:owner',role:'support_agent'})};
  const list=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/organizations/org%3Aacme001/memberships'),env);
  assert.equal(list.status,200);
  const revoke=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/organizations/org%3Aacme001/memberships/AXL-0123456789ABCDEF/revoke',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env);
  assert.equal(revoke.status,200);
});

test('enterprise membership store never returns identity hashes to customer-facing membership objects',async()=>{
  const source=await readFile(new URL('../d1_case_store.js',import.meta.url),'utf8');
  const idx=source.indexOf('async getEnterpriseMemberships');
  assert.ok(idx>0);
  const slice=source.slice(idx,idx+2600);
  assert.match(slice,/identity_hash=\?/);
  assert.doesNotMatch(slice,/identity_hash\s*:/);
});
