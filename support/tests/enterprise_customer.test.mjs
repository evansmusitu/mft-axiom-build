import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1CaseStore} from '../d1_case_store.js';
import {handleSupportRequest,handleOperatorRequest,verifyEnterpriseAccess} from '../worker.js';

const org='org:acme001';
const caseId='AX-0123456789AB';
const identity={issuer:'https://team.cloudflareaccess.com',subject:'opaque-enterprise-user'};

test('enterprise schema stores only hashed identities and one-time invite hashes',async()=>{
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS support_org_invites/);
  assert.match(schema,/token_hash TEXT NOT NULL UNIQUE CHECK \(length\(token_hash\) = 64\)/);
  assert.match(schema,/role TEXT NOT NULL CHECK \(role IN \('ORG_ADMIN','ORG_MEMBER'\)\)/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS support_org_memberships/);
  assert.match(schema,/identity_hash TEXT NOT NULL CHECK \(length\(identity_hash\) = 64\)/);
  assert.match(schema,/UNIQUE\(org_ref,identity_hash\)/);
  assert.doesNotMatch(schema,/support_org_(?:invites|memberships)[\s\S]{0,1500}\b(?:email|jwt|otp|password|subject)\s+TEXT/i);
});

test('enterprise store exposes invite membership and shared-case primitives',()=>{
  for(const name of [
    'createOrganizationInvite','consumeOrganizationInvite','getEnterpriseMemberships','getEnterpriseOrganizationContext',
    'listEnterpriseCases','getEnterpriseCase','appendEnterpriseCustomerMessage'
  ]) assert.equal(typeof D1CaseStore.prototype[name],'function',name);
});

test('enterprise Access verifier returns only issuer and opaque subject',async()=>{
  const principal=await verifyEnterpriseAccess(new Request('https://support.example/enterprise/'),{
    ENVIRONMENT:'test',SUPPORT_ENTERPRISE_IDENTITY_VERIFY:async()=>identity
  });
  assert.deepEqual(principal,identity);
  assert.equal('email' in principal,false);
  assert.equal(await verifyEnterpriseAccess(new Request('https://support.example/enterprise/'),{
    ENVIRONMENT:'test',SUPPORT_ENTERPRISE_IDENTITY_VERIFY:async()=>({issuer:'',subject:'x'})
  }),null);
});

function fakeStore(){
  const calls=[];
  return {calls,
    async createOrganizationInvite(ref,input,p){calls.push(['invite',ref,input,p]);return {invite_id:'AXV-0123456789ABCDEF',org_ref:ref,role:input.role,invite_code:'ABCDEFGH-JKLMNPQR-STUVWXYZ',expires_at:'2026-10-10T00:00:00.000Z'};},
    async consumeOrganizationInvite(code,who){calls.push(['join',code,who]);return {membership_id:'AXL-0123456789ABCDEF',org_ref:org,role:'ORG_MEMBER',plan:'ENTERPRISE'};},
    async getEnterpriseMemberships(who){calls.push(['me',who]);return [{org_ref:org,role:'ORG_MEMBER',plan:'ENTERPRISE',entitlements:['priority_support']}];},
    async getEnterpriseOrganizationContext(ref,who){calls.push(['context',ref,who]);return ref===org?{org_ref:org,role:'ORG_MEMBER',plan:'ENTERPRISE',entitlements:['priority_support']}:null;},
    async listEnterpriseCases(ref,who){calls.push(['list',ref,who]);return [{case_id:caseId,state:'NEW',priority:'P2'}];},
    async create(bundle,options){calls.push(['create',bundle,options]);return {case_id:caseId,state:'NEW',priority:'P2'};},
    async getEnterpriseCase(ref,id,who){calls.push(['get',ref,id,who]);return {case:{case_id:id,state:'NEW',priority:'P2'},details:{summary:'Shared case'},messages:[],attachments:[]};},
    async appendEnterpriseCustomerMessage(ref,id,who,input){calls.push(['message',ref,id,who,input]);return {message:{message_id:'AXM-0123456789ABCDEF',body:input.body}};}
  };
}
const enterpriseEnv=store=>({
  ENVIRONMENT:'test',SUPPORT_STORE:store,
  SUPPORT_ENTERPRISE_IDENTITY_VERIFY:async()=>identity,
  SUPPORT_OPERATOR_VERIFY:async()=>({actor_ref:'support_agent:owner',role:'support_agent'})
});

test('operator can create one-time organization invite without retrieving stored token later',async()=>{
  const store=fakeStore();
  const r=await handleOperatorRequest(new Request('https://ops.example/api/v1/operator/organizations/'+encodeURIComponent(org)+'/invites',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'ORG_MEMBER',expires_in_hours:24})
  }),enterpriseEnv(store));
  assert.equal(r.status,201);
  const body=await r.json();
  assert.match(body.invite_code,/^[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(store.calls[0][0],'invite');
});

test('enterprise join and me require verified Access identity',async()=>{
  const store=fakeStore(),e=enterpriseEnv(store);
  const denied=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/join',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({invite_code:'ABCDEFGH-JKLMNPQR-STUVWXYZ'})
  }),{...e,SUPPORT_ENTERPRISE_IDENTITY_VERIFY:async()=>null});
  assert.equal(denied.status,401);

  const joined=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/join',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({invite_code:'ABCDEFGH-JKLMNPQR-STUVWXYZ'})
  }),e);
  assert.equal(joined.status,201);

  const me=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/me'),e);
  assert.equal(me.status,200);
  assert.equal((await me.json()).memberships[0].plan,'ENTERPRISE');
});

test('enterprise shared cases inherit server organization plan and requester ref',async()=>{
  const store=fakeStore(),e=enterpriseEnv(store);
  const list=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/orgs/'+encodeURIComponent(org)+'/cases'),e);
  assert.equal(list.status,200);

  const created=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/orgs/'+encodeURIComponent(org)+'/cases',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      surface:'web_app',category:'bug',affected_scope:'organization',summary:'Enterprise shared case',
      description:'Synthetic enterprise issue.',reproduction:'None.',impact:'None.',evidence_refs:[],consent_to_process:true,language:'en',
      support_plan:'COMMUNITY'
    })
  }),e);
  assert.equal(created.status,201);
  const createCall=store.calls.find(x=>x[0]==='create');
  assert.equal(createCall[1].intake.requester_ref,org);
  assert.equal(createCall[2].supportPlan,'ENTERPRISE');
  assert.equal(createCall[2].language,'en');
  assert.notEqual(createCall[2].supportPlan,'COMMUNITY');
});

test('enterprise member can read shared thread and post customer message only inside authorized org',async()=>{
  const store=fakeStore(),e=enterpriseEnv(store);
  const get=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/orgs/'+encodeURIComponent(org)+'/cases/'+caseId),e);
  assert.equal(get.status,200);
  const msg=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/orgs/'+encodeURIComponent(org)+'/cases/'+caseId+'/messages',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:'Shared customer reply'})
  }),e);
  assert.equal(msg.status,201);

  const denied=await handleSupportRequest(new Request('https://support.example/enterprise/api/v1/orgs/org:other999/cases/'+caseId),e);
  assert.equal(denied.status,404);
});

test('enterprise customer UI exists without browser secret persistence',async()=>{
  const [html,js]=await Promise.all([
    readFile(new URL('../enterprise/index.html',import.meta.url),'utf8'),
    readFile(new URL('../enterprise/app.js',import.meta.url),'utf8')
  ]);
  assert.match(html,/Enterprise Support/i);
  assert.match(html,/name="invite_code"/);
  assert.match(html,/Shared cases/i);
  assert.doesNotMatch(html,/name="email"|name="phone"/i);
  assert.match(js,/\/enterprise\/api\/v1\/join/);
  assert.match(js,/\/enterprise\/api\/v1\/me/);
  assert.match(js,/\/enterprise\/api\/v1\/orgs\//);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB/i);
});
