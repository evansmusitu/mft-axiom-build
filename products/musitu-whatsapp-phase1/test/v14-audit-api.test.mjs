import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://issuer.example.invalid/realms/wa-private',audience='wa-audit';
const json=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(sub){const now=Math.floor(Date.now()/1000);const head=json({alg:'RS256',typ:'JWT',kid:'audittest'});const body=json({iss:issuer,aud:audience,sub,iat:now,nbf:now-1,exp:now+300});return head+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(head+'.'+body),privateKey).toString('base64url');}
test('private audit endpoint is authenticated, tenant-scoped and read-only',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'stage-audit-http-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=new PrivateStageStore(join(dir,'stage.sqlite'),{identityKey:Buffer.alloc(32,17)});t.after(()=>store.close());
 for(const c of ['A','B'])store.seedTenant({tenantId:'tenant-'+c,legalName:'Business '+c,ownerId:'owner-'+c,wabaId:'WABA_'+c,phoneNumberId:'PHONE_'+c});
 store.addResource('tenant-A','owner-A','chair','Chair');
 store.reserveBooking({tenantId:'tenant-A',actorId:'owner-A',resourceId:'chair',startAt:'2026-11-25T11:00:00.000Z',endAt:'2026-11-25T12:00:00.000Z',effectKey:'audit-http-1'});
 const app=createPrivateAdminServer({store,identityConfig:{issuer,audience,maxTokenAgeSeconds:600,jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'audittest',alg:'RS256',use:'sig'}]}}});
 const base=await app.start();t.after(()=>app.stop());
 const route=tenant=>`${base}/v1/tenants/${tenant}/audit`;
 assert.equal((await fetch(route('tenant-A'))).status,401);
 let response=await fetch(route('tenant-A'),{headers:{authorization:'Bearer '+jwt('owner-A')}});
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.tenantId,'tenant-A');assert.equal(result.events.length,1);assert.equal(result.events[0].action,'BOOKING_CREATED');
 response=await fetch(route('tenant-B'),{headers:{authorization:'Bearer '+jwt('owner-A')}});assert.equal(response.status,403);
 response=await fetch(route('tenant-B'),{headers:{authorization:'Bearer '+jwt('owner-B')}});assert.equal(response.status,200);assert.deepEqual((await response.json()).events,[]);
 assert.equal((await fetch(route('tenant-A'),{method:'POST',headers:{authorization:'Bearer '+jwt('owner-A')}})).status,404);
});
