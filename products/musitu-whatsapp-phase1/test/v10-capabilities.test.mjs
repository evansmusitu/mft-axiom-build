import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';

const kp=generateKeyPairSync('rsa',{modulusLength:2048}),iss='https://identity.example.invalid/private';
const identityConfig={issuer:iss,audience:'test-dashboard',maxTokenAgeSeconds:300,
 jwks:{keys:[{...kp.publicKey.export({format:'jwk'}),kid:'private-test',alg:'RS256',use:'sig'}]}};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function bearer(subject){const time=Math.floor(Date.now()/1000);const value=enc({typ:'JWT',alg:'RS256',kid:'private-test'})+'.'+enc({iss,aud:'test-dashboard',sub:subject,iat:time-1,nbf:time-1,exp:time+120});return 'Bearer '+value+'.'+sign('RSA-SHA256',Buffer.from(value),kp.privateKey).toString('base64url');}

test('tenant-scoped dashboard capabilities describe only available offline actions',async t=>{
 const calls=[];
 const repo={async snapshot(tenant,actor){calls.push([tenant,actor]);if(tenant!=='tenant-A'||actor!=='owner-A')throw Error('ACCESS_DENIED');return {tenantId:tenant,inquiries:0,bookings:0,humanConversations:0};},
  async listReplyDrafts(){return [];},async approveReplyDraft(){},async stageApprovedReply(){}};
 const server=createPrivateAdminServer({store:repo,identityConfig}),addr=await server.start();t.after(()=>server.stop());
 const url=addr+'/v1/tenants/tenant-A/capabilities';
 assert.equal((await fetch(url)).status,401);
 const own={authorization:bearer('owner-A')};
 let r=await fetch(url,{headers:own});assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{tenantId:'tenant-A',review:true,stageOffline:true,sendWhatsApp:false,collectPayments:false});
 r=await fetch(addr+'/v1/tenants/tenant-B/capabilities',{headers:own});assert.equal(r.status,403);
 r=await fetch(url,{headers:{authorization:bearer('owner-B')}});assert.equal(r.status,403);
 assert.deepEqual(calls,[['tenant-A','owner-A'],['tenant-B','owner-A'],['tenant-A','owner-B']]);
});

test('SQLite private stage truthfully disables review and staging, never authorizes sending',async t=>{
 const repo={async snapshot(tenant,actor){if(tenant!=='tenant-A'||actor!=='owner-A')throw Error('ACCESS_DENIED');return {tenantId:tenant};}};
 const server=createPrivateAdminServer({store:repo,identityConfig}),addr=await server.start();t.after(()=>server.stop());
 const r=await fetch(addr+'/v1/tenants/tenant-A/capabilities',{headers:{authorization:bearer('owner-A')}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{tenantId:'tenant-A',review:false,stageOffline:false,sendWhatsApp:false,collectPayments:false});
});
