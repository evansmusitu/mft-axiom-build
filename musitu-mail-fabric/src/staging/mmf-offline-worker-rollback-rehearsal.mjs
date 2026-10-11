/**
 * Offline byte-exact restore rehearsal of the two real shared Paynow Worker
 * source/settings snapshots. No network, Cloudflare mutation or payment.
 * A passing rehearsal CANNOT restore Cloudflare non-exportable secret values.
 */
import {createHash} from 'node:crypto';
import {canonicalCloudflareWorkerSource} from './canonical-cloudflare-worker-source.mjs';
import {buildMmfAdditiveSourceCandidate} from '../commercial/mmf-real-source-additive-candidate.mjs';
import {MMF_BACKUP_SCHEMA} from './mmf-sealed-shared-worker-backup.mjs';
import {MMF_EXPECTED_SOURCE_HASHES} from './mmf-current-cloudflare-drift-readonly.mjs';
const NAMES=['mft-phase8-external-authority','mft-paynow-transport-gateway'];
const hash=v=>createHash('sha256').update(v).digest('hex');
const deny=()=>{throw Error('MMF_OFFLINE_RESTORE_REHEARSAL_DENIED')};
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;

/** The caller MUST decrypt the sealed snapshot locally with the owner-held key. */
export async function rehearseMmfSharedWorkerSourceRollback({decryptedSnapshot,expectedHashes=MMF_EXPECTED_SOURCE_HASHES}={}){
 try{
  if(!isObj(decryptedSnapshot)||decryptedSnapshot.schema!==MMF_BACKUP_SCHEMA||
   decryptedSnapshot.accountId!=='93f395f5121954671f92fffa453d6b61'||
   decryptedSnapshot.method!=='GET'||decryptedSnapshot.workerCount!==2||
   decryptedSnapshot.cloudflareMutationCount!==0||decryptedSnapshot.secretValuesExported!==false||
   decryptedSnapshot.secretBindingsRestorable!==false||
   !Array.isArray(decryptedSnapshot.workers)||decryptedSnapshot.workers.length!==2||
   !isObj(expectedHashes)||Object.keys(expectedHashes).length!==2||
   NAMES.some(n=>!/^[a-f0-9]{64}$/.test(expectedHashes[n])))deny();
  const results=[];
  for(let i=0;i<2;i++){
   const w=decryptedSnapshot.workers[i];
   if(!isObj(w)||w.name!==NAMES[i]||typeof w.rawSourceBase64!=='string'||
     w.rawSourceBase64.length>3_000_000||
     typeof w.contentType!=='string'||w.contentType.length>180||
     !/^[a-f0-9]{64}$/.test(w.rawSourceSha256)||
     !/^[a-f0-9]{64}$/.test(w.normalizedSourceSha256)||
     w.settings?.success!==true||!Array.isArray(w.settings.result?.bindings)||
     w.settings.result.bindings.length>150)deny();
   const raw=Buffer.from(w.rawSourceBase64,'base64');
   if(raw.length<100||raw.length>2_000_000||hash(raw)!==w.rawSourceSha256||
    raw.toString('base64')!==w.rawSourceBase64)deny();
   const original=await canonicalCloudflareWorkerSource(new Response(raw,{headers:{'content-type':w.contentType}}));
   if(original.sourceSha256!==expectedHashes[w.name]||original.sourceSha256!==w.normalizedSourceSha256)deny();
   const candidate=buildMmfAdditiveSourceCandidate({workerName:w.name,
    sourceText:original.sourceText,expectedSourceSha256:hash(original.sourceText)});
   if(candidate.patchedSha256===candidate.originalSha256)deny();
   // Simulate a deployment into an in-memory slot, then restoration from the
   // captured exact raw Cloudflare wire bytes. No Cloudflare API write exists.
   let inMemorySource=Buffer.from(candidate.patchedSourceText,'utf8');
   inMemorySource=Buffer.from(raw);
   if(!inMemorySource.equals(raw)||hash(inMemorySource)!==w.rawSourceSha256)deny();
   const settingsBefore=JSON.stringify(w.settings);
   const settingsAfter=JSON.stringify(JSON.parse(settingsBefore));
   if(settingsAfter!==settingsBefore)deny();
   results.push(Object.freeze({workerName:w.name,originalSourceSha256:w.rawSourceSha256,
    patchedSourceSha256:candidate.patchedSha256,restoredOriginalSourceSha256:hash(inMemorySource),
    restoredSettingsJsonByteEqual:true,originalBindingCount:w.settings.result.bindings.length,
    originalNormalizedSourceSha256:original.sourceSha256,
    nonExportableSecretValuesRecovered:false,realWorkerUpdated:false}));
  }
  return Object.freeze({schema:'mmf-offline-worker-restore-rehearsal-v1',
   gate:'MMF_OFFLINE_SOURCE_RESTORE_REHEARSAL_PASS',simulatedWorkerCount:2,
   workers:Object.freeze(results),offlineSourceBytesRoundtripVerified:true,
   noCloudflareWrites:true,noProviderRequests:true,
   realCloudflareRollbackProven:false,nonExportableSecretsRestored:false,
   canDeployProduction:false,independentReleaseApprovalPresent:false});
 }catch{deny()}
}