import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {MmfStagingSqliteDO,createDurableSqlAdapter} from '../src/edge/sqlite-do.mjs';
import {SQL_SCHEMA} from '../src/edge/sqlite-schema.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {randomBytes} from 'node:crypto';

const SECRET='only-for-isolated-local-tests-0123456789abcdef';
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 const bridge={exec(statement,...params){const s=sql.prepare(statement);let rows=[];
   if(/^\s*(SELECT|WITH|PRAGMA)/i.test(statement))rows=s.all(...params);else s.run(...params);
   return{toArray(){return rows},rowsWritten:Number(sql.prepare('SELECT changes() AS n').get().n)};
 }};
 const node=new MmfStagingSqliteDO({storage:{sql:bridge}},{MMF_STORAGE_RPC_SECRET:SECRET});
 const stub={fetch:request=>node.fetch(request)};
 const namespace={idFromName:name=>name,get:id=>id==='mmf-stage-tenant'?stub:null};
 return{node,namespace,sql,client:createDurableSqlAdapter(namespace,SECRET)};
}
test('staging schema exactly matches authoritative D1 schema',()=>{
 assert.equal(SQL_SCHEMA,readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
});
test('Durable Object RPC fails closed on missing authorization or invalid SQL method',async t=>{
 const {node}=fixture(t);
 const unsigned=await node.fetch(new Request('https://local.invalid/rpc',{method:'POST',body:JSON.stringify({sql:'SELECT 1',params:[]})}));
 assert.equal(unsigned.status,401);
 const invalid=await node.fetch(new Request('https://local.invalid/rpc',{method:'POST',headers:{'x-mmf-internal':SECRET},body:JSON.stringify({sql:'',params:[]})}));
 assert.equal(invalid.status,400);
});
test('Durable Object adapter preserves D1 .prepare first/all/run contract with persisted unique keys',async t=>{
 const {client}=fixture(t);
 const out=await client.prepare('INSERT INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)').bind('tenantx','opaque-identity',123).run();
 assert.equal(out.success,true);assert.equal(out.meta.changes,1);
 const row=await client.prepare('SELECT tenant_id FROM mail_suppressions WHERE recipient_hmac=?').bind('opaque-identity').first();
 assert.equal(row.tenant_id,'tenantx');
 const listed=await client.prepare('SELECT tenant_id FROM mail_suppressions').all();assert.equal(listed.results.length,1);
 const dup=await client.prepare('INSERT OR IGNORE INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)').bind('tenantx','opaque-identity',124).run();
 assert.equal(dup.meta.changes,0);
});
test('Durable Object adapter processes simulated transaction once and preserves evidence',async t=>{
 const {client}=fixture(t);const prov=createSimulatedProvider();
 const mmf=new DurableMailFabric({tenantId:'tenantx',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:prov},
  {db:client,encryptionKey:randomBytes(32),privacyKey:randomBytes(32),keys:generateDemonstrationKeys()});
 const msg={tenantId:'tenantx',from:'staging@example.org',to:'probe@example.invalid',subject:'Stage only',text:'No network delivery',kind:'SERVICE_ALERT',idempotencyKey:'durable-object-probe-0001'};
 const first=await mmf.enqueue(msg);assert.equal(first.state,'QUEUED');
 const replay=await mmf.enqueue(msg);assert.equal(replay.messageId,first.messageId);
 const result=await mmf.processById(first.messageId);assert.equal(result.state,'ACCEPTED_BY_PROVIDER');
 assert.equal(prov.attempts,1);
 const state=await mmf.get(first.messageId,'tenantx');assert.equal(state.state,'ACCEPTED_BY_PROVIDER');
});
