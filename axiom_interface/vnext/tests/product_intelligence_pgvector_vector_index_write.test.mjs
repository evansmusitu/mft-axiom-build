import assert from 'node:assert/strict';
import test from 'node:test';
import {createPgvectorVectorIndexBackend} from '../product_intelligence/backends/pgvector_vector_index_backend.js';
import {fakePool,scope,vector} from './pgvector_vector_index_test_fixture.mjs';
const mk=pool=>createPgvectorVectorIndexBackend({pool,dimension:3,metric:'cosine'});
const args={...scope,requestId:'request_12345678',content:'Exact keyboard requirement',vector,metadata:{source:'test'},expectedVersion:0};

test('upsert binds exact scope and performs optimistic idempotent pgvector write',async()=>{
  const {pool,calls}=fakePool(); const saved=await mk(pool).upsertVector(args);
  assert.deepEqual([saved.status,saved.version,saved.project_id,saved.work_id,saved.metric,saved.authority_effect,saved.evidence_state],['WRITTEN',1,scope.projectId,scope.workId,'cosine','NONE','COMPUTED']);
  assert.match(saved.record_id,/^vec_[a-f0-9]{64}$/);
  const joined=calls.map(c=>c.sql).join('\n');
  for(const re of [/BEGIN/,/vector_write_requests/,/FOR UPDATE/,/INSERT INTO axiom_pi\.vector_entries/,/INSERT INTO axiom_pi\.vector_write_requests/,/COMMIT/]) assert.match(joined,re);
  const q=calls.find(c=>c.sql.includes('INSERT INTO axiom_pi.vector_entries')); assert.deepEqual([q.params[0],q.params[1],q.params[3],q.params[7]],[scope.projectId,scope.workId,'cosine','[0.1,0.2,0.3]']);
  assert.equal(calls.at(-1).sql,'RELEASE');
});

test('stale optimistic version rolls back without partial vector write',async()=>{
  const {pool,calls}=fakePool({record:{version:5,tombstoned:false,content_hash:'c'.repeat(64),vector_hash:'d'.repeat(64)}});
  await assert.rejects(()=>mk(pool).upsertVector({...args,requestId:'request_stale_version',expectedVersion:3}),/expected 3, current 5/);
  assert.match(calls.map(c=>c.sql).join('\n'),/ROLLBACK/); assert.equal(calls.some(c=>c.sql.includes('INSERT INTO axiom_pi.vector_entries')),false);
});

test('idempotency replays exact result and rejects request-id reuse with changed inputs',async()=>{
  const first=fakePool(); const written=await mk(first.pool).upsertVector({...args,requestId:'request_replay_12345678'});
  const ledger=first.calls.find(c=>c.sql.includes('INSERT INTO axiom_pi.vector_write_requests')); const stored={request_fingerprint:ledger.params[4],result:JSON.parse(ledger.params[5])};
  const replay=fakePool({idempotency:stored}); assert.deepEqual(await mk(replay.pool).upsertVector({...args,requestId:'request_replay_12345678'}),written);
  assert.equal(replay.calls.some(c=>c.sql.includes('INSERT INTO axiom_pi.vector_entries')),false);
  const mismatch=fakePool({idempotency:stored});
  await assert.rejects(()=>mk(mismatch.pool).upsertVector({...args,requestId:'request_replay_12345678',vector:[0.3,0.2,0.1]}),e=>e?.name==='SecurityError'&&/fingerprint mismatch/.test(e.message));
  assert.match(mismatch.calls.map(c=>c.sql).join('\n'),/ROLLBACK/); assert.equal(mismatch.calls.some(c=>c.sql.includes('INSERT INTO axiom_pi.vector_entries')),false);
});

test('tombstone is scoped, optimistic and preserves deletion audit trail',async()=>{
  const record={version:2,tombstoned:false,content_hash:'c'.repeat(64),vector_hash:'d'.repeat(64)}; const {pool,calls}=fakePool({record}); const recordId='vec_'+('b'.repeat(64));
  const r=await mk(pool).tombstoneVector({...scope,recordId,requestId:'request_tombstone_12345678',expectedVersion:2});
  assert.deepEqual([r.status,r.version,r.record_id,r.authority_effect,r.evidence_state],['TOMBSTONED',3,recordId,'NONE','COMPUTED']);
  const q=calls.find(c=>c.sql.startsWith('UPDATE axiom_pi.vector_entries')); assert.match(q.sql,/project_id=\$1 AND work_id=\$2 AND index_id=\$3 AND record_id=\$4/); assert.match(q.sql,/version=\$5 AND tombstoned=FALSE/);
  assert.deepEqual(q.params,[scope.projectId,scope.workId,scope.indexId,recordId,2]); assert.match(calls.map(c=>c.sql).join('\n'),/vector_write_requests/);
});
