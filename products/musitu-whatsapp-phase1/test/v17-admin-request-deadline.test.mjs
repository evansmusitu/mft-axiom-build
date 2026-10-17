import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://idp.example.invalid/realms/deadline-stage';
const audience='admin-body-deadline';
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid:'test-only',alg:'RS256',use:'sig'}]};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=()=>{
 const now=Math.floor(Date.now()/1000);
 const head=enc({alg:'RS256',typ:'JWT',kid:'test-only'}),body=enc({iss:issuer,aud:audience,sub:'owner-A',iat:now,nbf:now-1,exp:now+100});
 return head+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(head+'.'+body),privateKey).toString('base64url');
};
function serverFixture(t,options={}) {
 const store=new PrivateStageStore(':memory:',{identityKey:Buffer.alloc(32,15)});
 store.seedTenant({tenantId:'tenant-A',legalName:'Test A',ownerId:'owner-A',wabaId:'WABA_A',phoneNumberId:'PHONE_A'});
 t.after(()=>store.close());
 return createPrivateAdminServer({store,identityConfig:{issuer,audience,jwks,maxTokenAgeSeconds:300},...options});
}
function partialPost(url,headers,partial){
 return new Promise((resolve,reject)=>{
  const r=request(url,{method:'POST',headers},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));
   res.on('end',()=>{clearTimeout(timer);resolve({status:res.statusCode,json:JSON.parse(Buffer.concat(chunks))});});
  });
  const timer=setTimeout(()=>{r.destroy();reject(Error('ADMIN_REQUEST_HUNG'));},1100);
  r.on('error',error=>{clearTimeout(timer);reject(error);});
  r.write(partial);r.flushHeaders(); // no end(): imitate slow/abandoned upload
 });
}

test('authenticated partial JSON upload gets a bounded 408 instead of pinning request forever',async t=>{
 const server=serverFixture(t,{maxBodyReadMs:125});const base=await server.start();t.after(()=>server.stop());
 const response=await partialPost(base+'/v1/tenants/tenant-A/staff/owner-A/revoke',{
   'authorization':'Bearer '+token(),'content-type':'application/json','content-length':'100'
  },'{');
 assert.equal(response.status,408);
 assert.equal(response.json.error,'BODY_TIMEOUT');
});

test('declared oversized body is rejected before reading it',async t=>{
 const server=serverFixture(t);const base=await server.start();t.after(()=>server.stop());
 const response=await partialPost(base+'/v1/tenants/tenant-A/staff/owner-A/revoke',{
   authorization:'Bearer '+token(),'content-type':'application/json','content-length':'5000'
  },'{');
 assert.equal(response.status,413);assert.equal(response.json.error,'BODY_TOO_LARGE');
});

test('request deadline settings require a safe bounded interval',t=>{
 assert.throws(()=>serverFixture(t,{maxBodyReadMs:0}),/ADMIN_BODY_DEADLINE_CONFIG/);
 assert.throws(()=>serverFixture(t,{maxBodyReadMs:60000}),/ADMIN_BODY_DEADLINE_CONFIG/);
});
