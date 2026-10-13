/* B16 ISOLATED Workers runtime candidate, NOT deployment or release authority.
 * REQUIRES parent branch frontier/axiom-trackb-b15-do-sqlite-s0-20261012
 * The original B15 ledger_core.mjs must be present at ../trackb15_do/ledger_core.mjs
 * No public route accepts model requests; external HTTP defaults 503.
 */
import {DurableObject} from 'cloudflare:workers';
import {AccountDayLedger,Denied as B15Denied} from '../../trackb15_do/ledger_core.mjs';
import {requireCanonicalObject} from './identity.mjs';
import {authorizeThenReserve,safeQuotaOutcome,OperationDenied} from './admission.mjs';

export class AxiomB16QuotaLedger extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.accountId=env.AXIOM_ACCOUNT_ID;
    // Reject random IDs, wrong names, wrong account or previously dated objects.
    const day=requireCanonicalObject(ctx.id.name,this.accountId);
    this.day=day;
    this.core=new AccountDayLedger(ctx.storage,{
      accountId:this.accountId,utcDay:day,
      publicKeyB64:env.AUTHORITY_ED25519_PUBKEY_B64
    });
  }
  ensureCurrent() {
    // Check on EVERY RPC, not just on constructor, including UTC midnight rollover.
    if(requireCanonicalObject(this.ctx.id.name,this.accountId)!==this.day)
      throw new Error('STALE_UTC_DAY');
  }
  async reserve(request) {
    this.ensureCurrent();
    return safeQuotaOutcome(()=>authorizeThenReserve(request, {
      accountId:this.accountId, utcDay:this.day, now:()=>Date.now(),
      quotaIssuerPublicB64:this.env.AUTHORITY_ED25519_PUBKEY_B64,
      workloadIssuerPublicB64:this.env.WORKLOAD_AUTH_ED25519_PUBKEY_B64,
      core:this.core
    }),[OperationDenied,B15Denied]);
  }
  async revoke(request) {this.ensureCurrent();return this.core.revoke(request);}
}
export default {
  async fetch() {return new Response('B16_LOCAL_ONLY_PUBLIC_ROUTING_DISABLED',{status:503});}
};
