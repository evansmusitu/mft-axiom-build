import assert from 'node:assert/strict';
import test from 'node:test';
import {createPgvectorVectorIndexBackend} from '../product_intelligence/backends/pgvector_vector_index_backend.js';
import {fakePool,scope,vector} from './pgvector_vector_index_test_fixture.mjs';
const mk=pool=>createPgvectorVectorIndexBackend({pool,dimension:3,metric:'cosine'});

test('search is project/work scoped, metric-explicit and excludes tombstones',async()=>{
  const row={record_id:'vec_'+('b'.repeat(64)),content_hash:'c'.repeat(64),vector_hash:'d'.repeat(64),content:'Keyboard navigation',version:2,metadata:{source:'test'},raw_distance:0.125};
  const {pool,calls}=fakePool({searchRows:[row]}); const found=await mk(pool).searchNearest({...scope,vector,limit:5});
  assert.deepEqual([found.project_id,found.work_id,found.metric,found.rank_semantics,found.authority_effect,found.results.length,found.results[0].rank_value],[scope.projectId,scope.workId,'cosine','ASCENDING_LOWER_IS_BETTER','NONE',1,0.125]);
  const q=calls.find(c=>c.sql.includes('ORDER BY embedding')); assert.match(q.sql,/project_id=\$1 AND work_id=\$2 AND index_id=\$3/); assert.match(q.sql,/metric=\$4 AND dimension=\$5 AND tombstoned=FALSE/); assert.match(q.sql,/embedding <=> \$6::vector/);
  assert.deepEqual([q.params[0],q.params[1],q.params[5],q.params[6]],[scope.projectId,scope.workId,'[0.1,0.2,0.3]',5]);
});

test('export produces scoped neutral migration payload including tombstones',async()=>{
  const row={record_id:'vec_'+('b'.repeat(64)),content_hash:'c'.repeat(64),vector_hash:'d'.repeat(64),content:'Keyboard navigation',metric:'cosine',dimension:3,embedding:'[0.1,0.2,0.3]',version:3,metadata:{source:'test'},tombstoned:true,tombstoned_at:'2026-10-05T00:00:00Z'};
  const {pool,calls}=fakePool({searchRows:[row]}); const r=await mk(pool).exportIndex(scope);
  assert.deepEqual([r.schema,r.project_id,r.work_id,r.records.length,r.records[0].tombstoned,r.authority_effect],['musitu.axiom.vector-index-export.v1',scope.projectId,scope.workId,1,true,'NONE']);
  assert.match(calls.find(c=>c.sql.includes('ORDER BY record_id')).sql,/WHERE project_id=\$1 AND work_id=\$2 AND index_id=\$3/);
});
