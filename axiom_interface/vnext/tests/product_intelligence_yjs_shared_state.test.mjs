import assert from 'node:assert/strict';
import test from 'node:test';
import {YJS_SHARED_STATE_DESCRIPTOR,createYjsSharedState} from '../product_intelligence/yjs_shared_state.js';

const enc=new TextEncoder();
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
function runtime(){
  return {
    version:'13.6.33',
    mergeUpdates(updates){
      const chunks=[...new Map(updates.map(b=>[Buffer.from(b).toString('hex'),b])).values()].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
      return new Uint8Array(Buffer.concat(chunks.map(b=>Buffer.from(b))));
    },
    encodeStateVectorFromUpdate(update){return new Uint8Array(update.slice(0,Math.min(8,update.length)));},
    diffUpdate(update,stateVector){return new Uint8Array(update.slice(stateVector.length));},
  };
}
const base={projectId:'project_12345678',workId:'work_12345678',documentId:'doc_12345678',requestId:'request_12345678'};
async function env(updateId,actorId,text){const bytes=enc.encode(text);return {projectId:base.projectId,workId:base.workId,documentId:base.documentId,updateId,actorId,updateSha256:await sha(bytes),bytes};}

test('Yjs is frozen as shared-state substrate, not AXIOM authority or persistence',()=>{
  assert.equal(YJS_SHARED_STATE_DESCRIPTOR.provider,'yjs');
  assert.equal(YJS_SHARED_STATE_DESCRIPTOR.provider_baseline,'13.6.33');
  assert.equal(YJS_SHARED_STATE_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(YJS_SHARED_STATE_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(YJS_SHARED_STATE_DESCRIPTOR.persistence_authority,false);
  assert.equal(YJS_SHARED_STATE_DESCRIPTOR.canonical_evidence_authority,false);
  assert.equal(YJS_SHARED_STATE_DESCRIPTOR.release_authority,false);
});

test('merge binds exact project/work/document identities and verified update digests',async()=>{
  const a=await env('update_a','actor_a','alpha'); const b=await env('update_b','actor_b','beta');
  const shared=createYjsSharedState({runtime:runtime()});
  const out=await shared.merge({...base,updates:[a,b]});
  assert.equal(out.schema,'musitu.axiom.yjs-shared-state.v1');
  assert.equal(out.project_id,base.projectId); assert.equal(out.work_id,base.workId); assert.equal(out.document_id,base.documentId);
  assert.deepEqual(out.input_update_ids,['update_a','update_b']);
  assert.ok(/^[a-f0-9]{64}$/.test(out.merged_update_sha256));
  assert.ok(/^[a-f0-9]{64}$/.test(out.state_vector_sha256));
  assert.equal(out.shared_state_status,'MERGED'); assert.equal(out.persistence_state,'NOT_PERSISTED');
  assert.equal(out.canonical_evidence,false); assert.equal(out.authority_effect,'NONE');
  assert.equal(out.release_authority,false); assert.equal(out.production_authority,false);
  assert.ok(out.merged_update instanceof Uint8Array); assert.ok(out.state_vector instanceof Uint8Array);
});

test('merge is deterministic and idempotent across input order and duplicate content',async()=>{
  const a=await env('update_a','actor_a','alpha'); const b=await env('update_b','actor_b','beta'); const dup={...(await env('update_c','actor_c','alpha'))};
  const shared=createYjsSharedState({runtime:runtime()});
  const one=await shared.merge({...base,updates:[a,b]});
  const two=await shared.merge({...base,updates:[b,a,dup]});
  assert.equal(one.merged_update_sha256,two.merged_update_sha256);
  assert.equal(one.state_vector_sha256,two.state_vector_sha256);
});

test('peer state vector yields digest-bound delta without changing authority',async()=>{
  const a=await env('update_a','actor_a','alpha'); const b=await env('update_b','actor_b','beta');
  const shared=createYjsSharedState({runtime:runtime()});
  const merged=await shared.merge({...base,updates:[a,b]});
  const peer={bytes:merged.state_vector,stateVectorSha256:merged.state_vector_sha256};
  const out=await shared.merge({...base,updates:[a,b],peerStateVector:peer});
  assert.ok(out.delta_update instanceof Uint8Array); assert.ok(/^[a-f0-9]{64}$/.test(out.delta_update_sha256));
  assert.equal(out.external_action_executed,false); assert.equal(out.persistence_authority,false);
});

test('cross-project/work/document envelopes and digest mismatches fail closed before runtime merge',async()=>{
  const a=await env('update_a','actor_a','alpha');
  for(const change of [{projectId:'other_project'},{workId:'other_work'},{documentId:'other_doc'},{updateSha256:'f'.repeat(64)}]){
    const bad={...a,...change}; const rt=runtime(); let called=0; const orig=rt.mergeUpdates; rt.mergeUpdates=(xs)=>{called++;return orig(xs);};
    await assert.rejects(()=>createYjsSharedState({runtime:rt}).merge({...base,updates:[bad]}));
    assert.equal(called,0);
  }
});

test('runtime version drift, malformed binary, duplicate update IDs and peer vector tamper fail closed',async()=>{
  const a=await env('update_a','actor_a','alpha');
  assert.throws(()=>createYjsSharedState({runtime:{...runtime(),version:'13.6.34'}}),/version mismatch/);
  await assert.rejects(()=>createYjsSharedState({runtime:runtime()}).merge({...base,updates:[{...a,bytes:'not-bytes'}]}),/Uint8Array/);
  await assert.rejects(()=>createYjsSharedState({runtime:runtime()}).merge({...base,updates:[a,a]}),/unique/);
  const good=await createYjsSharedState({runtime:runtime()}).merge({...base,updates:[a]});
  await assert.rejects(()=>createYjsSharedState({runtime:runtime()}).merge({...base,updates:[a],peerStateVector:{bytes:good.state_vector,stateVectorSha256:'0'.repeat(64)}}),/digest mismatch/);
});

test('resource limits and empty updates fail closed',async()=>{
  const shared=createYjsSharedState({runtime:runtime()});
  await assert.rejects(()=>shared.merge({...base,updates:[]}),/updates required/);
  const huge=new Uint8Array(4*1024*1024+1); const bad={projectId:base.projectId,workId:base.workId,documentId:base.documentId,updateId:'huge',actorId:'actor',updateSha256:await sha(huge),bytes:huge};
  await assert.rejects(()=>shared.merge({...base,updates:[bad]}),/exceeds/);
});

test('health is version/provider state only and cannot certify AXIOM',()=>{
  const health=createYjsSharedState({runtime:runtime()}).health();
  assert.equal(health.provider_status,'UP'); assert.equal(health.provider,'YJS'); assert.equal(health.provider_version,'13.6.33');
  assert.equal(health.axiom_authority,'NONE'); assert.equal(health.axiom_certification,'NOT_PROVEN'); assert.equal(health.live_runtime_qualification,'NOT_PROVEN');
});

test('unknown envelope fields and runtime authority claims are rejected',async()=>{
  const a=await env('update_a','actor_a','alpha');
  const rt=runtime();let called=0;const orig=rt.mergeUpdates;rt.mergeUpdates=(xs)=>{called++;return orig(xs);};
  await assert.rejects(()=>createYjsSharedState({runtime:rt}).merge({...base,updates:[{...a,api_key:'must-not-cross'}]}),/unsupported fields/);
  assert.equal(called,0);
  assert.throws(()=>createYjsSharedState({runtime:{...runtime(),release_authority:true}}),/forbidden authority/);
});

test('malformed or oversized runtime outputs fail closed',async()=>{
  const a=await env('update_a','actor_a','alpha');
  await assert.rejects(()=>createYjsSharedState({runtime:{...runtime(),mergeUpdates(){return 'bad';}}}).merge({...base,updates:[a]}),/Uint8Array/);
  await assert.rejects(()=>createYjsSharedState({runtime:{...runtime(),encodeStateVectorFromUpdate(){return 'bad';}}}).merge({...base,updates:[a]}),/Uint8Array/);
  await assert.rejects(()=>createYjsSharedState({runtime:{...runtime(),mergeUpdates(){return new Uint8Array(16*1024*1024+1);}}}).merge({...base,updates:[a]}),/exceeds/);
});
