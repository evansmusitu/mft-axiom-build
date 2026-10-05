import {createHash} from 'node:crypto';
import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const PGVECTOR_VECTOR_INDEX_DESCRIPTOR=Object.freeze({
  kind:'VectorIndexBackend',adapter_version:'1.0.0',provider:'pgvector',provider_baseline:'0.8.6',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',capabilities:Object.freeze(['upsert','query','tombstone','export']),
  unsupported_operations:Object.freeze(['authority_grant','release_decision','silent_fallback','credential_storage']),
  timeout_ms:15000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'REQUEST_FINGERPRINT_AND_OPTIMISTIC_VERSION'}),data_classification:Object.freeze(['project-private','work-private']),
  egress:Object.freeze({required:false,allowed_origins:Object.freeze([])}),identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),health:Object.freeze({mode:'EXPLICIT'}),
  migration_export:Object.freeze({supported:true,format:'AXIOM_VECTOR_INDEX_JSON_V1'}),fail_closed:true,
  live_runtime_qualification:'NOT_PROVEN',release_authority:false,production_authority:false,certification_authority:false,
});
assertAdapterDescriptor(PGVECTOR_VECTOR_INDEX_DESCRIPTOR,{expectedKind:'VectorIndexBackend'});

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/;
const ensureId=(name,value)=>{const v=String(value??'').trim();if(!ID.test(v))throw new TypeError(`${name} invalid`);return v;};
const ensureDimension=value=>{if(!Number.isInteger(value)||value<1||value>2000)throw new TypeError('dimension must be an integer between 1 and 2000');return value;};
const ensureVector=(value,dimension)=>{
  if(!Array.isArray(value)||value.length!==dimension)throw new TypeError(`vector must contain exactly ${dimension} dimensions`);
  return Object.freeze(value.map((item,index)=>{const n=Number(item);if(!Number.isFinite(n))throw new TypeError(`vector[${index}] must be finite`);return n;}));
};
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonicalVector=vector=>`[${vector.map(value=>Object.is(value,-0)?'0':Number(value).toString()).join(',')}]`;

export function deriveVectorRecordIdentity({projectId,workId,indexId,content,vector,dimension}){
  projectId=ensureId('projectId',projectId);workId=ensureId('workId',workId);indexId=ensureId('indexId',indexId);dimension=ensureDimension(dimension);
  const normalizedContent=String(content??'');
  if(!normalizedContent.length)throw new TypeError('content required');
  vector=ensureVector(vector,dimension);
  const content_hash=digest(normalizedContent);
  const vector_hash=digest(canonicalVector(vector));
  const record_id=`vec_${digest([projectId,workId,indexId,content_hash].join('\u0000'))}`;
  return Object.freeze({record_id,content_hash,vector_hash,vector_dimension:dimension});
}
const METRICS=Object.freeze({cosine:'<=>',l2:'<->',inner_product:'<#>'});
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function rejectCredentialMaterial(value,path='metadata'){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key))throw new DOMException(`${path}.${key} contains forbidden credential material`,'SecurityError');
    rejectCredentialMaterial(child,`${path}.${key}`);
  }
}
function stable(value){
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(isPlainObject(value))return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const ensureExpectedVersion=value=>{if(!Number.isInteger(value)||value<0)throw new TypeError('expectedVersion must be a non-negative integer');return value;};

export function createPgvectorVectorIndexBackend({pool,dimension,metric='cosine'}={}){
  if(!pool||typeof pool.connect!=='function')throw new TypeError('PostgreSQL pool.connect implementation required');
  dimension=ensureDimension(dimension);
  if(!(metric in METRICS))throw new TypeError('metric must be one of cosine, l2, inner_product');

  async function withClient(work){
    const client=await pool.connect();
    if(!client||typeof client.query!=='function')throw new TypeError('PostgreSQL client.query implementation required');
    try{return await work(client);}finally{if(typeof client.release==='function')client.release();}
  }

  const backend={
    descriptor:PGVECTOR_VECTOR_INDEX_DESCRIPTOR,
    dimension,
    metric,

    async upsertVector({projectId,workId,indexId,requestId,content,vector,metadata={},expectedVersion}={}){
      projectId=ensureId('projectId',projectId);workId=ensureId('workId',workId);indexId=ensureId('indexId',indexId);requestId=ensureId('requestId',requestId);
      expectedVersion=ensureExpectedVersion(expectedVersion);
      if(!isPlainObject(metadata))throw new TypeError('metadata must be a plain object');
      rejectCredentialMaterial(metadata);
      const identity=deriveVectorRecordIdentity({projectId,workId,indexId,content,vector,dimension});
      vector=ensureVector(vector,dimension);
      const vectorLiteral=canonicalVector(vector);
      const requestFingerprint=digest(stable({operation:'UPSERT',projectId,workId,indexId,requestId,expectedVersion,identity,metadata,metric}));
      const result=Object.freeze({
        status:'WRITTEN',project_id:projectId,work_id:workId,index_id:indexId,record_id:identity.record_id,
        content_hash:identity.content_hash,vector_hash:identity.vector_hash,vector_dimension:dimension,metric,version:expectedVersion+1,
        tombstoned:false,evidence_state:'COMPUTED',authority_effect:'NONE',live_runtime_qualification:'NOT_PROVEN',
      });

      return withClient(async client=>{
        let transaction=false;
        try{
          await client.query('BEGIN');transaction=true;
          const insertedConfig=await client.query(
            'INSERT INTO axiom_pi.vector_index_configs (project_id,work_id,index_id,metric,dimension) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (project_id,work_id,index_id) DO NOTHING RETURNING metric,dimension',
            [projectId,workId,indexId,metric,dimension],
          );
          let config=insertedConfig.rows?.[0]??null;
          if(!config){
            const existingConfig=await client.query(
              'SELECT metric,dimension FROM axiom_pi.vector_index_configs WHERE project_id=$1 AND work_id=$2 AND index_id=$3 FOR SHARE',
              [projectId,workId,indexId],
            );
            config=existingConfig.rows?.[0]??null;
          }
          if(!config||String(config.metric)!==metric||Number(config.dimension)!==dimension)throw new Error('vector index configuration mismatch');
          const prior=await client.query(
            'SELECT request_fingerprint, result FROM axiom_pi.vector_write_requests WHERE project_id=$1 AND work_id=$2 AND index_id=$3 AND request_id=$4 FOR UPDATE',
            [projectId,workId,indexId,requestId],
          );
          if(prior.rows?.length){
            if(prior.rows[0].request_fingerprint!==requestFingerprint)throw new DOMException('idempotency request fingerprint mismatch','SecurityError');
            await client.query('COMMIT');transaction=false;
            return Object.freeze(structuredClone(prior.rows[0].result));
          }
          const current=await client.query(
            'SELECT version, tombstoned, content_hash, vector_hash FROM axiom_pi.vector_entries WHERE project_id=$1 AND work_id=$2 AND index_id=$3 AND record_id=$4 FOR UPDATE',
            [projectId,workId,indexId,identity.record_id],
          );
          if(current.rows?.length&&Number(current.rows[0].version)!==expectedVersion)throw new Error(`vector version conflict: expected ${expectedVersion}, current ${Number(current.rows[0].version)}`);
          if(!current.rows?.length&&expectedVersion!==0)throw new Error(`vector version conflict: expected ${expectedVersion}, current 0`);
          const written=await client.query(
            `INSERT INTO axiom_pi.vector_entries
              (project_id,work_id,index_id,metric,record_id,content_hash,vector_hash,embedding,dimension,content,version,metadata,tombstoned,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10,1,$11::jsonb,FALSE,CURRENT_TIMESTAMP)
             ON CONFLICT (project_id,work_id,index_id,record_id) DO UPDATE SET
               metric=EXCLUDED.metric,vector_hash=EXCLUDED.vector_hash,embedding=EXCLUDED.embedding,dimension=EXCLUDED.dimension,
               content=EXCLUDED.content,version=axiom_pi.vector_entries.version+1,metadata=EXCLUDED.metadata,tombstoned=FALSE,tombstoned_at=NULL,updated_at=CURRENT_TIMESTAMP
             WHERE axiom_pi.vector_entries.version=$12
             RETURNING version`,
            [projectId,workId,indexId,metric,identity.record_id,identity.content_hash,identity.vector_hash,vectorLiteral,dimension,String(content),JSON.stringify(metadata),expectedVersion],
          );
          if(Number(written.rowCount??written.rows?.length??0)!==1)throw new Error('vector optimistic write conflict');
          await client.query(
            'INSERT INTO axiom_pi.vector_write_requests (project_id,work_id,index_id,request_id,request_fingerprint,result) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
            [projectId,workId,indexId,requestId,requestFingerprint,JSON.stringify(result)],
          );
          await client.query('COMMIT');transaction=false;
          return result;
        }catch(error){if(transaction){try{await client.query('ROLLBACK');}catch{}}throw error;}
      });
    },

    async tombstoneVector({projectId,workId,indexId,recordId,requestId,expectedVersion}={}){
      projectId=ensureId('projectId',projectId);workId=ensureId('workId',workId);indexId=ensureId('indexId',indexId);requestId=ensureId('requestId',requestId);
      if(!/^vec_[a-f0-9]{64}$/.test(String(recordId??'')))throw new TypeError('recordId invalid');
      expectedVersion=ensureExpectedVersion(expectedVersion);
      if(expectedVersion<1)throw new TypeError('tombstone expectedVersion must be at least 1');
      const requestFingerprint=digest(stable({operation:'TOMBSTONE',projectId,workId,indexId,recordId,requestId,expectedVersion}));
      const result=Object.freeze({
        status:'TOMBSTONED',project_id:projectId,work_id:workId,index_id:indexId,record_id:recordId,metric,
        version:expectedVersion+1,tombstoned:true,evidence_state:'COMPUTED',authority_effect:'NONE',live_runtime_qualification:'NOT_PROVEN',
      });
      return withClient(async client=>{
        let transaction=false;
        try{
          await client.query('BEGIN');transaction=true;
          const prior=await client.query(
            'SELECT request_fingerprint, result FROM axiom_pi.vector_write_requests WHERE project_id=$1 AND work_id=$2 AND index_id=$3 AND request_id=$4 FOR UPDATE',
            [projectId,workId,indexId,requestId],
          );
          if(prior.rows?.length){
            if(prior.rows[0].request_fingerprint!==requestFingerprint)throw new DOMException('idempotency request fingerprint mismatch','SecurityError');
            await client.query('COMMIT');transaction=false;
            return Object.freeze(structuredClone(prior.rows[0].result));
          }
          const current=await client.query(
            'SELECT version, tombstoned, content_hash, vector_hash FROM axiom_pi.vector_entries WHERE project_id=$1 AND work_id=$2 AND index_id=$3 AND record_id=$4 FOR UPDATE',
            [projectId,workId,indexId,recordId],
          );
          if(!current.rows?.length)throw new Error('vector record not found in scoped project/work index');
          if(Number(current.rows[0].version)!==expectedVersion)throw new Error(`vector version conflict: expected ${expectedVersion}, current ${Number(current.rows[0].version)}`);
          if(current.rows[0].tombstoned===true)throw new Error('vector record already tombstoned without matching idempotency evidence');
          const updated=await client.query(
            'UPDATE axiom_pi.vector_entries SET tombstoned=TRUE,tombstoned_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE project_id=$1 AND work_id=$2 AND index_id=$3 AND record_id=$4 AND version=$5 AND tombstoned=FALSE RETURNING version',
            [projectId,workId,indexId,recordId,expectedVersion],
          );
          if(Number(updated.rowCount??updated.rows?.length??0)!==1)throw new Error('vector tombstone optimistic write conflict');
          await client.query(
            'INSERT INTO axiom_pi.vector_write_requests (project_id,work_id,index_id,request_id,request_fingerprint,result) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
            [projectId,workId,indexId,requestId,requestFingerprint,JSON.stringify(result)],
          );
          await client.query('COMMIT');transaction=false;
          return result;
        }catch(error){if(transaction){try{await client.query('ROLLBACK');}catch{}}throw error;}
      });
    },

    async exportIndex({projectId,workId,indexId}={}){
      projectId=ensureId('projectId',projectId);workId=ensureId('workId',workId);indexId=ensureId('indexId',indexId);
      return withClient(async client=>{
        const exported=await client.query(
          'SELECT record_id,content_hash,vector_hash,content,metric,dimension,embedding::text AS embedding,version,metadata,tombstoned,tombstoned_at FROM axiom_pi.vector_entries WHERE project_id=$1 AND work_id=$2 AND index_id=$3 ORDER BY record_id',
          [projectId,workId,indexId],
        );
        const records=(exported.rows??[]).map(row=>{
          let vector;
          try{vector=JSON.parse(String(row.embedding));}catch{throw new Error('pgvector export returned invalid vector text');}
          if(!Array.isArray(vector)||vector.some(value=>!Number.isFinite(Number(value))))throw new Error('pgvector export returned invalid vector values');
          return Object.freeze({
            record_id:String(row.record_id),content_hash:String(row.content_hash),vector_hash:String(row.vector_hash),content:String(row.content??''),
            metric:String(row.metric),dimension:Number(row.dimension),vector:Object.freeze(vector.map(Number)),version:Number(row.version),
            metadata:structuredClone(row.metadata??{}),tombstoned:row.tombstoned===true,tombstoned_at:row.tombstoned_at??null,
          });
        });
        return Object.freeze({
          schema:'musitu.axiom.vector-index-export.v1',project_id:projectId,work_id:workId,index_id:indexId,
          records:Object.freeze(records),evidence_state:'COMPUTED',authority_effect:'NONE',live_runtime_qualification:'NOT_PROVEN',
        });
      });
    },

    async health(){
      try{
        return await withClient(async client=>{
          const checked=await client.query("SELECT extversion FROM pg_extension WHERE extname='vector'");
          const observed=checked.rows?.length?String(checked.rows[0].extversion??''):null;
          return Object.freeze({
            status:observed==='0.8.6'?'PASS':'FAIL',provider:'pgvector',expected_version:'0.8.6',observed_version:observed,
            evidence_state:'COMPUTED',authority_effect:'NONE',live_runtime_qualification:'NOT_PROVEN',
          });
        });
      }catch(error){
        return Object.freeze({
          status:'FAIL',provider:'pgvector',expected_version:'0.8.6',observed_version:null,
          evidence_state:'COMPUTED',authority_effect:'NONE',live_runtime_qualification:'NOT_PROVEN',reason:String(error?.message??error),
        });
      }
    },

    async searchNearest({projectId,workId,indexId,vector,limit=10}={}){
      projectId=ensureId('projectId',projectId);workId=ensureId('workId',workId);indexId=ensureId('indexId',indexId);
      vector=ensureVector(vector,dimension);
      if(!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('limit must be an integer between 1 and 100');
      const vectorLiteral=canonicalVector(vector);
      const operator=METRICS[metric];
      return withClient(async client=>{
        const found=await client.query(
          `SELECT record_id,content_hash,vector_hash,content,version,metadata,embedding ${operator} $6::vector AS raw_distance
           FROM axiom_pi.vector_entries
           WHERE project_id=$1 AND work_id=$2 AND index_id=$3 AND metric=$4 AND dimension=$5 AND tombstoned=FALSE
           ORDER BY embedding ${operator} $6::vector, record_id
           LIMIT $7`,
          [projectId,workId,indexId,metric,dimension,vectorLiteral,limit],
        );
        const results=(found.rows??[]).map(row=>{
          const rank=Number(row.raw_distance);
          if(!Number.isFinite(rank))throw new Error('pgvector returned non-finite rank value');
          return Object.freeze({
            record_id:String(row.record_id),content_hash:String(row.content_hash),vector_hash:String(row.vector_hash),
            content:String(row.content??''),version:Number(row.version),metadata:structuredClone(row.metadata??{}),rank_value:rank,
          });
        });
        return Object.freeze({
          project_id:projectId,work_id:workId,index_id:indexId,metric,vector_dimension:dimension,
          rank_semantics:'ASCENDING_LOWER_IS_BETTER',results:Object.freeze(results),evidence_state:'COMPUTED',
          authority_effect:'NONE',live_runtime_qualification:'NOT_PROVEN',
        });
      });
    },
  };
  return Object.freeze(backend);
}
