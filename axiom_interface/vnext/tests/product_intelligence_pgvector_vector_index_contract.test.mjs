import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGVECTOR_VECTOR_INDEX_DESCRIPTOR,deriveVectorRecordIdentity,createPgvectorVectorIndexBackend} from '../product_intelligence/backends/pgvector_vector_index_backend.js';
import {fakePool,scope,vector} from './pgvector_vector_index_test_fixture.mjs';
const migration=()=>readFile(resolve(dirname(fileURLToPath(import.meta.url)),'../product_intelligence/migrations/002_vector_index.sql'),'utf8');

test('descriptor and deterministic identity stay AXIOM-owned and pgvector-pinned',()=>{
  const d=PGVECTOR_VECTOR_INDEX_DESCRIPTOR;
  assert.deepEqual([d.kind,d.provider,d.provider_baseline,d.semantic_owner,d.authority,d.fail_closed,d.live_runtime_qualification],['VectorIndexBackend','pgvector','0.8.6','AXIOM','MECHANISM_ONLY',true,'NOT_PROVEN']);
  const input={...scope,content:'Exact keyboard requirement',vector,dimension:3};
  const a=deriveVectorRecordIdentity(input),b=deriveVectorRecordIdentity(input);
  assert.deepEqual(a,b); assert.equal(a.content_hash,createHash('sha256').update(input.content).digest('hex'));
  assert.match(a.record_id,/^vec_[a-f0-9]{64}$/); assert.equal(a.vector_dimension,3); assert.match(a.vector_hash,/^[a-f0-9]{64}$/);
});

test('migration enforces scope, metric+dimension binding, tombstones and idempotency ledger',async()=>{
  const sql=await migration();
  for(const re of [/CREATE EXTENSION IF NOT EXISTS vector/i,/CREATE TABLE IF NOT EXISTS axiom_pi\.vector_index_configs/i,/CREATE TABLE IF NOT EXISTS axiom_pi\.vector_entries/i,/CREATE TABLE IF NOT EXISTS axiom_pi\.vector_write_requests/i,/project_id TEXT NOT NULL/i,/work_id TEXT NOT NULL/i,/metric TEXT NOT NULL CHECK \(metric IN \('cosine','l2','inner_product'\)\)/i,/embedding vector NOT NULL/i,/dimension INTEGER NOT NULL CHECK \(dimension BETWEEN 1 AND 2000\)/i,/vector_dims\(embedding\) = dimension/i,/tombstoned BOOLEAN NOT NULL DEFAULT FALSE/i,/PRIMARY KEY \(project_id, work_id, index_id, request_id\)/i,/UNIQUE \(project_id, work_id, index_id, metric, dimension\)/i,/FOREIGN KEY \(project_id, work_id, index_id, metric, dimension\)/i]) assert.match(sql,re);
  assert.doesNotMatch(sql,/release_authority|production_authority|certification_authority/i);
});

test('invalid vectors, dimensions, metric and credential material fail before persistence',async()=>{
  const {pool,calls}=fakePool();
  assert.throws(()=>createPgvectorVectorIndexBackend({pool,dimension:2001,metric:'cosine'}),/dimension/);
  assert.throws(()=>createPgvectorVectorIndexBackend({pool,dimension:3,metric:'dot'}),/metric/);
  const b=createPgvectorVectorIndexBackend({pool,dimension:3,metric:'cosine'}), base={...scope,content:'bad vector',metadata:{source:'test'},expectedVersion:0};
  await assert.rejects(()=>b.upsertVector({...base,requestId:'request_bad_dimension',vector:[0.1,0.2]}),/exactly 3 dimensions/);
  await assert.rejects(()=>b.upsertVector({...base,requestId:'request_bad_nan',vector:[0.1,Number.NaN,0.3]}),/must be finite/);
  await assert.rejects(()=>b.upsertVector({...base,requestId:'request_bad_secret',vector,metadata:{nested:{api_key:'forbidden'}}}),e=>e?.name==='SecurityError'&&/forbidden credential material/.test(e.message));
  assert.equal(calls.length,0);
});

test('logical index metric/dimension drift is rejected before entry persistence',async()=>{
  const {pool,calls}=fakePool({config:{metric:'l2',dimension:3}}); const b=createPgvectorVectorIndexBackend({pool,dimension:3,metric:'cosine'});
  await assert.rejects(()=>b.upsertVector({...scope,requestId:'request_config_drift',content:'Exact keyboard requirement',vector,metadata:{source:'test'},expectedVersion:0}),/configuration mismatch/);
  assert.equal(calls.some(c=>c.sql.includes('INSERT INTO axiom_pi.vector_entries')),false);
});

test('health checks exact pgvector 0.8.6 without granting qualification authority',async()=>{
  const healthy=fakePool({extensionVersion:'0.8.6'}); const b=createPgvectorVectorIndexBackend({pool:healthy.pool,dimension:3,metric:'cosine'});
  assert.deepEqual(await b.health(),{status:'PASS',provider:'pgvector',expected_version:'0.8.6',observed_version:'0.8.6',evidence_state:'COMPUTED',authority_effect:'NONE',live_runtime_qualification:'NOT_PROVEN'});
  const wrong=fakePool({extensionVersion:'0.8.5'}); const r=await createPgvectorVectorIndexBackend({pool:wrong.pool,dimension:3,metric:'cosine'}).health();
  assert.deepEqual([r.status,r.observed_version,r.live_runtime_qualification],['FAIL','0.8.5','NOT_PROVEN']);
});
