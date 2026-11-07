import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openTestDB} from '../customer-hosted-acceptance-20261107/customer_frontier/customer_control_plane/sqlite_d1_test_adapter.mjs';
import worker from './acceptance-worker-before-ownership-guard.mjs';
import {A,RUN,MARKER} from './acceptance-contract-before-ownership-guard.mjs';
const plan=JSON.parse(await readFile(new URL('../customer-hosted-acceptance-20261107/customer_frontier/qualification/customer-hosted-plan-20261106.json',import.meta.url)));
test('REPRO: disable mutates matching preexisting tenant without durable fixture marker',async()=>{
 const db=openTestDB(new URL('../customer-hosted-acceptance-20261107/customer_frontier/customer_control_plane/schema.sql',import.meta.url),{initialize:false});try{
  db._sqlite.exec(plan.statements.join('\n'));
  db._sqlite.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').run(A,'PREEXISTING_NOT_OWNED_BY_THIS_RUN');
  assert.equal(db._sqlite.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name=?').get(MARKER).n,0);
  const response=await worker.fetch(new Request('https://fixture.test/disable',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)}}),{DB:db,TOKEN:'a'.repeat(64),RUN,EXPIRES:String(Date.now()+60000)});
  const status=db._sqlite.prepare('SELECT status FROM tenants WHERE id=?').get(A).status;
  console.log(JSON.stringify({marker_present:false,response_status:response.status,preexisting_tenant_status:status}));
  assert.equal(response.status,200);assert.equal(status,'suspended');
 }finally{db.close();}
});
