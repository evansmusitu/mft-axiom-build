export const YJS_SHARED_STATE_DESCRIPTOR=Object.freeze({
  substrate:'SharedStateCRDT',provider:'yjs',provider_baseline:'13.6.33',semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['merge-updates','encode-state-vector-from-update','diff-update','health']),
  unsupported_operations:Object.freeze(['persistence-authority','identity-authority','policy-authority','canonical-evidence-certification','release-authority','production-promotion','presence-protocol']),
  max_update_bytes:4*1024*1024,max_batch_updates:128,max_batch_bytes:16*1024*1024,max_state_vector_bytes:1024*1024,
  persistence_authority:false,canonical_evidence_authority:false,identity_authority:false,policy_authority:false,
  release_authority:false,production_authority:false,certification_authority:false,live_runtime_qualification:'NOT_PROVEN',fail_closed:true,
});

const HASH=/^[a-f0-9]{64}$/i;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/;
const UPDATE_KEYS=new Set(['projectId','workId','documentId','updateId','actorId','updateSha256','bytes']);
const PEER_KEYS=new Set(['bytes','stateVectorSha256']);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=300)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function id(name,value){const v=clean(value);if(!ID.test(v))throw new TypeError(name+' invalid');return v;}
function digest(name,value){const v=clean(value,64).toLowerCase();if(!HASH.test(v))throw new TypeError(name+' required');return v;}
function bytes(name,value,{max,allowEmpty=false}={}){
  if(!(value instanceof Uint8Array))throw new TypeError(name+' must be Uint8Array');
  if(!allowEmpty&&value.byteLength===0)throw new TypeError(name+' must not be empty');
  if(Number.isInteger(max)&&value.byteLength>max)throw new RangeError(name+' exceeds byte limit');
  return new Uint8Array(value);
}
async function sha256(value){
  const d=await crypto.subtle.digest('SHA-256',value);
  return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function rejectUnknownKeys(value,allowed,label){
  const extra=Object.keys(value).filter(key=>!allowed.has(key));
  if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');
}
function assertRuntime(runtime){
  if(!runtime||typeof runtime!=='object')throw new TypeError('Yjs runtime required');
  if(clean(runtime.version,40)!==YJS_SHARED_STATE_DESCRIPTOR.provider_baseline)throw new TypeError('Yjs runtime version mismatch');
  for(const method of ['mergeUpdates','encodeStateVectorFromUpdate','diffUpdate'])if(typeof runtime[method]!=='function')throw new TypeError('Yjs runtime.'+method+' required');
  for(const key of ['release_authority','production_authority','certification_authority','persistence_authority','identity_authority','policy_authority']){
    if(runtime[key]===true)throw new DOMException('Yjs runtime attempted forbidden authority: '+key,'SecurityError');
  }
}

export function createYjsSharedState({runtime}={}){
  assertRuntime(runtime);
  return Object.freeze({
    descriptor:YJS_SHARED_STATE_DESCRIPTOR,
    async merge({projectId,workId,documentId,requestId,updates,peerStateVector=null}={}){
      const project_id=id('projectId',projectId),work_id=id('workId',workId),document_id=id('documentId',documentId),request_id=id('requestId',requestId);
      if(!Array.isArray(updates)||updates.length===0)throw new TypeError('updates required');
      if(updates.length>YJS_SHARED_STATE_DESCRIPTOR.max_batch_updates)throw new RangeError('updates exceed batch count limit');
      const seen=new Set(),normalized=[];let total=0;
      for(const [index,item] of updates.entries()){
        if(!isPlainObject(item))throw new TypeError('updates['+index+'] must be a plain object');
        rejectUnknownKeys(item,UPDATE_KEYS,'updates['+index+']');
        if(id('updates['+index+'].projectId',item.projectId)!==project_id)throw new DOMException('cross-project Yjs update blocked','SecurityError');
        if(id('updates['+index+'].workId',item.workId)!==work_id)throw new DOMException('cross-work Yjs update blocked','SecurityError');
        if(id('updates['+index+'].documentId',item.documentId)!==document_id)throw new DOMException('cross-document Yjs update blocked','SecurityError');
        const update_id=id('updates['+index+'].updateId',item.updateId);if(seen.has(update_id))throw new TypeError('updateId must be unique');seen.add(update_id);
        const actor_id=id('updates['+index+'].actorId',item.actorId);
        const update_sha256=digest('updates['+index+'].updateSha256',item.updateSha256);
        const update_bytes=bytes('updates['+index+'].bytes',item.bytes,{max:YJS_SHARED_STATE_DESCRIPTOR.max_update_bytes});
        total+=update_bytes.byteLength;if(total>YJS_SHARED_STATE_DESCRIPTOR.max_batch_bytes)throw new RangeError('updates exceed batch byte limit');
        const actual=await sha256(update_bytes);if(actual!==update_sha256)throw new DOMException('Yjs update digest mismatch','DataError');
        normalized.push({update_id,actor_id,update_sha256,bytes:update_bytes});
      }
      normalized.sort((a,b)=>a.update_sha256.localeCompare(b.update_sha256)||a.update_id.localeCompare(b.update_id));

      let peer=null;
      if(peerStateVector!==null&&peerStateVector!==undefined){
        if(!isPlainObject(peerStateVector))throw new TypeError('peerStateVector must be a plain object');
        rejectUnknownKeys(peerStateVector,PEER_KEYS,'peerStateVector');
        const state_vector_sha256=digest('peerStateVector.stateVectorSha256',peerStateVector.stateVectorSha256);
        const peer_bytes=bytes('peerStateVector.bytes',peerStateVector.bytes,{max:YJS_SHARED_STATE_DESCRIPTOR.max_state_vector_bytes});
        if((await sha256(peer_bytes))!==state_vector_sha256)throw new DOMException('peer state vector digest mismatch','DataError');
        peer={bytes:peer_bytes,state_vector_sha256};
      }

      const merged_update=bytes('runtime merged update',runtime.mergeUpdates(normalized.map(item=>item.bytes)),{max:YJS_SHARED_STATE_DESCRIPTOR.max_batch_bytes});
      const state_vector=bytes('runtime state vector',runtime.encodeStateVectorFromUpdate(merged_update),{max:YJS_SHARED_STATE_DESCRIPTOR.max_state_vector_bytes,allowEmpty:true});
      const delta_update=peer?bytes('runtime delta update',runtime.diffUpdate(merged_update,peer.bytes),{max:YJS_SHARED_STATE_DESCRIPTOR.max_batch_bytes,allowEmpty:true}):new Uint8Array(merged_update);
      const merged_update_sha256=await sha256(merged_update),state_vector_sha256=await sha256(state_vector),delta_update_sha256=await sha256(delta_update);
      return Object.freeze({
        schema:'musitu.axiom.yjs-shared-state.v1',project_id,work_id,document_id,request_id,provider:'YJS',provider_version:YJS_SHARED_STATE_DESCRIPTOR.provider_baseline,
        input_update_ids:Object.freeze(normalized.map(item=>item.update_id).sort()),input_update_sha256:Object.freeze(normalized.map(item=>item.update_sha256).sort()),
        merged_update:new Uint8Array(merged_update),merged_update_sha256,state_vector:new Uint8Array(state_vector),state_vector_sha256,
        delta_update:new Uint8Array(delta_update),delta_update_sha256,peer_state_vector_sha256:peer?.state_vector_sha256??null,
        shared_state_status:'MERGED',persistence_state:'NOT_PERSISTED',canonical_evidence:false,external_action_executed:false,
        persistence_authority:false,identity_authority:false,policy_authority:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,
        live_runtime_qualification:'NOT_PROVEN',required_next_gate:'PERSIST_OR_ROUTE_UNDER_AXIOM_POLICY',
      });
    },
    health(){return Object.freeze({provider_status:'UP',provider:'YJS',provider_version:YJS_SHARED_STATE_DESCRIPTOR.provider_baseline,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'});},
  });
}
