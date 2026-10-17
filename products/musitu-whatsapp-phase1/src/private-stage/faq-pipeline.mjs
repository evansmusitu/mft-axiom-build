/**
 * Offline stage orchestrator. It intentionally has no Meta send capability.
 * Caller supplies a stage-configured, authorized actor map, not user input.
 * The raw message is processed in memory and not persisted in inbound_events.
 */
export function simulateOfflineFaqProcessing({store,rawBody,signature,appSecret,actorForTenant}){
  if(!store||!actorForTenant||typeof actorForTenant!=='object')throw new Error('OFFLINE_STAGE_ACTOR_MAP_REQUIRED');
  const expected=store.preflightOfflineActors({rawBody,signature,appSecret,actorForTenant});
  const payload=JSON.parse(rawBody.toString('utf8'));
  const messages=new Map();
  for(const entry of payload.entry){
    for(const change of entry.changes){
      if(change.field!=='messages')continue;
      const phone=change.value?.metadata?.phone_number_id;
      for(const msg of change.value?.messages??[]){
        const key=JSON.stringify([entry.id,phone,msg.id]);
        if(messages.has(key)){
          const prev=messages.get(key);
          if(JSON.stringify(prev)!==JSON.stringify(msg))throw new Error('CONFLICTING_DUPLICATE_MESSAGE');
        }
        messages.set(key,msg);
      }
    }
  }
  if(expected.some(e=>!messages.has(JSON.stringify([e.wabaId,e.phoneNumberId,e.providerMessageId]))))throw new Error('STAGE_EVENT_PREVIEW_MISMATCH');
  const receipts=store.ingestSignedWebhook({rawBody,signature,appSecret});
  const drafts=[];
  for(const receipt of receipts){
    if(!receipt.conversationId)continue; // synthetic provider-status evidence
    const matching=expected.find(x=>x.tenantId===receipt.tenantId&&x.phoneNumberId===receipt.phoneNumberId&&x.providerMessageId===receipt.providerMessageId);
    if(!matching)throw new Error('STAGE_EVENT_PREVIEW_MISMATCH');
    const msg=messages.get(JSON.stringify([matching.wabaId,matching.phoneNumberId,matching.providerMessageId]));
    const actorId=actorForTenant[receipt.tenantId];
    if(msg?.type!=='text'||typeof msg.text?.body!=='string'||!msg.text.body.trim()||msg.text.body.length>1000){
      store.handover(receipt.tenantId,actorId,receipt.conversationId);
      drafts.push({status:'HANDOVER_REQUIRED',reason:'UNSUPPORTED_MESSAGE_TYPE'});
      continue;
    }
    drafts.push(store.draftApprovedFaqReply({tenantId:receipt.tenantId,actorId,conversationId:receipt.conversationId,
      question:msg.text.body,effectKey:'inbound:'+matching.phoneNumberId+':'+matching.providerMessageId}));
  }
  return {receipts,drafts};
}
