/** In-memory *unit-test seam*, NOT a durable production conversation store.
 * Production replaces it with Postgres RLS + UNIQUE keys and transactions.
 */
export class IsolatedInbox {
  #messages=new Set();
  #conversations=new Map();
  ingest({tenantId,providerMessageId,phoneNumberId,conversationId}) {
    if (![tenantId,providerMessageId,phoneNumberId].every(x=>typeof x==='string' && x)) throw new Error('INVALID_EVENT');
    const key=JSON.stringify([tenantId,phoneNumberId,providerMessageId]);
    if (this.#messages.has(key)) return 'DUPLICATE';
    if (conversationId) {
      const current=this.#conversations.get(conversationId);
      if(current && current.tenantId!==tenantId) throw new Error('TENANT_CONFLICT');
      if(!current) this.#conversations.set(conversationId,{tenantId,mode:'BOT'});
    }
    this.#messages.add(key);
    return 'ACCEPTED';
  }
  handover(tenantId,conversationId) {
    const c=this.#conversations.get(conversationId);
    if(!c||c.tenantId!==tenantId) throw new Error('TENANT_NOT_FOUND');
    c.mode='HUMAN';
  }
  canBotReply(tenantId,conversationId) {
    const c=this.#conversations.get(conversationId);
    if(!c||c.tenantId!==tenantId) throw new Error('TENANT_NOT_FOUND');
    return c.mode==='BOT';
  }
  count(tenantId) {
    let n=0;
    for(const key of this.#messages) if(JSON.parse(key)[0]===tenantId)n++;
    return n;
  }
}
