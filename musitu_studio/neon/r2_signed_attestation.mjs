/** Source-only R2 pinned-version manifest and operator-signed evidence verifier.
 *
 * This module never contacts Cloudflare, reads protected objects, routes
 * traffic, retrieves credentials, or authorizes a migration. A signature from
 * an owner-controlled pinned key proves the signer approved the envelope; it
 * DOES NOT independently prove the signer read Cloudflare R2 or that the
 * claimed object versions are immutable. A separate authenticated provider
 * verifier remains mandatory in guardedStudioNeonPromotion.
 */
import {createHash,verify as edVerify,timingSafeEqual} from 'node:crypto';
import {normalizeStudioLedgerSnapshot,attestStudioLedgerSnapshot} from './ledger_reconcile.mjs';

const fail=x=>{throw Error(x)};
const SHA=/^[0-9a-f]{64}$/i, HEAD=/^[0-9a-f]{40}$/i;
const ID=/^[A-Za-z0-9_-]{8,80}$/;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,191}$/;
const RFC3339_MILLIS=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DOM='MUSITU/STUDIO-V03/R2-SIGNED-ATTESTATION/V1\n';
const MANIFEST_SCHEMA='musitu.studio.v03.r2-pinned-version-manifest.v1';
const ATTEST_SCHEMA='musitu.studio.v03.r2-provider-signed-evidence.v1';
const FIELDS=Object.freeze(['schema','provider','receipt_id','run_id','source_head',
  'freeze_id','bucket_id_sha256','content_hmac','pinned_versions_sha256',
  'objects_verified','bytes_verified','read_only','versions_pinned',
  'source_freeze_bound','checked_at']);
const own=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hexSame=(a,b)=>SHA.test(a||'')&&SHA.test(b||'')&&
  timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const simple=x=>typeof x==='string'&&x.length>=1&&x.length<=128&&!/[\u0000-\u001f]/.test(x);

/** Assemble a deterministic digest of *every* frozen asset's immutable version.
 * This establishes manifest coverage and consistency, not R2 authenticity.
 */
export function attestStudioR2PinnedVersions(sourceSnapshot,pins,{integrityKey,bucketIdSha256}={}){
  const ledger=normalizeStudioLedgerSnapshot(sourceSnapshot);
  if(!(integrityKey instanceof Uint8Array)||integrityKey.length<32)
    fail('STUDIO_R2_PIN_INTEGRITY_KEY_REQUIRED');
  if(typeof bucketIdSha256!=='string'||!SHA.test(bucketIdSha256))
    fail('STUDIO_R2_PIN_BUCKET_ID_REQUIRED');
  if(!Array.isArray(pins)||pins.length!==ledger.assets.length)
    fail('STUDIO_R2_PIN_MANIFEST_INCOMPLETE');
  const expected=new Map(ledger.assets.map(a=>[a.object_key,a]));
  const seen=new Set(),normalized=[];
  for(const pin of pins){
    if(!own(pin,['object_key','version_id','sha256','bytes'])||
       typeof pin.object_key!=='string'||!VERSION.test(pin.version_id||'')||
       pin.version_id.includes('..'))
      fail('STUDIO_R2_PIN_INVALID');
    if(seen.has(pin.object_key))fail('STUDIO_R2_PIN_DUPLICATE');
    seen.add(pin.object_key);
    const asset=expected.get(pin.object_key);
    if(!asset||!hexSame(pin.sha256,asset.sha256)||pin.bytes!==asset.bytes)
      fail('STUDIO_R2_PIN_ASSET_MISMATCH');
    normalized.push([asset.object_key,pin.version_id]);
  }
  if(seen.size!==expected.size)fail('STUDIO_R2_PIN_MANIFEST_INCOMPLETE');
  normalized.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const assets_table_hmac=attestStudioLedgerSnapshot(ledger,{integrityKey}).table_hmac.assets;
  const digest=createHash('sha256').update(JSON.stringify({schema:MANIFEST_SCHEMA,
    freeze_id:ledger.freeze_id,bucket_id_sha256:bucketIdSha256.toLowerCase(),
    assets_table_hmac,versions:normalized})).digest('hex');
  return Object.freeze({schema:MANIFEST_SCHEMA,freeze_id:ledger.freeze_id,
    bucket_id_sha256:bucketIdSha256.toLowerCase(),assets_table_hmac,
    objects_pinned:normalized.length,versions_sha256:digest,
    provider_verified:false,cutover_authorized:false});
}

function normalizedPayload(payload){
  if(!own(payload,FIELDS))fail('STUDIO_R2_SIGNED_PAYLOAD_SHAPE_INVALID');
  if(payload.schema!==ATTEST_SCHEMA||payload.provider!=='cloudflare-r2'||
     !simple(payload.receipt_id)||!ID.test(payload.run_id||'')||
     !HEAD.test(payload.source_head||'')||!simple(payload.freeze_id)||
     !SHA.test(payload.bucket_id_sha256||'')||!SHA.test(payload.content_hmac||'')||
     !SHA.test(payload.pinned_versions_sha256||'')||
     !Number.isSafeInteger(payload.objects_verified)||payload.objects_verified<0||
     payload.objects_verified>25000||!Number.isSafeInteger(payload.bytes_verified)||
     payload.bytes_verified<0||payload.bytes_verified>125_000_000_000||
     payload.read_only!==true||payload.versions_pinned!==true||
     payload.source_freeze_bound!==true||
     typeof payload.checked_at!=='string'||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.checked_at))
    fail('STUDIO_R2_SIGNED_PAYLOAD_INVALID');
  return Object.fromEntries(FIELDS.map(k=>[k,payload[k]]));
}
/** Domain-separated canonical bytes to be signed by the external owner system.
 * The signing key MUST NOT be shipped with Studio, CI fixtures or this module.
 */
export function studioR2AttestationSigningBytes(payload){
  const normalized=normalizedPayload(payload);
  return Buffer.from(DOM+JSON.stringify(normalized),'utf8');
}

/** Verify an operator's Ed25519 signature bound to exact frozen evidence.
 * trustedPublicKeys is a secure, independently configured Map of pinned keys.
 * A valid signature is not Cloudflare R2 provenance or production acceptance.
 */
export function verifyStudioR2SignedAttestation(envelope,{trustedPublicKeys,
  expectedHead,expectedFreezeId,expectedRunId,expectedContentReceipt,
  expectedVersionManifest,now=Date.now()}={}){
  if(!own(envelope,['schema','signer_key_id','payload','signature'])||
     envelope.schema!==ATTEST_SCHEMA||!ID.test(envelope.signer_key_id||''))
    fail('STUDIO_R2_SIGNED_ENVELOPE_INVALID');
  if(!(trustedPublicKeys instanceof Map)||!trustedPublicKeys.has(envelope.signer_key_id))
    fail('STUDIO_R2_SIGNER_UNTRUSTED');
  const p=normalizedPayload(envelope.payload);
  if(p.source_head!==expectedHead||p.freeze_id!==expectedFreezeId||
     p.run_id!==expectedRunId)
    fail('STUDIO_R2_SIGNED_EPOCH_MISMATCH');
  const c=expectedContentReceipt,v=expectedVersionManifest;
  if(c?.schema!=='musitu.studio.v03.r2-content-receipt.v1'||
     c.verified!==true||c.complete!==true||c.provider_verified!==false||
     c.freeze_id!==p.freeze_id||c.objects_verified!==p.objects_verified||
     c.bytes_verified!==p.bytes_verified||!hexSame(c.content_hmac,p.content_hmac))
    fail('STUDIO_R2_SIGNED_CONTENT_MISMATCH');
  if(v?.schema!==MANIFEST_SCHEMA||v.provider_verified!==false||
     v.cutover_authorized!==false||v.freeze_id!==p.freeze_id||
     v.objects_pinned!==p.objects_verified||
     !hexSame(v.bucket_id_sha256,p.bucket_id_sha256)||
     !hexSame(v.versions_sha256,p.pinned_versions_sha256)||
     !hexSame(v.assets_table_hmac,c.assets_table_hmac))
    fail('STUDIO_R2_SIGNED_VERSIONS_MISMATCH');
  const t=Date.parse(p.checked_at);
  if(!Number.isFinite(t)||new Date(t).toISOString()!==p.checked_at||
     !Number.isFinite(now)||t>now+30000||now-t>300000)
    fail('STUDIO_R2_SIGNED_ATTESTATION_STALE');
  if(typeof envelope.signature!=='string'||
     !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))
    fail('STUDIO_R2_SIGNATURE_INVALID');
  const sig=Buffer.from(envelope.signature,'base64url');
  if(sig.length!==64||sig.toString('base64url')!==envelope.signature)
    fail('STUDIO_R2_SIGNATURE_INVALID');
  let good=false;
  try{
    const key=trustedPublicKeys.get(envelope.signer_key_id);
    // Accept ONLY pre-parsed public Ed25519 KeyObjects from pinned owner config.
    // Never coerce private-key PEM into a public key or import untrusted text.
    if(key?.type!=='public'||key?.asymmetricKeyType!=='ed25519')
      fail('STUDIO_R2_SIGNER_KEY_TYPE_UNSAFE');
    good=edVerify(null,studioR2AttestationSigningBytes(p),key,sig);
  }catch(e){if(e?.message==='STUDIO_R2_SIGNER_KEY_TYPE_UNSAFE')throw e;
    fail('STUDIO_R2_SIGNATURE_INVALID')}
  if(!good)fail('STUDIO_R2_SIGNATURE_INVALID');
  return Object.freeze({schema:ATTEST_SCHEMA,signature_verified:true,
    signer_key_id:envelope.signer_key_id,run_id:p.run_id,
    freeze_id:p.freeze_id,content_hmac:p.content_hmac,
    pinned_versions_sha256:p.pinned_versions_sha256,
    provider_origin_verified:false,cutover_authorized:false});
}

/** Bind the exact independently configured Ed25519 public key to an active,
 * externally authenticated signer lifecycle record. This callback result MUST
 * originate from an access-controlled registry outside the untrusted receipt
 * bundle. Boolean provider_authenticated is a contract, not an attestation.
 */
export function verifyStudioR2SignerLifecycle(record,{signerKeyId,trustedPublicKeys,
  signatureTime,now=Date.now()}={}){
  const fields=['key_id','spki_sha256','state','revoked_at','owner_approved',
    'valid_from','valid_until','checked_at','provider_authenticated'];
  if(!own(record,fields)||record.key_id!==signerKeyId||
     record.state!=='active'||record.revoked_at!==null||
     record.owner_approved!==true||record.provider_authenticated!==true||
     !SHA.test(record.spki_sha256||'')||
     !(trustedPublicKeys instanceof Map))return false;
  const parse=(x)=>{
    if(typeof x!=='string'||!RFC3339_MILLIS.test(x))return NaN;
    const t=Date.parse(x);
    return Number.isFinite(t)&&new Date(t).toISOString()===x?t:NaN;
  };
  const from=parse(record.valid_from),until=parse(record.valid_until),
    checked=parse(record.checked_at),issued=parse(signatureTime);
  if(!Number.isFinite(from)||!Number.isFinite(until)||!Number.isFinite(checked)||
     !Number.isFinite(issued)||!Number.isFinite(now)||
     issued<from||issued>=until||now>=until||
     checked>now+30000||now-checked>300000)return false;
  const key=trustedPublicKeys.get(signerKeyId);
  if(key?.type!=='public'||key?.asymmetricKeyType!=='ed25519')return false;
  try{
    const fingerprint=createHash('sha256').update(key.export({format:'der',type:'spki'})).digest();
    return timingSafeEqual(fingerprint,Buffer.from(record.spki_sha256,'hex'));
  }catch{return false}
}

/** Optional composition adapter for guardedStudioNeonPromotion's mandatory
 * verifyProviderReceipts callback. All five upstream callbacks MUST be
 * independent of the untrusted evidence body and authenticated by the owner.
 *
 * This verifier intentionally returns *false* if either cryptographic signer
 * verification, provider provenance or the REST of the migration's independent
 * provider receipts cannot be proven. Never install synthetic callbacks live.
 */
export function createStudioR2ProviderReceiptVerifier({readSignedEnvelope,
  readPinnedVersionManifest,readOwnerTrustedKeys,readSignerRegistryRecord,
  verifyAuthenticatedR2Versions,
  verifyRemainingProviderReceipts}={}){
  const methods={readSignedEnvelope,readPinnedVersionManifest,readOwnerTrustedKeys,
    readSignerRegistryRecord,verifyAuthenticatedR2Versions,verifyRemainingProviderReceipts};
  if(Object.values(methods).some(fn=>typeof fn!=='function'))
    fail('STUDIO_R2_PROVIDER_VERIFIER_CALLBACKS_REQUIRED');
  return async function verifyProviderReceipts(e){
    try{
      if(!e||typeof e!=='object'||typeof e.source_head!=='string'||
         typeof e.freeze_id!=='string'||typeof e.run_id!=='string')return false;
      const [envelope,pins,keys]=await Promise.all([
        readSignedEnvelope(e.run_id),readPinnedVersionManifest(e.freeze_id),
        readOwnerTrustedKeys()]);
      const signerRegistry=await readSignerRegistryRecord(envelope?.signer_key_id);
      if(!verifyStudioR2SignerLifecycle(signerRegistry,{
        signerKeyId:envelope?.signer_key_id,trustedPublicKeys:keys,
        signatureTime:envelope?.payload?.checked_at}))return false;
      const signed=verifyStudioR2SignedAttestation(envelope,{
        expectedHead:e.source_head,expectedFreezeId:e.freeze_id,
        expectedRunId:e.run_id,expectedContentReceipt:e.r2_content_receipt,
        expectedVersionManifest:pins,trustedPublicKeys:keys});
      const p=envelope.payload,r=e.r2_provider_attestation;
      // Never swap a signed receipt for another receipt that happens to name
      // the same source. All provider facts visible to the promotion guard
      // must match the signed pinned-version evidence exactly.
      if(r?.schema!=='musitu.studio.v03.r2-provider-attestation.v1'||
         r.provider!==p.provider||r.receipt_id!==p.receipt_id||
         r.source_head!==p.source_head||r.freeze_id!==p.freeze_id||
         r.objects_verified!==p.objects_verified||
         r.bytes_verified!==p.bytes_verified||
         r.checked_at!==p.checked_at||
         r.read_only!==p.read_only||r.versions_pinned!==p.versions_pinned||
         r.source_freeze_bound!==p.source_freeze_bound||
         !hexSame(r.bucket_id_sha256,p.bucket_id_sha256)||
         !hexSame(r.content_hmac,p.content_hmac))return false;
      if(signed.signature_verified!==true||signed.provider_origin_verified!==false||
         signed.cutover_authorized!==false)return false;
      if(await verifyAuthenticatedR2Versions({evidence:e,signed,versionManifest:pins})!==true)
        return false;
      if(await verifyRemainingProviderReceipts(e)!==true)return false;
      return true;
    }catch{return false}
  };
}
