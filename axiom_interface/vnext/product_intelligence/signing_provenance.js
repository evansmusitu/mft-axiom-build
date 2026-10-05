import {createHash} from 'node:crypto';

export const SIGNING_PROVENANCE_PROFILE=Object.freeze({
  schema:'musitu.axiom.signing-provenance-profile.v1',
  cosign_version:'3.1.3',
  in_toto_version:'3.1.0',
  statement_type:'https://in-toto.io/Statement/v1',
  predicate_type:'https://slsa.dev/provenance/v1',
  semantic_owner:'AXIOM',
  provider_authority:'MECHANISM_ONLY',
  legacy_bundle_allowed:false,
  bundle_format:'SIGSTORE_BUNDLE_V3',
  release_authority:false,
  production_authority:false,
  certification_authority:false,
  live_runtime_qualification:'NOT_PROVEN',
});

const HASH=/^[a-f0-9]{64}$/i;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/;
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization$|api_?key$|password$|private_?key$|client_?secret$|secret(?:_value)?$/i;
const AUTHORITY_KEYS=new Set(['release_authority','production_authority','certification_authority','allow_deploy','security_pass','certified','verified_release']);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const sha256=value=>createHash('sha256').update(value).digest('hex');

function id(name,value){const v=clean(value,300);if(!ID.test(v))throw new TypeError(`${name} invalid`);return v;}
function hash(name,value){const v=clean(value,64).toLowerCase();if(!HASH.test(v))throw new TypeError(`${name} sha256 required`);return v;}
function iso(name,value,{required=false}={}){
  if(value===undefined||value===null||value===''){if(required)throw new TypeError(`${name} must be an ISO instant`);return null;}
  const ms=Date.parse(value);if(!Number.isFinite(ms))throw new TypeError(`${name} must be an ISO instant`);return new Date(ms).toISOString();
}
function rejectCredentials(value,path='input'){
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key)) throw new DOMException(`${path}.${key} contains forbidden credential material`,'SecurityError');
    rejectCredentials(child,`${path}.${key}`);
  }
}
function rejectAuthorityClaims(value,path='provider_result'){
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(AUTHORITY_KEYS.has(key)&&child===true) throw new DOMException(`${path}.${key} attempted forbidden authority`,'SecurityError');
    rejectAuthorityClaims(child,`${path}.${key}`);
  }
}
function stable(value){
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(isPlainObject(value)) return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function deepFreeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.freeze(value);
    for(const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function cloneJson(value,name='value'){
  try{return structuredClone(value);}catch{throw new TypeError(`${name} must be structured-cloneable`);}
}
function statementHash(statement){return sha256(stable(statement));}
function normalizeDependency(item,index){
  if(!isPlainObject(item)) throw new TypeError(`resolvedDependencies[${index}] must be a plain object`);
  const uri=clean(item.uri,2000);if(!uri)throw new TypeError(`resolvedDependencies[${index}].uri required`);
  const digestSha256=hash(`resolvedDependencies[${index}].digest`,item.digestSha256??item.digest?.sha256);
  const out={uri,digest:{sha256:digestSha256}};
  if(item.name!==undefined&&clean(item.name,500)) out.name=clean(item.name,500);
  return deepFreeze(out);
}
function assertStatementBinding(statement,{projectId,workId,artifactName,artifactDigestSha256}){
  if(!isPlainObject(statement)||statement._type!==SIGNING_PROVENANCE_PROFILE.statement_type||statement.predicateType!==SIGNING_PROVENANCE_PROFILE.predicate_type) throw new TypeError('in-toto SLSA provenance statement required');
  if(!Array.isArray(statement.subject)||statement.subject.length!==1) throw new TypeError('provenance must contain exactly one subject');
  const subject=statement.subject[0];
  if(subject?.name!==artifactName) throw new DOMException('provenance subject name mismatch','DataError');
  if(clean(subject?.digest?.sha256,64).toLowerCase()!==artifactDigestSha256) throw new DOMException('artifact digest mismatch: provenance subject digest mismatch','DataError');
  const external=statement.predicate?.buildDefinition?.externalParameters;
  if(!isPlainObject(external)||external.project_id!==projectId||external.work_id!==workId) throw new DOMException('provenance project/work binding mismatch','DataError');
  const builderIdentityId=id('statement builder id',statement.predicate?.runDetails?.builder?.id);
  const invocationId=id('statement invocation id',statement.predicate?.runDetails?.metadata?.invocationId);
  rejectCredentials(statement,'statement');
  return {builderIdentityId,invocationId,statementSha256:statementHash(statement)};
}

export function createSlsaProvenanceStatement({
  projectId,workId='',artifactName,artifactDigestSha256,builderIdentityId,invocationId,
  buildType='https://mftintelligence.com/axiom/build/v1',externalParameters={},internalParameters={},resolvedDependencies=[],
  startedOn=null,finishedOn=null,
}={}){
  const project_id=id('projectId',projectId),work_id=id('workId',workId),builder_id=id('builderIdentityId',builderIdentityId),invocation_id=id('invocationId',invocationId);
  const artifact_name=clean(artifactName,1000);if(!artifact_name)throw new TypeError('artifactName required');
  const artifact_digest_sha256=hash('artifactDigestSha256',artifactDigestSha256);
  const build_type=clean(buildType,2000);if(!build_type)throw new TypeError('buildType required');
  if(!isPlainObject(externalParameters)||!isPlainObject(internalParameters))throw new TypeError('provenance parameters must be plain objects');
  rejectCredentials(externalParameters,'externalParameters');rejectCredentials(internalParameters,'internalParameters');
  if(!Array.isArray(resolvedDependencies))throw new TypeError('resolvedDependencies must be an array');
  const dependencies=resolvedDependencies.map(normalizeDependency);
  const started=iso('startedOn',startedOn),finished=iso('finishedOn',finishedOn);
  if(started&&finished&&Date.parse(finished)<Date.parse(started))throw new TypeError('finishedOn must not precede startedOn');
  const external={...cloneJson(externalParameters,'externalParameters'),project_id,work_id};
  const metadata={invocationId:invocation_id};if(started)metadata.startedOn=started;if(finished)metadata.finishedOn=finished;
  return deepFreeze({
    _type:SIGNING_PROVENANCE_PROFILE.statement_type,
    subject:[{name:artifact_name,digest:{sha256:artifact_digest_sha256}}],
    predicateType:SIGNING_PROVENANCE_PROFILE.predicate_type,
    predicate:{
      buildDefinition:{buildType:build_type,externalParameters:external,internalParameters:cloneJson(internalParameters,'internalParameters'),resolvedDependencies:dependencies},
      runDetails:{builder:{id:builder_id},metadata},
    },
  });
}

function assertLease(lease,{projectId,workloadIdentityId,nowMs}){
  if(!isPlainObject(lease)||lease.schema!=='musitu.axiom.secret-lease.v1')throw new TypeError('SecretBroker lease required');
  rejectCredentials(Object.fromEntries(Object.entries(lease).filter(([key])=>key!=='credential_handle')),'credentialLease');
  if(lease.project_id!==projectId)throw new DOMException('cross-project credential lease blocked','SecurityError');
  if(lease.workload_identity_id!==workloadIdentityId)throw new DOMException('credential lease workload identity mismatch','SecurityError');
  if(lease.operation!=='artifact.sign')throw new DOMException('credential lease operation mismatch','SecurityError');
  if(lease.plaintext_secret_released!==false)throw new DOMException('plaintext credential lease forbidden','SecurityError');
  if(lease.authority_effect!=='NONE'||lease.identity_authority!==false||lease.authorization_authority!==false||lease.production_authority!==false)throw new DOMException('credential lease authority boundary invalid','SecurityError');
  const credentialHandle=id('credential_handle',lease.credential_handle),leaseId=id('lease_id',lease.lease_id),requestId=id('lease request_id',lease.request_id);
  const expires=Date.parse(lease.expires_at??'');if(!Number.isFinite(expires))throw new TypeError('credential lease expires_at invalid');
  if(expires<=nowMs)throw new DOMException('credential lease expired','SecurityError');
  if(expires>nowMs+305000)throw new DOMException('credential lease is not operation-scoped short-lived','SecurityError');
  return {credentialHandle,leaseId,leaseRequestId:requestId,expiresAt:new Date(expires).toISOString()};
}
function normalizeSignedProviderResult(raw){
  if(!isPlainObject(raw))throw new TypeError('cosign signing result required');
  rejectAuthorityClaims(raw);
  if(raw.bundle_format!==SIGNING_PROVENANCE_PROFILE.bundle_format)throw new DOMException('cosign bundle format mismatch','DataError');
  return {
    bundle_ref:id('bundle_ref',raw.bundle_ref),
    bundle_sha256:hash('bundle',raw.bundle_sha256),
    signature_sha256:hash('signature',raw.signature_sha256),
    bundle_format:raw.bundle_format,
  };
}

export function createCosignProvenanceSigner({client,clock=()=>Date.now()}={}){
  if(!client||typeof client.signAttestation!=='function'||typeof client.health!=='function')throw new TypeError('cosign client signAttestation and health required');
  return Object.freeze({
    async sign({projectId,workId='',artifactName,artifactDigestSha256,statement,workloadIdentityId,credentialLease,requestId}={}){
      const project_id=id('projectId',projectId),work_id=id('workId',workId),workload_identity_id=id('workloadIdentityId',workloadIdentityId),request_id=id('requestId',requestId);
      const artifact_name=clean(artifactName,1000);if(!artifact_name)throw new TypeError('artifactName required');
      const artifact_digest_sha256=hash('artifactDigestSha256',artifactDigestSha256);
      const bound=assertStatementBinding(statement,{projectId:project_id,workId:work_id,artifactName:artifact_name,artifactDigestSha256:artifact_digest_sha256});
      const nowMs=Number(clock());if(!Number.isFinite(nowMs))throw new TypeError('clock must return epoch milliseconds');
      const lease=assertLease(credentialLease,{projectId:project_id,workloadIdentityId:workload_identity_id,nowMs});
      const raw=await client.signAttestation({
        project_id,work_id,workload_identity_id,artifact_name,artifact_digest_sha256,
        statement:cloneJson(statement,'statement'),statement_sha256:bound.statementSha256,
        credential_handle:lease.credentialHandle,request_id,
        cosign_version:SIGNING_PROVENANCE_PROFILE.cosign_version,in_toto_version:SIGNING_PROVENANCE_PROFILE.in_toto_version,
        statement_type:SIGNING_PROVENANCE_PROFILE.statement_type,predicate_type:SIGNING_PROVENANCE_PROFILE.predicate_type,
        bundle_format:SIGNING_PROVENANCE_PROFILE.bundle_format,legacy_bundle_allowed:false,
      });
      const provider=normalizeSignedProviderResult(raw);
      return deepFreeze({
        schema:'musitu.axiom.signed-provenance.v1',project_id,work_id,artifact_name,artifact_digest_sha256,
        statement_sha256:bound.statementSha256,builder_identity_id:bound.builderIdentityId,signer_workload_identity_id:workload_identity_id,
        request_id,...provider,cosign_version:SIGNING_PROVENANCE_PROFILE.cosign_version,in_toto_version:SIGNING_PROVENANCE_PROFILE.in_toto_version,
        independent_verification:'NOT_PROVEN',evidence_state:'COMPUTED',authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,
        live_runtime_qualification:'NOT_PROVEN',
      });
    },
    async health(){
      try{
        const raw=await client.health();rejectAuthorityClaims(raw,'health');
        const cosign=clean(raw?.cosign_version,40),inToto=clean(raw?.in_toto_version,40),provider=clean(raw?.status,40).toUpperCase();
        const status=provider==='UP'&&cosign===SIGNING_PROVENANCE_PROFILE.cosign_version&&inToto===SIGNING_PROVENANCE_PROFILE.in_toto_version?'PASS':'FAIL';
        return Object.freeze({status,provider_status:provider||'UNKNOWN',cosign_version:cosign||null,in_toto_version:inToto||null,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'});
      }catch(error){return Object.freeze({status:'FAIL',provider_status:'ERROR',cosign_version:null,in_toto_version:null,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN',reason:String(error?.message??error)});}
    },
  });
}

function assertSignedEvidence(signed,{projectId,workId,artifactName,artifactDigestSha256,statementSha256,builderIdentityId}){
  if(!isPlainObject(signed)||signed.schema!=='musitu.axiom.signed-provenance.v1')throw new TypeError('signed provenance evidence required');
  rejectAuthorityClaims(signed,'signedEvidence');
  if(signed.project_id!==projectId||signed.work_id!==workId)throw new DOMException('signed evidence project/work mismatch','DataError');
  if(signed.artifact_name!==artifactName)throw new DOMException('signed evidence artifact name mismatch','DataError');
  if(signed.builder_identity_id!==builderIdentityId)throw new DOMException('signed evidence builder identity mismatch','DataError');
  if(signed.independent_verification!=='NOT_PROVEN'||signed.evidence_state!=='COMPUTED'||signed.authority_effect!=='NONE'||signed.release_authority!==false||signed.production_authority!==false||signed.certification_authority!==false)throw new DOMException('signed evidence authority/evidence boundary invalid','SecurityError');
  if(signed.artifact_digest_sha256!==artifactDigestSha256)throw new DOMException('signed evidence artifact digest mismatch','DataError');
  if(signed.statement_sha256!==statementSha256)throw new DOMException('signed evidence statement digest mismatch','DataError');
  if(signed.bundle_format!==SIGNING_PROVENANCE_PROFILE.bundle_format)throw new DOMException('signed evidence bundle format mismatch','DataError');
  if(signed.cosign_version!==SIGNING_PROVENANCE_PROFILE.cosign_version||signed.in_toto_version!==SIGNING_PROVENANCE_PROFILE.in_toto_version)throw new DOMException('signed evidence mechanism version mismatch','DataError');
  return {builderIdentityId:id('builder_identity_id',signed.builder_identity_id),signerIdentityId:id('signer_workload_identity_id',signed.signer_workload_identity_id),bundleRef:id('bundle_ref',signed.bundle_ref),bundleSha256:hash('bundle',signed.bundle_sha256),signatureSha256:hash('signature',signed.signature_sha256)};
}

export function createIndependentCosignProvenanceVerifier({client,verifierWorkloadIdentityId}={}){
  if(!client||typeof client.verifyAttestation!=='function')throw new TypeError('cosign verifier client verifyAttestation required');
  const verifier_identity_id=id('verifierWorkloadIdentityId',verifierWorkloadIdentityId);
  return Object.freeze({
    async verify({projectId,workId='',artifactDigestSha256,statement,signedEvidence}={}){
      const project_id=id('projectId',projectId),work_id=id('workId',workId),artifact_digest_sha256=hash('artifactDigestSha256',artifactDigestSha256);
      const artifactName=clean(statement?.subject?.[0]?.name,1000);if(!artifactName)throw new TypeError('provenance subject name required');
      const bound=assertStatementBinding(statement,{projectId:project_id,workId:work_id,artifactName,artifactDigestSha256:artifact_digest_sha256});
      const signed=assertSignedEvidence(signedEvidence,{projectId:project_id,workId:work_id,artifactName,artifactDigestSha256:artifact_digest_sha256,statementSha256:bound.statementSha256,builderIdentityId:bound.builderIdentityId});
      if(verifier_identity_id===bound.builderIdentityId||verifier_identity_id===signed.signerIdentityId)throw new DOMException('independent verifier must differ from builder and signer','NotAllowedError');
      const raw=await client.verifyAttestation({
        project_id,work_id,verifier_workload_identity_id:verifier_identity_id,artifact_digest_sha256,
        statement:cloneJson(statement,'statement'),statement_sha256:bound.statementSha256,
        bundle_ref:signed.bundleRef,bundle_sha256:signed.bundleSha256,signature_sha256:signed.signatureSha256,
        bundle_format:SIGNING_PROVENANCE_PROFILE.bundle_format,legacy_bundle_allowed:false,
        cosign_version:SIGNING_PROVENANCE_PROFILE.cosign_version,in_toto_version:SIGNING_PROVENANCE_PROFILE.in_toto_version,
        expected_signer_identity_id:signed.signerIdentityId,
      });
      if(!isPlainObject(raw))throw new TypeError('cosign verification result required');
      rejectAuthorityClaims(raw);
      if(raw.verified!==true)throw new DOMException('cosign independent verification failed','DataError');
      if(clean(raw.artifact_digest_sha256,64).toLowerCase()!==artifact_digest_sha256)throw new DOMException('verification artifact digest mismatch','DataError');
      if(clean(raw.statement_sha256,64).toLowerCase()!==bound.statementSha256)throw new DOMException('verification statement digest mismatch','DataError');
      if(clean(raw.bundle_sha256,64).toLowerCase()!==signed.bundleSha256)throw new DOMException('verification bundle digest mismatch','DataError');
      if(raw.bundle_format!==SIGNING_PROVENANCE_PROFILE.bundle_format)throw new DOMException('verification bundle format mismatch','DataError');
      if(id('verified signer identity',raw.signer_identity_id)!==signed.signerIdentityId)throw new DOMException('verification signer identity mismatch','DataError');
      return deepFreeze({
        schema:'musitu.axiom.provenance-independent-verification.v1',kind:'INDEPENDENT_VERIFIER',status:'PASS',independent_verification:'PASS',
        project_id,work_id,actor_id:verifier_identity_id,artifact_sha256:artifact_digest_sha256,statement_sha256:bound.statementSha256,bundle_sha256:signed.bundleSha256,
        signer_workload_identity_id:signed.signerIdentityId,builder_identity_id:bound.builderIdentityId,
        evidence_state:'VERIFIED',authority_effect:'VERIFICATION_ONLY',release_authority:false,production_authority:false,certification_authority:false,
        live_runtime_qualification:'NOT_PROVEN',
      });
    },
  });
}
