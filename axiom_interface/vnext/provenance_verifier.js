const HEX64=/^[a-f0-9]{64}$/i;
const clone=value=>structuredClone(value);
function arr(value){return Array.isArray(value)?value:[];}
function ids(rows,key){return new Map(arr(rows).map(row=>[row?.[key],row]).filter(([id])=>typeof id==='string'&&id));}
function fail(errors,code,detail={}){errors.push(Object.freeze({code,...detail}));}
export const FA08_PROVENANCE_SCHEMA='musitu.axiom.fa08.provenance-verification.v1';
export function verifyProjectWorkMemoryProvenance({graph,project_chain_verified=false,contracts=[],contract_integrity={},memories=[],memory_integrity=null}={}){
  const errors=[];
  const project=graph?.project||null;
  const objects=arr(graph?.objects);
  const edges=arr(graph?.edges);
  const objectById=ids(objects,'object_id');
  const projectId=project?.project_id||null;
  if(!projectId) fail(errors,'PROJECT_MISSING');
  if(project_chain_verified!==true) fail(errors,'PROJECT_EVENT_CHAIN_INVALID');
  for(const contract of arr(contracts)){
    const contractId=contract?.contract_id||'unknown';
    if(contract?.project_id!==projectId) fail(errors,'WORK_PROJECT_MISMATCH',{contract_id:contractId});
    if(contract_integrity?.[contractId]!==true) fail(errors,'WORK_HASH_INVALID',{contract_id:contractId});
    if(!HEX64.test(String(contract?.contract_sha256||''))) fail(errors,'WORK_HASH_FORMAT_INVALID',{contract_id:contractId});
    const task=objectById.get(contract?.project_object_id);
    if(!task||task.type!=='task'){
      fail(errors,'WORK_PROJECT_OBJECT_MISSING',{contract_id:contractId,object_id:contract?.project_object_id||null});
      continue;
    }
    const expectedSource=`outcome-contract:${contract.contract_sha256}`;
    if(task.provenance?.source!==expectedSource) fail(errors,'WORK_PROVENANCE_SOURCE_MISMATCH',{contract_id:contractId,object_id:task.object_id});
    const evidence=new Set(arr(task.evidence_links));
    if(!evidence.has(`contract:${contractId}`)) fail(errors,'WORK_CONTRACT_EVIDENCE_MISSING',{contract_id:contractId,object_id:task.object_id});
    if(!evidence.has(`sha256:${contract.contract_sha256}`)) fail(errors,'WORK_HASH_EVIDENCE_MISSING',{contract_id:contractId,object_id:task.object_id});
  }
  for(const memory of arr(memories)){
    const memoryId=memory?.memory_id||'unknown';
    if(memory?.project_id!==projectId) fail(errors,'MEMORY_PROJECT_MISMATCH',{memory_id:memoryId});
    if(!HEX64.test(String(memory?.record_sha256||''))) fail(errors,'MEMORY_HASH_FORMAT_INVALID',{memory_id:memoryId});
    const node=objectById.get(memory?.project_object_id);
    if(!node||node.type!=='memory'){
      fail(errors,'MEMORY_PROJECT_OBJECT_MISSING',{memory_id:memoryId,object_id:memory?.project_object_id||null});
      continue;
    }
    if(node.provenance?.source!==memory?.consent_source) fail(errors,'MEMORY_CONSENT_PROVENANCE_MISMATCH',{memory_id:memoryId,object_id:node.object_id});
    const nodeEvidence=new Set(arr(node.evidence_links));
    for(const sourceRef of arr(memory?.source_refs)){
      if(!objectById.has(sourceRef)) fail(errors,'MEMORY_SOURCE_OBJECT_MISSING',{memory_id:memoryId,source_ref:sourceRef});
      if(!nodeEvidence.has(sourceRef)) fail(errors,'MEMORY_SOURCE_EVIDENCE_MISSING',{memory_id:memoryId,source_ref:sourceRef});
      const edge=edges.find(row=>row?.from_id===node.object_id&&row?.to_id===sourceRef&&row?.relation==='derived-from');
      if(!edge) fail(errors,'MEMORY_DERIVED_FROM_EDGE_MISSING',{memory_id:memoryId,source_ref:sourceRef});
      else if(edge.provenance?.source!==memory?.consent_source) fail(errors,'MEMORY_EDGE_PROVENANCE_MISMATCH',{memory_id:memoryId,source_ref:sourceRef,edge_id:edge.edge_id||null});
    }
    if(memory?.revoked===true&&memory?.scope!=='do_not_use') fail(errors,'MEMORY_REVOCATION_SCOPE_MISMATCH',{memory_id:memoryId});
    if(memory?.scope==='do_not_use'&&memory?.revoked!==true) fail(errors,'MEMORY_DO_NOT_USE_NOT_REVOKED',{memory_id:memoryId});
  }
  if(memory_integrity?.status!=='PASS') fail(errors,'MEMORY_STORE_INTEGRITY_FAILED',{store_status:memory_integrity?.status||'MISSING'});
  const result={schema:FA08_PROVENANCE_SCHEMA,status:errors.length?'FAIL':'PASS',project_id:projectId,project_event_chain_verified:project_chain_verified===true,work_contracts_checked:arr(contracts).length,memories_checked:arr(memories).length,memory_store_integrity:memory_integrity?.status||'MISSING',errors};
  return Object.freeze(clone(result));
}
