/* Cloudflare API adapter: deliberately NO public Worker route or deploy config. */
import { DurableObject } from 'cloudflare:workers';
import { AccountDayLedger, Denied } from './ledger_core.mjs';
export class AxiomQuotaAccountDay extends DurableObject {
  constructor(ctx,env){ super(ctx,env);this.core=new AccountDayLedger(ctx.storage,{
    accountId:env.AXIOM_ACCOUNT_ID,utcDay:env.AXIOM_DAY,
    publicKeyB64:env.AUTHORITY_ED25519_PUBKEY_B64
  });}
  async reserve(request){return this.core.reserve(request);}
  async revoke(request){return this.core.revoke(request);}
}
export default {
  async fetch(_request,_env,_ctx) {return new Response('B15_DISABLED_NOT_DEPLOYED',{status:503});}
};