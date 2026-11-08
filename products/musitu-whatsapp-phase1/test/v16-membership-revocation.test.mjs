import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,sign} from 'node:crypto';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://issuer.example.invalid/realms/private-v16',audience='wa-role-lifecycle';
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(subject){const now=Math.floor(Date.now()/1000),h=encode({typ:'JWT',alg:'RS256',kid:'v16-ephemeral'}),p=encode({iss:issuer,aud:audience,sub:subject,iat:now,nbf:now-1,exp:now+180});return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');}
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'musitu-role-v16-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'stage.sqlite'),store=new PrivateStageStore(path,{identityKey:Buffer.alloc(32,90)});
 t.after(()=>store.close());
 for(const code of ['A','B'])store.seedTenant({tenantId:'tenant-'+code,legalName:'Fixture '+code,ownerId:'owner-'+code,wabaId:'WABA_'+code,phoneNumberId:'PHONE_'+code});
 // Test setup is not a live or externally exposed enrollment path.
 const db=new DatabaseSync(path);db.prepare("INSERT INTO memberships VALUES(?,?,'AGENT','ACTIVE')").run('tenant-A','staff-A');
 db.prepare("INSERT INTO memberships VALUES(?,?,'VIEWER','ACTIVE')").run('tenant-A','viewer-A');
 db.close();
 return {store,path};
}

test('owner can revoke a member once; revocation persists and disables existing JWT membership immediately',async t=>{
 const {store,path}=fixture(t);
 const server=createPrivateAdminServer({store,identityConfig:{issuer,audience,maxTokenAgeSeconds:600,jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'v16-ephemeral',alg:'RS256',use:'sig'}]}}});
 const base=await server.start();t.after(()=>server.stop());
 const staffToken=jwt('staff-A'),ownerToken=jwt('owner-A');
 const metrics=`${base}/v1/tenants/tenant-A/metrics`;
 const revoke=`${base}/v1/tenants/tenant-A/staff/staff-A/revoke`;
 assert.equal((await fetch(metrics,{headers:{authorization:'Bearer '+staffToken}})).status,200);
 assert.equal((await fetch(revoke,{method:'POST',headers:{authorization:'Bearer '+staffToken,'content-type':'application/json'},body:'{}'})).status,403);
 let response=await fetch(revoke,{method:'POST',headers:{authorization:'Bearer '+ownerToken,'content-type':'application/json'},body:'{}'});
 assert.equal(response.status,201);assert.equal((await response.json()).revoked,true);
 response=await fetch(metrics,{headers:{authorization:'Bearer '+staffToken}});assert.equal(response.status,403);
 assert.equal((await fetch(`${base}/v1/tenants/tenant-A/bookings`,{headers:{authorization:'Bearer '+staffToken}})).status,403, 'revoked agent cannot query bookings either');
 response=await fetch(revoke,{method:'POST',headers:{authorization:'Bearer '+ownerToken,'content-type':'application/json'},body:'{}'});
 assert.equal(response.status,200);assert.equal((await response.json()).idempotent,true);
 assert.equal(store.listActionAudit('tenant-A','owner-A').filter(x=>x.action==='MEMBER_REVOKED').length,1);
 const reopened=new PrivateStageStore(path,{identityKey:Buffer.alloc(32,90)});t.after(()=>reopened.close());
 assert.throws(()=>reopened.snapshot('tenant-A','staff-A'),/ACCESS_DENIED/);
 assert.equal(reopened.snapshot('tenant-A','owner-A').tenantId,'tenant-A');
});

test('owner cannot revoke self; tenant B owner and tenant A viewer cannot revoke staff A',t=>{
 const {store}=fixture(t);
 assert.throws(()=>store.revokeMembership({tenantId:'tenant-A',actorId:'owner-A',memberId:'owner-A'}),/OWNER_SELF_REVOCATION_DENIED/);
 assert.throws(()=>store.revokeMembership({tenantId:'tenant-A',actorId:'viewer-A',memberId:'staff-A'}),/ACCESS_DENIED/);
 assert.throws(()=>store.revokeMembership({tenantId:'tenant-A',actorId:'owner-B',memberId:'staff-A'}),/ACCESS_DENIED/);
 assert.throws(()=>store.revokeMembership({tenantId:'tenant-A',actorId:'owner-A',memberId:'nonexistent'}),/MEMBER_NOT_FOUND/);
 assert.equal(store.snapshot('tenant-A','staff-A').tenantId,'tenant-A');
 assert.equal(store.snapshot('tenant-A','owner-A').tenantId,'tenant-A');
});

test('private staff listing is owner-only and tenant-scoped with no password or JWT data',async t=>{
 const {store}=fixture(t);
 const server=createPrivateAdminServer({store,identityConfig:{issuer,audience,maxTokenAgeSeconds:600,jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'v16-ephemeral',alg:'RS256',use:'sig'}]}}});
 const base=await server.start();t.after(()=>server.stop());
 const get=(tenant,subject)=>fetch(`${base}/v1/tenants/${tenant}/staff`,{headers:{authorization:'Bearer '+jwt(subject)}});
 assert.equal((await get('tenant-A','staff-A')).status,403);
 assert.equal((await get('tenant-A','owner-B')).status,403);
 const r=await get('tenant-A','owner-A');assert.equal(r.status,200);const json=await r.json();
 assert.deepEqual(json.members.map(x=>x.memberId),['owner-A','staff-A','viewer-A']);
 assert.deepEqual(Object.keys(json.members[0]).sort(),['memberId','role','status']);
 assert.equal(JSON.stringify(json).includes('owner-B'),false);
});

test('revoke API rejects extra payload, impersonation, unsupported methods and unknown member without writing audit',async t=>{
 const {store}=fixture(t);
 const server=createPrivateAdminServer({store,identityConfig:{issuer,audience,maxTokenAgeSeconds:600,jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'v16-ephemeral',alg:'RS256',use:'sig'}]}}});
 const base=await server.start();t.after(()=>server.stop());
 const auth={'authorization':'Bearer '+jwt('owner-A'),'content-type':'application/json'};
 const url=`${base}/v1/tenants/tenant-A/staff/staff-A/revoke`;
 assert.equal((await fetch(url,{method:'POST',headers:auth,body:'{"approvedBy":"owner-A"}'})).status,400);
 assert.equal((await fetch(url,{method:'GET',headers:auth})).status,404);
 assert.equal((await fetch(url.replace('staff-A','absent-A'),{method:'POST',headers:auth,body:'{}'})).status,404);
 assert.equal(store.listActionAudit('tenant-A','owner-A').filter(x=>x.action==='MEMBER_REVOKED').length,0);
});
