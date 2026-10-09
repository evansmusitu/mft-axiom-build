import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {PolicyRejection,validateSubmission,validateConfig} from './policy.mjs';
import {EvidenceLedger,generateDemonstrationKeys} from './evidence.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
/** Isolated single-process prototype: not safe for parallel production mail. */
export class MailFabric {
  constructor(config,{keys=generateDemonstrationKeys(),privacyKey=randomBytes(32),now}={}){
    validateConfig(config);this.config=config;
    this.ledger=new EvidenceLedger({...keys,privacyKey,...(now?{now}:{})});
    this.requests=new Map();this.byId=new Map();this.suppressed=new Set();
  }
  suppress(email){if(typeof email!=='string'||!email.includes('@'))throw new TypeError('Invalid suppression');this.suppressed.add(email.toLowerCase());}
  async submit(input){
    const message=validateSubmission(input,this.config,this.suppressed);
    const requestHash=sha(JSON.stringify(message)),key=message.tenantId+':'+message.idempotencyKey;
    const prior=this.requests.get(key);
    if(prior){if(prior.requestHash!==requestHash)throw new PolicyRejection('IDEMPOTENCY_CONFLICT');return prior.promise;}
    const messageId=randomUUID(),entries=[];
    this.byId.set(messageId,{tenantId:message.tenantId,entries});
    this.ledger.append(entries,{messageId,tenantId:message.tenantId,event:'POLICY_APPROVED',detail:{
      kind:message.kind,provider:this.config.provider.name||'configured-provider',region:this.config.provider.region,
      recipientHmac:this.ledger.opaqueRecipient(message.to),payloadSha256:requestHash
    }});
    const pending=this.#send(message,messageId,entries);
    this.requests.set(key,{requestHash,promise:pending});
    return pending;
  }
  async #send(message,messageId,entries){
    let outcome;
    try{outcome=await this.config.provider.send(message,'musitu-'+sha(message.tenantId+':'+message.idempotencyKey));}
    catch{outcome={outcome:'unknown'};}
    const safe=['accepted','rejected','unknown'].includes(outcome?.outcome)?outcome.outcome:'unknown';
    const event=safe==='accepted'?'PROVIDER_ACCEPTED':safe==='rejected'?'PROVIDER_REJECTED':'SEND_OUTCOME_UNKNOWN';
    const providerId=typeof outcome?.providerId==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(outcome.providerId)?outcome.providerId:null;
    this.ledger.append(entries,{messageId,tenantId:message.tenantId,event,detail:providerId&&safe==='accepted'?{providerId}:{}});
    return this.get(messageId,message.tenantId);
  }
  get(messageId,tenantId){
    const row=this.byId.get(messageId);
    if(!row||row.tenantId!==tenantId)return null;
    const entries=row.entries,last=entries.at(-1)?.event;
    const state=last==='PROVIDER_ACCEPTED'?'ACCEPTED_BY_PROVIDER':last==='PROVIDER_REJECTED'?'REJECTED_BY_PROVIDER':last==='SEND_OUTCOME_UNKNOWN'?'OUTCOME_UNKNOWN':'SENDING';
    return {messageId,state,proof:this.ledger.export(entries)};
  }
}
