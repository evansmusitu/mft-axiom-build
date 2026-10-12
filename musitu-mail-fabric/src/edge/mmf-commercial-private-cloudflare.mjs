/**
 * Cloudflare SQLite Durable Object RPC boundary for MMF commercial staging.
 * Public HTTP entry always returns 503. This code is NOT deployed in production.
 * Do not expose this DO binding to a customer-facing Worker before a reviewed
 * authentication gateway, rate limits, CSRF/abuse controls and release.
 */
import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {writeMmfSyntheticProof,readMmfSyntheticProof,clearMmfSyntheticProof,assertMmfPrivateProofFlags,mmfPrivateFlagsFromCloudEnv} from '../staging/mmf-private-sqlite-proof.mjs';
import {MmfCommercialStageKernel} from './mmf-commercial-private-stage.mjs';
const deny=()=>new Response('{"error":"MMF_PRIVATE_STAGE_DISABLED"}',{
 status:503,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
export class MmfCommercialPrivateStageDO extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);
  // Live cloud qualification uses all commercial flags OFF: no customer kernel may initialize.
  this.kernel=env.MMF_STAGE_ONLY==='true'?new MmfCommercialStageKernel(ctx,env):null;
 }
 async fetch(){return deny()}
 // Synthetic SQL probe uses ONLY a dedicated test table and closed-stage flags.
 #proof(){assertMmfPrivateProofFlags(mmfPrivateFlagsFromCloudEnv(this.env));return this.ctx.storage}
 writeSyntheticProof(value){return writeMmfSyntheticProof(this.#proof(),value)}
 readSyntheticProof(){return readMmfSyntheticProof(this.#proof())}
 clearSyntheticProof(){return clearMmfSyntheticProof(this.#proof())}
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
 async fetch(){return deny()}
}