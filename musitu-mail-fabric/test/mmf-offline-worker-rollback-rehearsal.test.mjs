import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {rehearseMmfSharedWorkerSourceRollback} from '../src/staging/mmf-offline-worker-rollback-rehearsal.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const sources=[
  ['mft-phase8-external-authority','export async function handleRequest(request) {return new Response("OLD_AUTHORITY_ROUTE "+new URL(request.url).pathname)}\nexport default {fetch:handleRequest};\n'],
  ['mft-paynow-transport-gateway','export async function handleRequest(request,env,ctx,f=fetch) {return new Response("OLD_TRANSPORT_ROUTE "+new URL(request.url).pathname)}\nexport default { fetch: (request, env, ctx) => handleRequest(request, env, ctx, fetch) };\n']
];
const baseline=Object.fromEntries(sources.map(([name,src])=>[name,hash(src)]));
const mk=()=>({schema:'mmf-shared-paynow-encrypted-source-settings-v1',accountId:'93f395f5121954671f92fffa453d6b61',workerCount:2,method:'GET',cloudflareMutationCount:0,secretValuesExported:false,secretBindingsRestorable:false,
 workers:sources.map(([name,src])=>({name,contentType:'text/javascript',rawSourceBase64:Buffer.from(src).toString('base64'),rawSourceSha256:hash(src),normalizedSourceSha256:hash(src),sourceRepresentation:'single-script',settings:{success:true,result:{bindings:[{name:'PAYNOW_INTEGRATION_KEY',type:'secret_text'}]}},settingsSha256:'0'.repeat(64)}))});
test('rehearsal computes the prepared and original raw source hashes; real rollback and secret custody remain blocked',async()=>{
 const result=await rehearseMmfSharedWorkerSourceRollback({decryptedSnapshot:mk(),expectedHashes:baseline});
 assert.equal(result.gate,'MMF_OFFLINE_SOURCE_RESTORE_REHEARSAL_PASS');
 assert.equal(result.offlineSourceBytesRoundtripVerified,true);
 assert.equal(result.simulatedWorkerCount,2);
 assert.equal(result.noCloudflareWrites,true);
 assert.equal(result.canDeployProduction,false);
 assert.equal(result.realCloudflareRollbackProven,false);
 assert.equal(result.nonExportableSecretsRestored,false);
 for(const x of result.workers){assert.equal(x.originalSourceSha256,x.restoredOriginalSourceSha256);assert.notEqual(x.patchedSourceSha256,x.originalSourceSha256)}
});
test('rehearsal refuses tampered original and changed pinned hashes',async()=>{
 const damaged=mk();damaged.workers[1].rawSourceBase64=Buffer.from('changed').toString('base64');
 await assert.rejects(()=>rehearseMmfSharedWorkerSourceRollback({decryptedSnapshot:damaged,expectedHashes:baseline}),/MMF_OFFLINE_RESTORE_REHEARSAL_DENIED/);
 const altered={...baseline,[sources[0][0]]:'a'.repeat(64)};
 await assert.rejects(()=>rehearseMmfSharedWorkerSourceRollback({decryptedSnapshot:mk(),expectedHashes:altered}),/MMF_OFFLINE_RESTORE_REHEARSAL_DENIED/);
});
test('rehearsal refuses one missing worker and source metadata that allows Cloudflare modifications',async()=>{
 const missing=mk();missing.workers.pop();
 await assert.rejects(()=>rehearseMmfSharedWorkerSourceRollback({decryptedSnapshot:missing,expectedHashes:baseline}),/MMF_OFFLINE_RESTORE_REHEARSAL_DENIED/);
 const mutated=mk();mutated.cloudflareMutationCount=1;
 await assert.rejects(()=>rehearseMmfSharedWorkerSourceRollback({decryptedSnapshot:mutated,expectedHashes:baseline}),/MMF_OFFLINE_RESTORE_REHEARSAL_DENIED/);
});