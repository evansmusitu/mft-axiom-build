import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';

async function local(t){
 const server=createPrivateAdminServer({store:{snapshot() {return {tenantId:'stage-only'};}},identityConfig:{issuer:'https://issuer.invalid/realms/stage',audience:'no-production',maxTokenAgeSeconds:300,jwks:{keys:[]}}});
 const url=await server.start();t.after(()=>server.stop());return url;
}
test('process liveness does not imply real provider or database readiness',async t=>{
 const url=await local(t);
 const live=await fetch(url+'/health/live');
 assert.equal(live.status,200);
 assert.deepEqual(await live.json(),{status:'ALIVE_PRIVATE_STAGE'});
 assert.equal(live.headers.get('cache-control'),'no-store');
 const ready=await fetch(url+'/health/ready');
 assert.equal(ready.status,503);
 assert.deepEqual(await ready.json(),{status:'NOT_READY',reason:'PRODUCTION_INTEGRATION_GATES_UNQUALIFIED'});
});
test('crafted ready request cannot override an unqualified service state',async t=>{
 const url=await local(t);
 const ready=await fetch(url+'/health/ready',{headers:{authorization:'Bearer fake','x-production-ready':'true'}});
 assert.equal(ready.status,503);
 assert.equal((await ready.json()).status,'NOT_READY');
 assert.equal((await fetch(url+'/health/ready?ready=true')).status,404);
 assert.equal((await fetch(url+'/health/ready',{method:'POST'})).status,404);
});
