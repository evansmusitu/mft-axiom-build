export const TREE_SITTER_CODE_INTELLIGENCE_PROFILE=Object.freeze({
  schema:'musitu.axiom.tree-sitter-code-intelligence-profile.v1',
  provider:'tree-sitter',tree_sitter_version:'0.27.0',query_profile:'AXIOM_CODE_SYMBOLS_V1',semantic_owner:'AXIOM',provider_authority:'MECHANISM_ONLY',network_egress:false,
  release_authority:false,production_authority:false,certification_authority:false,live_runtime_qualification:'NOT_PROVEN',
});
const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const idpart=value=>clean(value,160).replace(/[^A-Za-z0-9_.:-]/g,'-');
const AUTHORITY_KEYS=new Set(['release_authority','production_authority','certification_authority','allow_deploy','security_pass','certified','verified_release']);
function rejectProviderAuthority(value,path='tree_sitter_result'){if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(AUTHORITY_KEYS.has(key)&&child===true)throw new DOMException(`${path}.${key} attempted forbidden authority`,'SecurityError');rejectProviderAuthority(child,`${path}.${key}`);}}
async function rawSha256(value){const bytes=new TextEncoder().encode(String(value)),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function treeSitterCodeContextRecords({projectId,snapshot={},client}={}){
  const project_id=clean(projectId,300);if(!project_id)throw new TypeError('projectId required');
  const files=Array.isArray(snapshot.source_files)?snapshot.source_files:[];if(!files.length)return [];
  if(!client||typeof client.parse!=='function'||typeof client.health!=='function')throw new TypeError('Tree-sitter client parse and health required');
  const health=await client.health();rejectProviderAuthority(health,'tree_sitter_health');
  if(!health||typeof health!=='object'||String(health.status??'').toUpperCase()!=='UP'||clean(health.tree_sitter_version,40)!=='0.27.0')throw new DOMException('Tree-sitter 0.27.0 health requirement not met','InvalidStateError');
  const out=[],seenFileIds=new Set();
  for(const file of files){
    const file_id=clean(file.file_id,300),work_id=clean(file.work_id,300),path=clean(file.path,1000),language=clean(file.language,120).toLowerCase(),source=String(file.source??''),source_sha256=clean(file.source_sha256,64).toLowerCase();
    if(!file_id)throw new TypeError('file_id required');if(!work_id)throw new TypeError('work_id required');if(!path)throw new TypeError('path required');if(!language)throw new TypeError('language required');
    if(seenFileIds.has(file_id))throw new TypeError('duplicate source file_id');seenFileIds.add(file_id);
    if(await rawSha256(source)!==source_sha256)throw new DOMException('source digest mismatch','DataError');
    const raw=await client.parse({project_id,work_id,file_id,path,language,source,source_sha256,tree_sitter_version:'0.27.0',query_profile:'AXIOM_CODE_SYMBOLS_V1',network_egress:false,authority_effect:'NONE'});
    rejectProviderAuthority(raw);
    if(raw?.status!=='PARSED')throw new DOMException('Tree-sitter parse failed closed','DataError');
    if(raw?.project_id!==project_id||raw?.work_id!==work_id||raw?.file_id!==file_id)throw new DOMException('Tree-sitter project/work/file identity mismatch','DataError');
    if(clean(raw?.source_sha256,64).toLowerCase()!==source_sha256)throw new DOMException('Tree-sitter result source digest mismatch','DataError');
    if(clean(raw?.tree_sitter_version,40)!=='0.27.0')throw new DOMException('Tree-sitter result version mismatch','DataError');
    if(raw?.query_profile!=='AXIOM_CODE_SYMBOLS_V1')throw new DOMException('Tree-sitter query profile mismatch','DataError');
    if(clean(raw?.language,120).toLowerCase()!==language)throw new DOMException('Tree-sitter result language mismatch','DataError');
    const root_type=clean(raw?.root_type,120);if(!root_type)throw new TypeError('Tree-sitter root_type required');
    const node_count=Number(raw?.node_count),named_node_count=Number(raw?.named_node_count);
    if(!Number.isInteger(node_count)||node_count<1||!Number.isInteger(named_node_count)||named_node_count<0||named_node_count>node_count)throw new TypeError('Tree-sitter node counts invalid');
    const byteLength=new TextEncoder().encode(source).length;
    const symbols=(Array.isArray(raw?.captures)?raw.captures:[]).map((capture,index)=>{const kind=clean(capture?.kind,80),name=clean(capture?.name,300),node_type=clean(capture?.node_type,120);if(!kind||!name||!node_type)throw new TypeError(`Tree-sitter captures[${index}] capture identity invalid`);const start_byte=Number(capture?.start_byte),end_byte=Number(capture?.end_byte);if(!Number.isInteger(start_byte)||!Number.isInteger(end_byte)||start_byte<0||end_byte<start_byte||end_byte>byteLength)throw new TypeError(`Tree-sitter captures[${index}] byte range invalid`);return Object.freeze({kind,name,node_type,start_byte,end_byte});});
    const observed_at=file.observed_at??null;
    out.push(Object.freeze({projectId:project_id,nodeId:`ctx:code:tree-sitter:${idpart(file_id)}`,domain:'code',title:`Syntax · ${path}`,sourceType:'tree-sitter-code',sourceId:file_id,content:Object.freeze({path,language,source_sha256,root_type,has_error:raw?.has_error===true,syntax_status:raw?.has_error===true?'ERROR_NODES_PRESENT':'CLEAN',node_count,named_node_count,symbols:Object.freeze(symbols)}),metadata:Object.freeze({work_id,provider:'tree-sitter',tree_sitter_version:'0.27.0',query_profile:'AXIOM_CODE_SYMBOLS_V1',semantic_owner:'AXIOM',provider_authority:'MECHANISM_ONLY',network_egress:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,live_runtime_qualification:'NOT_PROVEN'}),trust:'DERIVED_INDEX',asOf:observed_at,retrievedAt:observed_at}));
  }
  return Object.freeze(out);
}
