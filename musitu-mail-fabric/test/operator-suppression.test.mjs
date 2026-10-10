import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac,randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createWorker} from '../src/edge/worker.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
const operator='test-dedicated-operator-token-0123456789abcdef',customer='test-customer-api-token-0123456789abcdef';
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>db.close());
 const privacyKey=randomBytes(32),encryptionKey=randomBytes(32),keys=generateDemonstrationKeys(),adapter=createD1Compat(db);
 const env={MMF_DB:adapter,MMF_TENANT_ID:'client1',MMF_OPERATOR_TOKEN:operator,MMF_AUTH_TOKEN:customer,MMF_SUPPRESSION_API_ENABLED:'true',
  MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',MMF_PRIVACY_KEY_B64:privacyKey.toString('base64')};
 const worker=createWorker();
 const request=(recipient,token=operator,extra={})=>new Request('https://restricted.invalid/v1/operator/suppressions',{
  method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({recipient,...extra})});
 return {db,adapter,env,worker,request,privacyKey,encryptionKey,keys};
}
test('separate operator token suppresses address during outbound pause without storing or returning plaintext',async t=>{
 const f=fixture(t);const raw='RECIPIENT@Example.NET';
 const response=await f.worker.fetch(f.request(raw),f.env);
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{suppressed:true,created:true});
 const opaque=createHmac('sha256',f.privacyKey).update('recipient@example.net').digest('hex');
 const saved=f.db.prepare('SELECT * FROM mail_suppressions WHERE tenant_id=?').all('client1');
 assert.equal(saved.length,1);assert.equal(saved[0].recipient_hmac,opaque);
 assert.equal(JSON.stringify(saved).includes('recipient@example.net'),false);
 const another=await f.worker.fetch(f.request(raw.toLowerCase()),f.env);
 assert.equal(another.status,200);assert.deepEqual(await another.json(),{suppressed:true,created:false});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mail_suppressions').get().n,1);
 const fab=new DurableMailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:createSimulatedProvider()},
 {db:f.adapter,encryptionKey:f.encryptionKey,privacyKey:f.privacyKey,keys:f.keys});
 await assert.rejects(()=>fab.enqueue({tenantId:'client1',from:'alerts@example.org',to:raw,
  subject:'Security notice',text:'Test only',kind:'SECURITY',idempotencyKey:'operator-suppress-12345'}),{code:'RECIPIENT_SUPPRESSED'});
});
test('ordinary customer token cannot suppress recipients; feature must be separately enabled',async t=>{
 const f=fixture(t);
 for(const token of [customer,'wrong-secret-0000000000000000000000']){
  const response=await f.worker.fetch(f.request('recipient@example.net',token),f.env);
  assert.equal(response.status,401);
 }
 const anon=new Request('https://restricted.invalid/v1/operator/suppressions',{method:'POST',
  headers:{'content-type':'application/json'},body:'{"recipient":"recipient@example.net"}'});
 assert.equal((await f.worker.fetch(anon,f.env)).status,401);
 assert.equal((await f.worker.fetch(f.request('recipient@example.net'),{...f.env,MMF_SUPPRESSION_API_ENABLED:'false'})).status,404);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mail_suppressions').get().n,0);
});
test('suppression is bound to tenant and does not prevent another tenant sending',async t=>{
 const f=fixture(t),response=await f.worker.fetch(f.request('recipient@example.net'),f.env);
 assert.equal(response.status,201);
 const provider=createSimulatedProvider();
 const other=new DurableMailFabric({tenantId:'client2',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},
  {db:f.adapter,encryptionKey:f.encryptionKey,privacyKey:f.privacyKey,keys:f.keys});
 const accepted=await other.enqueue({tenantId:'client2',from:'alerts@example.org',to:'recipient@example.net',
  subject:'Account notice',text:'Test only',kind:'ACCOUNT',idempotencyKey:'other-tenant-987654'});
 assert.equal(accepted.state,'QUEUED');
});
test('invalid and oversized operator requests fail closed without persisting anything',async t=>{
 const f=fixture(t);
 for(const recipient of ['not-an-email','admin@example.net\nBCC:someone@example.org','','a'.repeat(250)+'@example.net',42]){
  const response=await f.worker.fetch(f.request(recipient),f.env);
  assert.equal(response.status,422);
 }
 const extra=await f.worker.fetch(f.request('member@example.net',operator,{unblock:true}),f.env);
 assert.equal(extra.status,422);
 const malformed=await f.worker.fetch(new Request('https://restricted.invalid/v1/operator/suppressions',{method:'POST',
  headers:{authorization:'Bearer '+operator,'content-type':'application/json'},body:'{"recipient":'}),f.env);
 assert.equal(malformed.status,400);
 const huge=await f.worker.fetch(new Request('https://restricted.invalid/v1/operator/suppressions',{method:'POST',
  headers:{authorization:'Bearer '+operator,'content-type':'application/json'},
  body:JSON.stringify({recipient:'good@example.net',padding:'x'.repeat(5000)})}),f.env);
 assert.equal(huge.status,413);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mail_suppressions').get().n,0);
});
test('storage outage fails closed and does not falsely report suppression',async t=>{
 const f=fixture(t);
 const res=await f.worker.fetch(f.request('recipient@example.net'),{...f.env,MMF_DB:{prepare(){throw Error('offline')}}});
 assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'SUPPRESSION_STORE_UNAVAILABLE'});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mail_suppressions').get().n,0);
});
