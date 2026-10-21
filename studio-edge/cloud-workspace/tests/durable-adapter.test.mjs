import test from 'node:test';
import assert from 'node:assert/strict';
import {createDurableDB,initializeDurableTenant,DURABLE_SCHEMA,DurableAdapterError}
  from '../durable-sql-adapter.mjs';

const sql=()=>{
  const calls=[];
  const db={exec(query,...bindings){
    calls.push({query,bindings});
    if(query.includes('SELECT role'))return {toArray:()=>[{role:'viewer'}],rowsWritten:0};
    if(query.trim().startsWith('SELECT'))return {toArray:()=>[],rowsWritten:0};
    return {toArray:()=>[],rowsWritten:1};
  }};
  return {db,calls};
};
test('Durable storage refuses non-SQLite backends and never silently falls back',()=>{
  assert.throws(()=>createDurableDB(null),DurableAdapterError);
  assert.throws(()=>initializeDurableTenant({}),DurableAdapterError);
});
test('isolated tenant schema defines server-side memberships, immutable slot range and CAS',()=>{
  const {db,calls}=sql();
  initializeDurableTenant({sql:db});
  assert.equal(calls.length,1);
  assert.equal(calls[0].query,DURABLE_SCHEMA);
  for(const p of ['workspace_tenants','workspace_memberships','workspace_blobs','PRIMARY KEY(tenant_id,subject)',
    'CHECK(slot BETWEEN 1 AND 5)','PRIMARY KEY(tenant_id,slot)','REFERENCES workspace_tenants']){
    assert.ok(DURABLE_SCHEMA.includes(p),p);
  }
});
test('D1-shaped adapter forwards positional bound variables unchanged, never string-interpolated',async()=>{
  const {db,calls}=sql();
  const adapter=createDurableDB(db);
  const row=await adapter.prepare('SELECT role FROM workspace_memberships WHERE subject=?').bind("user'-and-hack").first();
  assert.equal(row.role,'viewer');
  assert.equal(calls.length,1);
  assert.ok(!calls[0].query.includes("user'-and-hack"));
  assert.deepEqual(calls[0].bindings,["user'-and-hack"]);
});
test('writes require SQLite rowsWritten and pass through D1-style affected row count',async()=>{
  const {db,calls}=sql();
  const result=await createDurableDB(db).prepare('UPDATE workspace_blobs SET version=version+1 WHERE slot=?')
    .bind(3).run();
  assert.deepEqual(result,{success:true,meta:{changes:1}});
  assert.deepEqual(calls[0].bindings,[3]);
});
test('missing row returns null rather than fabricating remote tenant records',async()=>{
  const {db}=sql();
  const row=await createDurableDB(db).prepare('SELECT encrypted FROM workspace_blobs WHERE slot=?')
    .bind(1).first();
  assert.equal(row,null);
});
test('nonunique read and missing writes fail closed without fallback',async()=>{
  const db={exec(query){return query.startsWith('SELECT')
    ? {toArray:()=>[{},{}],rowsWritten:0}
    : {toArray:()=>[],rowsWritten:undefined};}};
  const adapter=createDurableDB(db);
  await assert.rejects(adapter.prepare('SELECT * FROM workspace_blobs').bind().first(),
    error=>error.code==='NON_UNIQUE_READ');
  await assert.rejects(adapter.prepare('DELETE FROM workspace_blobs').bind().run(),
    error=>error.code==='WRITE_RESULT_UNAVAILABLE');
});
test('SQL adapter rejects unsafe statements, excess binds, invalid bind type, misuse of read/write',async()=>{
  const {db,calls}=sql(),adapter=createDurableDB(db);
  for(const q of ['DROP TABLE workspace_tenants','PRAGMA writable_schema=ON','',
    'WITH admin AS (DELETE FROM records) SELECT 1']){
    assert.throws(()=>adapter.prepare(q),DurableAdapterError);
  }
  assert.throws(()=>adapter.prepare('SELECT 1').bind(...Array(15).fill(0)),DurableAdapterError);
  assert.throws(()=>adapter.prepare('SELECT 1').bind({injected:true}),DurableAdapterError);
  await assert.rejects(adapter.prepare('SELECT 1').bind().run(),DurableAdapterError);
  await assert.rejects(adapter.prepare('DELETE FROM workspace_blobs').bind().first(),DurableAdapterError);
  assert.equal(calls.length,0);
});
test('no network, Access credentials, D1 resources or Worker deployments inside the SQLite adapter',()=>{
  const source=DURABLE_SCHEMA+createDurableDB.toString()+initializeDurableTenant.toString();
  for(const forbidden of ['fetch(', 'XMLHttpRequest','api.cloudflare.com','CLOUDFLARE_API_TOKEN']){
    assert.equal(source.includes(forbidden),false,forbidden);
  }
});
