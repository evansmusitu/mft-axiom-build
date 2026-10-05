import {createHash} from 'node:crypto';
import {createSlsaProvenanceStatement} from '../product_intelligence/signing_provenance.js';

export const NOW=Date.parse('2026-10-05T03:00:00Z');
export const scope={projectId:'project_12345678',workId:'work_12345678'};
export const digest='a'.repeat(64);
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const statement=()=>createSlsaProvenanceStatement({...scope,artifactName:'artifact.tar.zst',artifactDigestSha256:digest,builderIdentityId:'agent_builder_12345678',invocationId:'build_12345678',buildType:'https://mftintelligence.com/axiom/build/v1',externalParameters:{target:'linux-amd64'},resolvedDependencies:[{uri:'git+https://github.com/evansmusitu/mft-axiom-build@3182724b',digestSha256:'b'.repeat(64)}],startedOn:'2026-10-05T02:58:00Z',finishedOn:'2026-10-05T02:59:00Z'});
export const lease=()=>({schema:'musitu.axiom.secret-lease.v1',project_id:scope.projectId,workload_identity_id:'agent_signer_12345678',operation:'artifact.sign',secret_ref:'kv/axiom/signing',request_id:'lease_request_12345678',lease_id:'lease_12345678',credential_handle:'handle_12345678',expires_at:new Date(NOW+120000).toISOString(),plaintext_secret_released:false,authority_effect:'NONE',identity_authority:false,authorization_authority:false,production_authority:false});
export function signerClient(extra={}){const calls=[];return {calls,async signAttestation(input){calls.push(structuredClone(input));return {bundle_ref:'bundle://sigstore/12345678',bundle_sha256:'c'.repeat(64),signature_sha256:'d'.repeat(64),bundle_format:'SIGSTORE_BUNDLE_V3',...extra.sign};},async health(){return {status:'UP',cosign_version:'3.1.3',in_toto_version:'3.1.0',...extra.health};}};}
export function verifierClient(extra={}){const calls=[];return {calls,async verifyAttestation(input){calls.push(structuredClone(input));return {verified:true,artifact_digest_sha256:digest,statement_sha256:input.statement_sha256,bundle_sha256:'c'.repeat(64),bundle_format:'SIGSTORE_BUNDLE_V3',signer_identity_id:'agent_signer_12345678',...extra.verify};},async health(){return {status:'UP',cosign_version:'3.1.3',in_toto_version:'3.1.0',...extra.health};}};}
