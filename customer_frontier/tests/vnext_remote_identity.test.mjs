import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VNextRemoteDataAdapter,REMOTE_BOUNDARY} from '../customer_control_plane/vnext_remote_data_adapter.mjs';

const ORIGIN='https://axiom.example.invalid';
const binding={tenantId:'tenant-owner',identityId:'identity-owner',origin:ORIGIN};
const account=(overrides={})=>({ok:true,tenant_id:'tenant-owner',identity_id:'identity-owner',role:'owner',...overrides});

async function withBrowser(fetchMock,fn,{origin=ORIGIN}={}){
 const previousFetch=globalThis.fetch;
 const previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 globalThis.fetch=fetchMock;
 Object.defineProperty(globalThis,'location',{configurable:true,writable:true,value:{origin}});
 try{return await fn();}
 finally{
  globalThis.fetch=previousFetch;
  if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);
  else delete globalThis.location;
 }
}

test('unverified constructors cannot claim cloud-backed account',()=>{
 assert.throws(()=>new VNextRemoteDataAdapter(),/remote_admission_required/);
 assert.throws(()=>new VNextRemoteDataAdapter({}),/remote_admission_required/);
 assert.equal(REMOTE_BOUNDARY.executionQualified,false);
 assert.equal(REMOTE_BOUNDARY.independentVerifierQualified,false);
 assert.equal(REMOTE_BOUNDARY.oauthProductionQualified,false);
});

test('missing tenant or identity binding fails before network read',async()=>{
 await withBrowser(async()=>{throw new Error('network_called')},async()=>{
  for(const payload of [{},{tenantId:'tenant-owner',origin:ORIGIN},{identityId:'identity-owner',origin:ORIGIN}]){
   await assert.rejects(VNextRemoteDataAdapter.open(payload),/remote_account_binding_required/);
  }
 });
});

test('reject wrong tenant even after valid authenticated account readback',async()=>{
 await withBrowser(async()=>Response.json(account({tenant_id:'other-tenant'})),async()=>{
  await assert.rejects(VNextRemoteDataAdapter.open(binding),/remote_account_mismatch/);
 });
});

test('reject wrong identity even for correct tenant',async()=>{
 await withBrowser(async()=>Response.json(account({identity_id:'different-user'})),async()=>{
  await assert.rejects(VNextRemoteDataAdapter.open(binding),/remote_account_mismatch/);
 });
});

test('reject unauthenticated, disabled, and malformed account principals',async()=>{
 for(const change of [{ok:false},{identity_id:null},{role:'disabled'},{role:'superadmin'}]){
  await withBrowser(async()=>Response.json(account(change)),async()=>{
   await assert.rejects(VNextRemoteDataAdapter.open(binding),/remote_account_mismatch/);
  });
 }
});

test('reject unsafe, credentialed, mismatched, and fragment origin before network',async()=>{
 await withBrowser(async()=>{throw Error('network_called')},async()=>{
  for(const origin of ['http://axiom.example.invalid','https://user:pass@axiom.example.invalid',
   'https://other.example.invalid','https://axiom.example.invalid/path',
   'https://axiom.example.invalid/#fragment']){
   await assert.rejects(VNextRemoteDataAdapter.open({...binding,origin}),/remote_origin_invalid|remote_origin_mismatch/);
  }
 });
});

test('failed or expired customer session never establishes cloud adapter',async()=>{
 await withBrowser(async()=>Response.json({ok:false,error:'authentication_required'},{status:401}),async()=>{
  await assert.rejects(VNextRemoteDataAdapter.open(binding),/authentication_required/);
 });
});

test('valid bound account can read its tenant projects through credentialed same-origin API',async()=>{
 const requests=[];
 await withBrowser(async(url,options)=>{
  requests.push({url,options});
  if(url==='/v1/customer/me')return Response.json(account());
  if(url==='/v1/customer/projects')return Response.json({ok:true,projects:[{id:'p1',name:'Only mine',objective:'Prove isolation'}]});
  throw Error('unexpected_endpoint');
 },async()=>{
  const adapter=await VNextRemoteDataAdapter.open(binding);
  assert.equal(adapter.cloudBacked,true);
  assert.equal(adapter.accountVerified,true);
  assert.equal(adapter.tenantId,binding.tenantId);
  assert.equal(adapter.identityId,binding.identityId);
  assert.equal((await adapter.listProjects())[0].name,'Only mine');
  assert.equal(await adapter.verifyProjectChain(),false);
  assert.equal(await adapter.verifyWork(),false);
  await assert.rejects(adapter.approveWork(),/independent_approval_gateway_required/);
  adapter.close();
 });
 assert.equal(requests.length,2);
 for(const r of requests){
  assert.equal(r.options.method,'GET');
  assert.equal(r.options.credentials,'same-origin');
  assert.equal(r.options.redirect,'error');
  assert.equal(r.options.cache,'no-store');
  assert.equal(r.options.body,undefined);
  assert.ok(!('authorization' in r.options.headers));
 }
});

test('wrong browser origin cannot read account',async()=>{
 await withBrowser(async()=>{throw Error('network_called')},async()=>{
  await assert.rejects(VNextRemoteDataAdapter.open(binding),/remote_origin_mismatch/);
 },{origin:'https://imposter.example.invalid'});
});
