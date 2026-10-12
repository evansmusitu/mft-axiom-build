/**
 * Cloudflare SQLite Durable Object RPC boundary for MMF commercial staging.
 * Public HTTP entry always returns 503. This code is NOT deployed in production.
 * Do not expose this DO binding to a customer-facing Worker before a reviewed
 * authentication gateway, rate limits, CSRF/abuse controls and release.
 */
import {DurableObject} from 'cloudflare:workers';
import {MmfCommercialStageKernel} from './mmf-commercial-private-stage.mjs';
const deny=()=>new Response('{"error":"MMF_PRIVATE_STAGE_DISABLED"}',{
 status:503,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
export class MmfCommercialPrivateStageDO extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);
  this.kernel=new MmfCommercialStageKernel(ctx,env);
 }
 async fetch(){return deny()}
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