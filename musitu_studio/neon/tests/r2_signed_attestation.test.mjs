import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {verifyStudioR2ObjectBytes} from '../r2_content_reconcile.mjs';
import {attestStudioR2PinnedVersions,studioR2AttestationSigningBytes,
  verifyStudioR2SignedAttestation,createStudioR2ProviderReceiptVerifier} from '../r2_signed_attestation.mjs';
const freeze_id='synthetic-immutable-r2-freeze';
const run_id='synthetic-pinned-proof-20261024';
const head='a'.repeat(40),bucket='b'.repeat(64);
const project='a1111111-1111-4111-8111-111111111111';
const job='b2222222-2222-4222-8222-222222222222';
const object_key=`studio-v03/jobs/${job}/scene.glb`;
const bytes=Buffer.alloc(1200,19);
const hash=createHash('sha256').update(bytes).digest('hex');
const integrityKey=Buffer.alloc(32,2);
function source(){return {complete:true,freeze_id,
 projects:[{id:project,title:'demo',owner_sub:'synthetic-owner',created_at:'2026-10-24T00:00:00Z'}],
 memberships:[{project_id:project,member_sub:'synthetic-owner',role:'owner',created_at:'2026-10-24T00:00:00Z'}],
 jobs:[{id:job,project_id:project,submission_key:'synthetic-submit',payload_json:'{}',payload_sha256:'a'.repeat(64),render_device:'CPU',state:'RUNNING',created_by_sub:'synthetic-owner',approved_by_sub:'synthetic-owner',dispatched_by_sub:'synthetic-owner',call_id:'synthetic-call',error_code:null,created_at:'2026-10-24T00:00:00Z',approved_at:'2026-10-24T00:01:00Z',dispatched_at:'2026-10-24T00:02:00Z',finished_at:'2026-10-24T00:03:00Z'}],
 assets:[{job_id:job,filename:'scene.glb',object_key,sha256:hash,bytes:bytes.length}],
 audit_events:[{id:'c3333333-3333-4333-8333-333333333333',project_id:project,job_id:job,action:'JOB_APPROVED_SINGLE_ADMIN',actor_sub:'synthetic-owner',at:'2026-10-24T00:01:00Z',details:'{"single_admin":true}'}]};}
const pin=(version_id='immutable-object-version-000001')=>({object_key,version_id,sha256:hash,bytes:bytes.length});
const opts=()=>({integrityKey,readObject:async()=>[bytes]});
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const other=generateKeyPairSync('ed25519');
const keys=new Map([['owner-key-20261024',publicKey]]);
const now=Date.now();
async function bundle(){
 const content=await verifyStudioR2ObjectBytes(source(),opts());
 const versions=attestStudioR2PinnedVersions(source(),[pin()],{integrityKey,bucketIdSha256:bucket});
 const payload={schema:'musitu.studio.v03.r2-provider-signed-evidence.v1',provider:'cloudflare-r2',
 receipt_id:'synthetic-independent-attestation',run_id,source_head:head,freeze_id,
 bucket_id_sha256:bucket,content_hmac:content.content_hmac,
 pinned_versions_sha256:versions.versions_sha256,objects_verified:1,
 bytes_verified:bytes.length,read_only:true,versions_pinned:true,
 source_freeze_bound:true,checked_at:new Date(now).toISOString()};
 const envelope={schema:payload.schema,signer_key_id:'owner-key-20261024',payload,
 signature:sign(null,studioR2AttestationSigningBytes(payload),privateKey).toString('base64url')};
 return{envelope,content,versions};
}
const verify=({envelope,content,versions},overrides={})=>verifyStudioR2SignedAttestation(envelope,{
 trustedPublicKeys:keys,expectedHead:head,expectedFreezeId:freeze_id,
 expectedRunId:run_id,expectedContentReceipt:content,expectedVersionManifest:versions,
 now,...overrides});
const fail=async (edit,expected)=>{const b=await bundle();edit(b);assert.throws(()=>verify(b),expected)};

test('fresh correct operator signature cryptographically pins frozen bytes, bucket, versions, Git and run',async()=>{
 const b=await bundle();const result=verify(b);
 assert.equal(result.signature_verified,true);assert.equal(result.provider_origin_verified,false);
 assert.equal(result.cutover_authorized,false);
 assert.doesNotMatch(JSON.stringify(result),/synthetic-owner|scene\.glb|immutable-object-version/);
});
test('manifest is complete, ordered, stable, and version-identity sensitive',()=>{
 const opts={integrityKey,bucketIdSha256:bucket};
 const a=attestStudioR2PinnedVersions(source(),[pin()],opts);
 const b=attestStudioR2PinnedVersions(source(),[pin()],opts);
 const c=attestStudioR2PinnedVersions(source(),[pin('immutable-object-version-000002')],opts);
 assert.equal(a.versions_sha256,b.versions_sha256);
 assert.notEqual(a.versions_sha256,c.versions_sha256);
 assert.equal(a.provider_verified,false);
});
test('rejects missing, duplicate or forged pinned objects and unsafe immutable IDs',()=>{
 const options={integrityKey,bucketIdSha256:bucket};
 assert.throws(()=>attestStudioR2PinnedVersions(source(),[],options),/MANIFEST_INCOMPLETE/);
 assert.throws(()=>attestStudioR2PinnedVersions(source(),[pin(),pin()],options),/MANIFEST_INCOMPLETE/);
 assert.throws(()=>attestStudioR2PinnedVersions(source(),[{...pin(),version_id:'x'}],options),/PIN_INVALID/);
 assert.throws(()=>attestStudioR2PinnedVersions(source(),[{...pin(),bytes:1000}],options),/ASSET_MISMATCH/);
 assert.throws(()=>attestStudioR2PinnedVersions(source(),[{...pin(),object_key:'studio-v02/foreign'}],options),/ASSET_MISMATCH/);
});
test('rejects modified but equally sized signed payload',async()=>{
 await fail(b=>b.envelope.payload.bytes_verified++,/CONTENT_MISMATCH/);
 await fail(b=>b.envelope.payload.checked_at=new Date(now+1000).toISOString(),/SIGNATURE_INVALID/);
});
test('rejects signature replacement and signer impersonation',async()=>{
 await fail(b=>b.envelope.signature='a'.repeat(86),/SIGNATURE_INVALID/);
 await fail(b=>b.envelope.signer_key_id='unknown-owner-key',/SIGNER_UNTRUSTED/);
 const b=await bundle();b.envelope.signature=sign(null,studioR2AttestationSigningBytes(b.envelope.payload),other.privateKey).toString('base64url');
 assert.throws(()=>verify(b),/SIGNATURE_INVALID/);
});
test('rejects changed immutable version manifest, bucket identity and content HMAC',async()=>{
 await fail(b=>b.versions={...b.versions,versions_sha256:'1'.repeat(64)},/VERSIONS_MISMATCH/);
 await fail(b=>b.versions={...b.versions,bucket_id_sha256:'2'.repeat(64)},/VERSIONS_MISMATCH/);
 await fail(b=>b.content={...b.content,content_hmac:'3'.repeat(64)},/CONTENT_MISMATCH/);
});
test('rejects stale or future envelope even when signature matches',async()=>{
 const b=await bundle();assert.throws(()=>verify(b,{now:now+301000}),/ATTESTATION_STALE/);
 assert.throws(()=>verify(b,{now:now-31000}),/ATTESTATION_STALE/);
});
test('rejects replay under other source, run or freeze',async()=>{
 const b=await bundle();
 assert.throws(()=>verify(b,{expectedHead:'f'.repeat(40)}),/EPOCH_MISMATCH/);
 assert.throws(()=>verify(b,{expectedRunId:'another-20261024-run-id'}),/EPOCH_MISMATCH/);
 assert.throws(()=>verify(b,{expectedFreezeId:'other-source-freeze'}),/EPOCH_MISMATCH/);
});
test('rejects extra unsigned properties and an unpinned trust root',async()=>{
 const b=await bundle();b.envelope.payload.extra='silently-uncovered';
 assert.throws(()=>verify(b),/PAYLOAD_SHAPE_INVALID/);
 const c=await bundle();assert.throws(()=>verify(c,{trustedPublicKeys:new Map()}),/SIGNER_UNTRUSTED/);
});
test('rejects non-Ed25519 trusted keys and malformed signature text',async()=>{
 const {publicKey:wrong}=generateKeyPairSync('rsa',{modulusLength:2048});
 const b=await bundle();assert.throws(()=>verify(b,{trustedPublicKeys:new Map([['owner-key-20261024',wrong]])}),/SIGNER_KEY_TYPE_UNSAFE/);
 await fail(b=>b.envelope.signature='unsafe!!!',/SIGNATURE_INVALID/);
});

// These are deliberately synthetic fixture callbacks. The composed verifier
// cannot authenticate Cloudflare by itself; the deployed caller would need
// independently secured provider-origin and full migration receipt checks.
function joined(b){
 const p=b.envelope.payload;
 return {source_head:head,freeze_id,run_id,r2_content_receipt:b.content,
  r2_provider_attestation:{schema:'musitu.studio.v03.r2-provider-attestation.v1',
   provider:p.provider,receipt_id:p.receipt_id,source_head:p.source_head,
   freeze_id:p.freeze_id,objects_verified:p.objects_verified,
   bytes_verified:p.bytes_verified,checked_at:p.checked_at,
   read_only:p.read_only,versions_pinned:p.versions_pinned,
   source_freeze_bound:p.source_freeze_bound,
   bucket_id_sha256:p.bucket_id_sha256,content_hmac:p.content_hmac}};
}
function callbacks(b,overrides={}){
 return {readSignedEnvelope:async()=>b.envelope,
  readPinnedVersionManifest:async()=>b.versions,
  readOwnerTrustedKeys:async()=>keys,
  verifyAuthenticatedR2Versions:async()=>true,
  verifyRemainingProviderReceipts:async()=>true,...overrides};
}
test('composed gate verifies fresh signature, pinned version and all other independent provider receipts',async()=>{
 const b=await bundle();const check=createStudioR2ProviderReceiptVerifier(callbacks(b));
 assert.equal(await check(joined(b)),true);
});
test('composed gate rejects nonmatching R2 provider receipt even when signature is valid',async()=>{
 const b=await bundle();const e=joined(b);e.r2_provider_attestation.bucket_id_sha256='f'.repeat(64);
 assert.equal(await createStudioR2ProviderReceiptVerifier(callbacks(b))(e),false);
});
test('composed gate denies stale or untrusted signer and inaccessible owner trust roots',async()=>{
 const b=await bundle();const e=joined(b);
 assert.equal(await createStudioR2ProviderReceiptVerifier(callbacks(b,{readOwnerTrustedKeys:async()=>new Map()}))(e),false);
 assert.equal(await createStudioR2ProviderReceiptVerifier(callbacks(b,{readOwnerTrustedKeys:async()=>{throw Error('private owner secret')}}))(e),false);
});
test('composed gate rejects provider version assurance or other receipts without activating canary',async()=>{
 const b=await bundle();const e=joined(b);
 assert.equal(await createStudioR2ProviderReceiptVerifier(callbacks(b,{verifyAuthenticatedR2Versions:async()=>false}))(e),false);
 assert.equal(await createStudioR2ProviderReceiptVerifier(callbacks(b,{verifyRemainingProviderReceipts:async()=>false}))(e),false);
});
test('composed gate callback exceptions are suppressed to non-secret fail-closed boolean',async()=>{
 const b=await bundle();const e=joined(b);
 const gate=createStudioR2ProviderReceiptVerifier(callbacks(b,{verifyAuthenticatedR2Versions:async()=>{throw Error('secret confidential')}}));
 assert.equal(await gate(e),false);
});
test('composed gate construction requires every independent verifier',()=>{
 assert.throws(()=>createStudioR2ProviderReceiptVerifier({}),/CALLBACKS_REQUIRED/);
});

test('cannot accidentally configure a private key or raw PEM text as trusted root',async()=>{
 const b=await bundle();
 assert.throws(()=>verify(b,{trustedPublicKeys:new Map([['owner-key-20261024',privateKey]])}),/SIGNER_KEY_TYPE_UNSAFE/);
 assert.throws(()=>verify(b,{trustedPublicKeys:new Map([['owner-key-20261024',publicKey.export({format:'pem',type:'spki'})]])}),/SIGNER_KEY_TYPE_UNSAFE/);
});
test('strict UTC millisecond timestamp rejects ambiguous local formats',async()=>{
 const b=await bundle();b.envelope.payload.checked_at='2026-10-24 20:55:00';
 assert.throws(()=>verify(b),/SIGNED_PAYLOAD_INVALID/);
});

test('pinned-version digest covers complete multi-asset inventory regardless of declaration order',()=>{
 const s=source();
 const extra=['scene.blend','preview.png'].map((filename,i)=>({
  job_id:job,filename,object_key:`studio-v03/jobs/${job}/${filename}`,
  sha256:createHash('sha256').update(Buffer.alloc(1300+i*100,i+1)).digest('hex'),
  bytes:1300+i*100}));
 s.jobs[0].state='COMPLETED';s.assets.push(...extra);
 const pins=[pin(),...extra.map((a,i)=>({object_key:a.object_key,
  version_id:`immutable-other-version-${i+1}-000000`,sha256:a.sha256,bytes:a.bytes}))];
 const params={integrityKey,bucketIdSha256:bucket};
 const a=attestStudioR2PinnedVersions(s,pins,params);
 const b=attestStudioR2PinnedVersions(s,pins.toReversed(),params);
 assert.equal(a.versions_sha256,b.versions_sha256);assert.equal(a.objects_pinned,3);
 const wrong=structuredClone(pins);wrong[2].sha256='f'.repeat(64);
 assert.throws(()=>attestStudioR2PinnedVersions(s,wrong,params),/PIN_ASSET_MISMATCH/);
 s.freeze_id='new-frozen-source-after-owner-consent';
 const c=attestStudioR2PinnedVersions(s,pins,params);
 assert.notEqual(a.versions_sha256,c.versions_sha256);
});
test('opaque version IDs reject path traversal before reaching any provider callback',()=>{
 assert.throws(()=>attestStudioR2PinnedVersions(source(),[pin('opaque-version/../some-object')],{
  integrityKey,bucketIdSha256:bucket}),/PIN_INVALID/);
 assert.throws(()=>attestStudioR2PinnedVersions(source(),[pin('opaque-version..unsafe')],{
  integrityKey,bucketIdSha256:bucket}),/PIN_INVALID/);
});
