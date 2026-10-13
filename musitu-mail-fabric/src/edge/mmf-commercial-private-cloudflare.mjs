/**
 * Cloudflare SQLite Durable Object RPC boundary for MMF commercial staging.
 * Public HTTP entry always returns 503. This code is NOT deployed in production.
 * Do not expose this DO binding to a customer-facing Worker before a reviewed
 * authentication gateway, rate limits, CSRF/abuse controls and release.
 */
import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {writeMmfSyntheticProof,readMmfSyntheticProof,clearMmfSyntheticProof,assertMmfPrivateProofFlags,mmfPrivateFlagsFromCloudEnv} from '../staging/mmf-private-sqlite-proof.mjs';
import {seedMmfSyntheticControl,readMmfSyntheticControl,recordMmfSyntheticControlUsage,revokeMmfSyntheticControlKey,checkMmfSyntheticControlAccess,clearMmfSyntheticControl,inspectMmfSyntheticControlOccupancy} from '../staging/mmf-private-cloud-control-proof.mjs';
import {MmfCommercialStageKernel} from './mmf-commercial-private-stage.mjs';
const deny=()=>new Response('{"error":"MMF_PRIVATE_STAGE_DISABLED"}',{
 status:503,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
export class MmfCommercialPrivateStageDO extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);
  this.proofRuntimeEpoch=crypto.randomUUID(); // ephemeral per instance, never persisted
  // Live cloud qualification uses all commercial flags OFF: no customer kernel may initialize.
  this.kernel=env.MMF_STAGE_ONLY==='true'?new MmfCommercialStageKernel(ctx,env):null;
 }
 async fetch(){return deny()}
 // Synthetic SQL probe uses ONLY a dedicated test table and closed-stage flags.
 #proof(){assertMmfPrivateProofFlags(mmfPrivateFlagsFromCloudEnv(this.env));return this.ctx.storage}
 writeSyntheticProof(value){return writeMmfSyntheticProof(this.#proof(),value)}
 readSyntheticProof(){return readMmfSyntheticProof(this.#proof())}
 clearSyntheticProof(){return clearMmfSyntheticProof(this.#proof())}
 seedSyntheticControl(run,records){return seedMmfSyntheticControl(this.#proof(),run,records)}
 readSyntheticControl(run,records){return readMmfSyntheticControl(this.#proof(),run,records)}
 meterSyntheticControl(run,record,idem){return recordMmfSyntheticControlUsage(this.#proof(),run,record,idem)}
 revokeSyntheticControl(run,record){return revokeMmfSyntheticControlKey(this.#proof(),run,record)}
 accessSyntheticControl(run,record){return checkMmfSyntheticControlAccess(this.#proof(),run,record)}
 clearSyntheticControl(run){return clearMmfSyntheticControl(this.#proof(),run)}
 inspectSyntheticControl(){return inspectMmfSyntheticControlOccupancy(this.#proof())}
 runtimeSyntheticControlEpoch(){this.#proof();return {epoch:this.proofRuntimeEpoch}}
 restartSyntheticProof(){this.#proof();this.ctx.abort('MMF_PRIVATE_SYNTHETIC_PROBE_RESET',{retryAlarm:false})}
 issueLoginChallenge(){return this.kernel.issueLoginChallenge()}
 acceptOidcLogin(input){return this.kernel.acceptOidcLogin(input)}
 revokeSession(token){return this.kernel.revokeSession(token)}
 authenticateApiKey(token,scope){return this.kernel.authenticateApiKey(token,scope)}
 createTenant(input){return this.kernel.createTenant(input)}
 issueApiKey(input){return this.kernel.issueApiKey(input)}
 revokeApiKey(input){return this.kernel.revokeApiKey(input)}
 requestDomain(input){return this.kernel.requestDomain(input)}
 openSubscription(input){return this.kernel.openSubscription(input)}
 getSubscription(input){return this.kernel.getSubscription(input)}
 getUsage(input){return this.kernel.getUsage(input)}
 meterStageEvent(input){return this.kernel.meterStageEvent(input)}
 effectiveEntitlement(input){return this.kernel.effectiveEntitlement(input)}
}
export default {async fetch(){return deny()}};
// Named internal Worker RPC only, no public HTTP access. No customer/Paynow/API secrets.
export class MmfPrivateStorageProofEntrypoint extends WorkerEntrypoint {
 #stub(){
  assertMmfPrivateProofFlags(mmfPrivateFlagsFromCloudEnv(this.env));
  return this.env.MMF_COMMERCIAL_PRIVATE_STAGE.getByName('mmf-private-sqlite-proof-20261012');
 }
 async write(value){return this.#stub().writeSyntheticProof(value)}
 async read(){return this.#stub().readSyntheticProof()}
 async clear(){return this.#stub().clearSyntheticProof()}
 async restart(){return this.#stub().restartSyntheticProof()}
 async seedControl(run,records){return this.#stub().seedSyntheticControl(run,records)}
 async readControl(run,records){return this.#stub().readSyntheticControl(run,records)}
 async meterControl(run,record,idem){return this.#stub().meterSyntheticControl(run,record,idem)}
 async revokeControl(run,record){return this.#stub().revokeSyntheticControl(run,record)}
 async accessControl(run,record){return this.#stub().accessSyntheticControl(run,record)}
 async clearControl(run){return this.#stub().clearSyntheticControl(run)}
 async inspectControl(){return this.#stub().inspectSyntheticControl()}
 async runtimeControlEpoch(){return this.#stub().runtimeSyntheticControlEpoch()}
 async fetch(){return deny()}
}