import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {PolicyRejection,validateSubmission,validateConfig} from '../policy.mjs';
import {EvidenceLedger,generateDemonstrationKeys} from '../evidence.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const b64=b=>Buffer.from(b).toString('base64url');
const un64=s=>Buffer.from(s,'base64url');
const FINAL=new Set(['ACCEPTED_BY_PROVIDER','REJECTED_BY_PROVIDER','OUTCOME_UNKNOWN','BLOCKED_BY_POLICY']);
function requireSuccess(result){if(!result||result.success===false)throw Error('DATABASE_WRITE_FAILED');return result;}
function view(row,ledger){
 if(!row)return null;
 const events=JSON.parse(row.events_json);
 return Object.freeze({messageId:row.message_id,state:row.state,proof:ledger.export(events)});
}
export class DurableMailFabric {
  constructor(config,{db,encryptionKey,keys=generateDemonstrationKeys(),privacyKey,now=Date.now,leaseMs=120000}={}){
    validateConfig(config);
    if(!db?.prepare||!encryptionKey||Buffer.from(encryptionKey).length!==32)throw TypeError('Separate D1 database and AES-256 key are required');
    if(!privacyKey||Buffer.from(privacyKey).length<32)throw TypeError('Persistent opaque-identity key required');
    if(!Number.isInteger(leaseMs)||leaseMs<15000)throw TypeError('Lease must exceed provider timeout');
    // The cap is enforced inside the same SQLite write that creates the message.
    // Clients cannot choose or increase this limit through the HTTP body.
    this.dailySendLimit=config.dailySendLimit??100;
    if(!Number.isSafeInteger(this.dailySendLimit)||this.dailySendLimit<1||this.dailySendLimit>100000)throw TypeError('INVALID_DAILY_QUOTA_CONFIG');
    this.dailyRecipientLimit=config.dailyRecipientLimit??20;
    if(!Number.isSafeInteger(this.dailyRecipientLimit)||this.dailyRecipientLimit<1||this.dailyRecipientLimit>10000)throw TypeError('INVALID_RECIPIENT_QUOTA_CONFIG');
    // Fixed UTC minute buckets are enforced by the same SQLite INSERT that creates the envelope.
    this.minuteSendLimit=config.minuteSendLimit??20;
    if(!Number.isSafeInteger(this.minuteSendLimit)||this.minuteSendLimit<1||this.minuteSendLimit>1000)throw TypeError('INVALID_MINUTE_RATE_LIMIT');
    this.maxQueuedAgeMs=config.maxQueuedAgeMs??86400000;
    if(!Number.isSafeInteger(this.maxQueuedAgeMs)||this.maxQueuedAgeMs<60000||this.maxQueuedAgeMs>604800000)throw TypeError('INVALID_QUEUE_TTL');
    this.config=config;this.db=db;this.key=Buffer.from(encryptionKey);this.now=now;this.leaseMs=leaseMs;
    this.ledger=new EvidenceLedger({...keys,privacyKey:Buffer.from(privacyKey),now:()=>new Date(this.now()).toISOString()});
    this.suppressed=new Set();
  }
  async suppress(email){
    if(typeof email!=='string'||!email.includes('@'))throw TypeError('Invalid address');
    const identity=this.ledger.opaqueRecipient(email.toLowerCase());
    requireSuccess(await this.db.prepare('INSERT OR IGNORE INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)')
      .bind(this.config.tenantId,identity,this.now()).run());
    this.suppressed.add(email.toLowerCase());
  }
  async #suppressed(email,tenantId){
    const row=await this.db.prepare('SELECT 1 suppressed FROM mail_suppressions WHERE tenant_id=? AND recipient_hmac=?')
      .bind(tenantId,this.ledger.opaqueRecipient(email.toLowerCase())).first();
    return Boolean(row);
  }
  async #cryptoKey(){return crypto.subtle.importKey('raw',this.key,'AES-GCM',false,['encrypt','decrypt']);}
  async #encrypt(message,id){
    const iv=randomBytes(12),key=await this.#cryptoKey();
    const aad=Buffer.from(message.tenantId+':'+id);
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,Buffer.from(JSON.stringify(message)));
    return `v1.${b64(iv)}.${b64(cipher)}`;
  }
  async #decrypt(row){
    const [v,i,c,...more]=String(row.sealed_envelope||'').split('.');
    if(v!=='v1'||!i||!c||more.length)throw Error('INVALID_CIPHERTEXT');
    const key=await this.#cryptoKey(),aad=Buffer.from(row.tenant_id+':'+row.message_id);
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(i),additionalData:aad},key,un64(c));
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  }
  async #row(id){return this.db.prepare('SELECT * FROM mail_messages WHERE message_id=? AND tenant_id=?').bind(id,this.config.tenantId).first();}
  async enqueue(input){
    const msg=validateSubmission(input,this.config,new Set());
    const requestHash=hash(JSON.stringify(msg));
    // A receipt for a previously accepted idempotency key remains accessible,
    // even if the recipient subsequently opted out or generated a complaint.
    const original=await this.db.prepare('SELECT * FROM mail_messages WHERE tenant_id=? AND idempotency_key=?')
      .bind(msg.tenantId,msg.idempotencyKey).first();
    if(original){
      if(original.request_hash!==requestHash)throw new PolicyRejection('IDEMPOTENCY_CONFLICT');
      return view(original,this.ledger);
    }
    if(this.suppressed.has(msg.to.toLowerCase())||await this.#suppressed(msg.to,msg.tenantId))
      throw new PolicyRejection('RECIPIENT_SUPPRESSED');
    const id=randomUUID(),ms=this.now();
    const events=[];
    this.ledger.append(events,{messageId:id,tenantId:msg.tenantId,event:'POLICY_APPROVED',detail:{
      kind:msg.kind,provider:this.config.provider.name||'configured',region:this.config.provider.region,
      recipientHmac:this.ledger.opaqueRecipient(msg.to),payloadSha256:requestHash}});
    const cipher=await this.#encrypt(msg,id);
    const dayStart=Math.floor(ms/86400000)*86400000;
    const minuteStart=Math.floor(ms/60000)*60000;
    // A single atomic SQLite statement serializes competing limit checks with
    // the insert. A duplicated idempotency key returns its original message.
    requireSuccess(await this.db.prepare(`INSERT OR IGNORE INTO mail_messages
      (message_id,tenant_id,idempotency_key,request_hash,recipient_hmac,state,sealed_envelope,events_json,created_ms,updated_ms)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE
      (SELECT COUNT(*) FROM mail_messages WHERE tenant_id=? AND created_ms>=? AND created_ms<?) < ?
      AND (SELECT COUNT(*) FROM mail_messages WHERE tenant_id=? AND recipient_hmac=? AND created_ms>=? AND created_ms<?) < ?
      AND (SELECT COUNT(*) FROM mail_messages WHERE tenant_id=? AND created_ms>=? AND created_ms<?) < ?`)
      .bind(id,msg.tenantId,msg.idempotencyKey,requestHash,this.ledger.opaqueRecipient(msg.to),
        'QUEUED',cipher,JSON.stringify(events),ms,ms,msg.tenantId,dayStart,dayStart+86400000,this.dailySendLimit,
        msg.tenantId,this.ledger.opaqueRecipient(msg.to),dayStart,dayStart+86400000,this.dailyRecipientLimit,
        msg.tenantId,minuteStart,minuteStart+60000,this.minuteSendLimit).run());
    const existing=await this.db.prepare('SELECT * FROM mail_messages WHERE tenant_id=? AND idempotency_key=?').bind(msg.tenantId,msg.idempotencyKey).first();
    if(!existing){
      const minute=await this.db.prepare('SELECT COUNT(*) AS n FROM mail_messages WHERE tenant_id=? AND created_ms>=? AND created_ms<?')
        .bind(msg.tenantId,minuteStart,minuteStart+60000).first();
      if(Number(minute?.n)>=this.minuteSendLimit)throw new PolicyRejection('RATE_LIMIT_EXCEEDED');
      throw new PolicyRejection('QUOTA_EXCEEDED');
    }
    if(existing.request_hash!==requestHash)throw new PolicyRejection('IDEMPOTENCY_CONFLICT');
    return view(existing,this.ledger);
  }
  async get(id,tenantId){
    const row=await this.db.prepare('SELECT * FROM mail_messages WHERE message_id=? AND tenant_id=?').bind(id,tenantId).first();
    return view(row,this.ledger);
  }
  async claim(id){
    const token=randomUUID(),ms=this.now();
    const result=requireSuccess(await this.db.prepare(`UPDATE mail_messages
      SET state='SENDING',claim_token=?,lease_deadline=?,updated_ms=? WHERE message_id=? AND tenant_id=? AND state='QUEUED'`)
      .bind(token,ms+this.leaseMs,ms,id,this.config.tenantId).run());
    if(result.meta?.changes!==1)return null;
    return {token,row:await this.#row(id)};
  }
  async #finalize(row,token,state,providerId,blockReason=null){
    if(!FINAL.has(state))throw Error('INVALID_FINAL_STATE');
    const events=JSON.parse(row.events_json);
    this.ledger.append(events,{messageId:row.message_id,tenantId:row.tenant_id,event:state==='ACCEPTED_BY_PROVIDER'?'PROVIDER_ACCEPTED':state==='REJECTED_BY_PROVIDER'?'PROVIDER_REJECTED':state==='BLOCKED_BY_POLICY'?'POLICY_BLOCKED':'SEND_OUTCOME_UNKNOWN',detail:providerId?{providerId}:blockReason?{blockReason}:{}});
    const result=requireSuccess(await this.db.prepare(`UPDATE mail_messages SET state=?,sealed_envelope=NULL,events_json=?,claim_token=NULL,
      lease_deadline=NULL,provider_id=?,updated_ms=? WHERE message_id=? AND tenant_id=? AND state='SENDING' AND claim_token=?`)
      .bind(state,JSON.stringify(events),providerId,this.now(),row.message_id,this.config.tenantId,token).run());
    if(result.meta?.changes!==1)return null;
    return this.get(row.message_id,row.tenant_id);
  }
  async processById(messageId){
    if(typeof messageId!=='string'||!/^[0-9a-f-]{36}$/i.test(messageId))return null;
    const claim=await this.claim(messageId);
    if(!claim)return null;
    const {row,token}=claim;
    let result;
    try{
      const elapsed=this.now()-Number(row.created_ms);
      if(!Number.isSafeInteger(elapsed)||elapsed<0||elapsed>this.maxQueuedAgeMs)
        return this.#finalize(row,token,'BLOCKED_BY_POLICY',null,'QUEUE_EXPIRED');
      const msg=await this.#decrypt(row);
      if(await this.#suppressed(msg.to,msg.tenantId))return this.#finalize(row,token,'BLOCKED_BY_POLICY',null,'RECIPIENT_SUPPRESSED');
      result=await this.config.provider.send(msg,'musitu-'+hash(msg.tenantId+':'+msg.idempotencyKey));
    }catch{result={outcome:'unknown'};}
    const outcome=['accepted','rejected','unknown'].includes(result?.outcome)?result.outcome:'unknown';
    const providerId=outcome==='accepted'&&typeof result?.providerId==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(result.providerId)?result.providerId:null;
    // Without a valid unique provider identifier we cannot reconcile verified
    // delivery feedback; the network attempt may nevertheless have succeeded.
    const state=outcome==='accepted'?(providerId?'ACCEPTED_BY_PROVIDER':'OUTCOME_UNKNOWN'):
      outcome==='rejected'?'REJECTED_BY_PROVIDER':'OUTCOME_UNKNOWN';
    return this.#finalize(row,token,state,providerId);
  }
  async processNext(){
    const pending=await this.db.prepare(`SELECT message_id FROM mail_messages WHERE tenant_id=? AND state='QUEUED' ORDER BY created_ms,message_id LIMIT 1`).bind(this.config.tenantId).first();
    return pending?this.processById(pending.message_id):null;
  }
  async recordProviderEvent({svixId,rawSha256,type,providerId,recipient}){
    if(typeof svixId!=='string'||!(/^[A-Za-z0-9._:-]{4,200}$/).test(svixId)||!(/^[a-f0-9]{64}$/).test(rawSha256)||!['email.delivered','email.bounced','email.complained','email.delivery_delayed'].includes(type)||!(/^[A-Za-z0-9_-]{1,120}$/).test(providerId))throw TypeError('INVALID_PROVIDER_EVENT');
    if(recipient!==undefined){
      // A valid webhook signature proves provider origin, NOT that it belongs
      // to the recipient of this MUSITU transaction. Never allow feedback
      // for a different recipient to suppress or assert delivery for this one.
      if(typeof recipient!=='string'||recipient.length>254)
        throw new TypeError('INVALID_WEBHOOK_RECIPIENT');
      if(typeof this.db.matchRecipient==='function'){
        // A linked, least-privilege ingress never needs the sender HMAC key.
        // The sender Durable Object itself performs this exact recipient match.
        const matches=await this.db.matchRecipient(this.config.tenantId,providerId,recipient.toLowerCase());
        if(matches===false)throw Error('PROVIDER_RECIPIENT_MISMATCH');
        if(matches!==true&&matches!==null)throw Error('PROVIDER_CORRELATION_UNVERIFIED');
      }else{
        const attributed=await this.db.prepare(`SELECT recipient_hmac FROM mail_messages
          WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'`)
          .bind(this.config.tenantId,providerId).first();
        if(attributed&&attributed.recipient_hmac!==this.ledger.opaqueRecipient(recipient.toLowerCase()))
          throw Error('PROVIDER_RECIPIENT_MISMATCH');
      }
    }
    const prior=await this.db.prepare(`SELECT * FROM mail_provider_events WHERE tenant_id=? AND svix_id=?`).bind(this.config.tenantId,svixId).first();
    if(prior){
      if(prior.raw_sha256!==rawSha256||prior.kind!==type||prior.provider_id!==providerId)throw Error('WEBHOOK_ID_CONFLICT');
      // Repair a partial failure: event was persisted but recipient suppression failed.
      await this.#applyFeedbackSuppression(type,providerId);
      return {recorded:false,reason:'DUPLICATE_EVENT'};
    }
    const message=await this.db.prepare(`SELECT message_id FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'`).bind(this.config.tenantId,providerId).first();
    if(!message)return {recorded:false,reason:'UNRELATED_PROVIDER_ID'};
    const result=requireSuccess(await this.db.prepare(`INSERT OR IGNORE INTO mail_provider_events(tenant_id,svix_id,message_id,provider_id,kind,raw_sha256,created_ms) VALUES(?,?,?,?,?,?,?)`).bind(this.config.tenantId,svixId,message.message_id,providerId,type,rawSha256,this.now()).run());
    if(result.meta?.changes!==1){
      const existing=await this.db.prepare(`SELECT * FROM mail_provider_events WHERE tenant_id=? AND svix_id=?`).bind(this.config.tenantId,svixId).first();
      if(existing&&(existing.raw_sha256!==rawSha256||existing.kind!==type||existing.provider_id!==providerId))throw Error('WEBHOOK_ID_CONFLICT');
      await this.#applyFeedbackSuppression(type,providerId);
      return {recorded:false,reason:'DUPLICATE_EVENT'};
    }
    await this.#applyFeedbackSuppression(type,providerId);
    return {recorded:true};
  }
  async #applyFeedbackSuppression(type,providerId){
    if(type!=='email.bounced'&&type!=='email.complained')return;
    const recipient=await this.db.prepare(`SELECT recipient_hmac FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'`)
      .bind(this.config.tenantId,providerId).first();
    if(!recipient?.recipient_hmac)throw Error('FEEDBACK_RECIPIENT_NOT_FOUND');
    requireSuccess(await this.db.prepare('INSERT OR IGNORE INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)')
      .bind(this.config.tenantId,recipient.recipient_hmac,this.now()).run());
  }
  async getProviderEvidence(messageId,tenantId){
    if(tenantId!==this.config.tenantId)return null;
    const row=await this.db.prepare(`SELECT * FROM mail_messages WHERE message_id=? AND tenant_id=?`).bind(messageId,tenantId).first();
    if(!row)return null;
    const receipts=await this.db.prepare(`SELECT * FROM mail_provider_events WHERE message_id=? AND tenant_id=? ORDER BY created_ms,svix_id`).bind(messageId,tenantId).all();
    const entries=JSON.parse(row.events_json);
    const events=[];
    for(const r of receipts.results||[]){
      const detail={providerId:r.provider_id,type:r.kind,rawSha256:r.raw_sha256,svixHash:hash(r.svix_id),claim:'PROVIDER_REPORTED'};
      const previousHash=entries.at(-1).hash;
      const data={messageId:row.message_id,tenantId:row.tenant_id,sequence:entries.length+1,at:new Date(r.created_ms).toISOString(),event:'AUTHENTICATED_PROVIDER_EVENT',detail,previousHash};
      const event={...data,hash:hash(JSON.stringify(data))};entries.push(event);
      events.push({type:r.kind,claim:'PROVIDER_REPORTED',eventIdHash:hash(r.svix_id)});
    }
    // Conservative, provider-asserted projection. Complaint and permanent bounce
    // cannot be undone by a later or out-of-order 'delivered' event.
    const kinds=new Set(events.map(x=>x.type));
    const providerStatus=kinds.has('email.complained')?'COMPLAINT_REPORTED':
       kinds.has('email.bounced')?'BOUNCED_REPORTED':
       kinds.has('email.delivered')?'DELIVERED_REPORTED':
       kinds.has('email.delivery_delayed')?'DELAY_REPORTED':'NO_PROVIDER_EVENT';
    return {messageId,providerStatus,events,proof:this.ledger.export(entries)};
  }
  async reconcileExpired(){
    const ms=this.now();
    const res=await this.db.prepare(`SELECT * FROM mail_messages WHERE tenant_id=? AND state='SENDING' AND lease_deadline<? ORDER BY lease_deadline LIMIT 100`).bind(this.config.tenantId,ms).all();
    let n=0;
    for(const row of res.results||[]){const done=await this.#finalize(row,row.claim_token,'OUTCOME_UNKNOWN',null);if(done)n++;}
    return n;
  }
}
