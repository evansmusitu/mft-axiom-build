/* B16 ISOLATED Workers runtime candidate, NOT deployment or release authority.
 * REQUIRES parent branch frontier/axiom-trackb-b15-do-sqlite-s0-20261012
 * The original B15 ledger_core.mjs must be present at ../trackb15_do/ledger_core.mjs
 * No public route accepts model requests; external HTTP defaults 503.
 */
import {DurableObject} from 'cloudflare:workers';
import {AccountDayLedger,Denied as B15Denied} from '../../trackb15_do/ledger_core.mjs';
import {requireCanonicalObject,ScopeDenied} from './identity.mjs';
import {authorizeThenReserve,safeQuotaOutcome,OperationDenied} from './admission.mjs';

export class AxiomB16QuotaLedger extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.accountId=env.AXIOM_ACCOUNT_ID;
    // Fail CLOSED without constructing a ledger when an attacker creates an
    // alternate/random named object. A typed no-dispatch receipt avoids
    // unhandled remote constructor rejections in the Workers runtime.
    this.invalidScope=null;
    this.core=null;
    this.day=null;
    try {this.day=requireCanonicalObject(ctx.id.name,this.accountId);}
    catch(err){
      if(err instanceof ScopeDenied && err.code==='NONCANONICAL_DURABLE_OBJECT') {
        this.invalidScope=err.code;return;
      }
      throw err;
    }
    this.core=new AccountDayLedger(ctx.storage,{
      accountId:this.accountId,utcDay:this.day,
      publicKeyB64:env.AUTHORITY_ED25519_PUBKEY_B64
    });
  }
  ensureCurrent() {
    if(this.invalidScope)return this.invalidScope;
    try {requireCanonicalObject(this.ctx.id.name,this.accountId);return null;}
    catch(err){if(err instanceof ScopeDenied)return err.code;throw err;}
  }
  async reserve(request) {
    const rejected=this.ensureCurrent();
    if(rejected)return {status:'DENIED',dispatch_allowed:false,reason:rejected};
    return safeQuotaOutcome(()=>authorizeThenReserve(request, {
      accountId:this.accountId, utcDay:this.day, now:()=>Date.now(),
      quotaIssuerPublicB64:this.env.AUTHORITY_ED25519_PUBKEY_B64,
      workloadIssuerPublicB64:this.env.WORKLOAD_AUTH_ED25519_PUBKEY_B64,
      core:this.core
    }),[OperationDenied,B15Denied]);
  }
  async revoke(request) {
    const rejected=this.ensureCurrent();
    if(rejected)return {status:'DENIED',dispatch_allowed:false,reason:rejected};
    return safeQuotaOutcome(()=>this.core.revoke(request),[B15Denied]);
  }
}
export default {
  async fetch() {return new Response('B16_LOCAL_ONLY_PUBLIC_ROUTING_DISABLED',{status:503});}
};
