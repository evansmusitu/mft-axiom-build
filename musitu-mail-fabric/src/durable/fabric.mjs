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
    const msg=validateSubmission(input,this.config,this.suppressed);
    if(await this.#suppressed(msg.to,msg.tenantId))throw new PolicyRejection('RECIPIENT_SUPPRESSED');
    const requestHash=hash(JSON.stringify(msg));
    const id=randomUUID(),ms=this.now();
    const events=[];
    this.ledger.append(events,{messageId:id,tenantId:msg.tenantId,event:'POLICY_APPROVED',detail:{
      kind:msg.kind,provider:this.config.provider.name||'configured',region:this.config.provider.region,
      recipientHmac:this.ledger.opaqueRecipient(msg.to),payloadSha256:requestHash}});
    const cipher=await this.#encrypt(msg,id);
    requireSuccess(await this.db.prepare(`INSERT OR IGNORE INTO mail_messages
      (message_id,tenant_id,idempotency_key,request_hash,state,sealed_envelope,events_json,created_ms,updated_ms)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,msg.tenantId,msg.idempotencyKey,requestHash,'QUEUED',cipher,JSON.stringify(events),ms,ms).run());
    const existing=await this.db.prepare('SELECT * FROM mail_messages WHERE tenant_id=? AND idempotency_key=?').bind(msg.tenantId,msg.idempotencyKey).first();
    if(!existing)throw Error('DURABLE_RECORD_UNAVAILABLE');
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
  async #finalize(row,token,state,providerId){
    if(!FINAL.has(state))throw Error('INVALID_FINAL_STATE');
    const events=JSON.parse(row.events_json);
    this.ledger.append(events,{messageId:row.message_id,tenantId:row.tenant_id,event:state==='ACCEPTED_BY_PROVIDER'?'PROVIDER_ACCEPTED':state==='REJECTED_BY_PROVIDER'?'PROVIDER_REJECTED':state==='BLOCKED_BY_POLICY'?'POLICY_BLOCKED':'SEND_OUTCOME_UNKNOWN',detail:providerId?{providerId}:{}});
    const result=requireSuccess(await this.db.prepare(`UPDATE mail_messages SET state=?,sealed_envelope=NULL,events_json=?,claim_token=NULL,
      lease_deadline=NULL,provider_id=?,updated_ms=? WHERE message_id=? AND tenant_id=? AND state='SENDING' AND claim_token=?`)
      .bind(state,JSON.stringify(events),providerId,this.now(),row.message_id,this.config.tenantId,token).run());
    if(result.meta?.changes!==1)return null;
    return this.get(row.message_id,row.tenant_id);
  }
  async processNext(){
    const pending=await this.db.prepare(`SELECT message_id FROM mail_messages WHERE tenant_id=? AND state='QUEUED' ORDER BY created_ms,message_id LIMIT 1`).bind(this.config.tenantId).first();
    if(!pending)return null;
    const claim=await this.claim(pending.message_id);
    if(!claim)return null;
    const {row,token}=claim;
    let result;
    try{
      const msg=await this.#decrypt(row);
      if(await this.#suppressed(msg.to,msg.tenantId))return this.#finalize(row,token,'BLOCKED_BY_POLICY',null);
      result=await this.config.provider.send(msg,'musitu-'+hash(msg.tenantId+':'+msg.idempotencyKey));
    }catch{result={outcome:'unknown'};}
    const outcome=['accepted','rejected','unknown'].includes(result?.outcome)?result.outcome:'unknown';
    const state=outcome==='accepted'?'ACCEPTED_BY_PROVIDER':outcome==='rejected'?'REJECTED_BY_PROVIDER':'OUTCOME_UNKNOWN';
    const providerId=outcome==='accepted'&&typeof result?.providerId==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(result.providerId)?result.providerId:null;
    return this.#finalize(row,token,state,providerId);
  }
  async reconcileExpired(){
    const ms=this.now();
    const res=await this.db.prepare(`SELECT * FROM mail_messages WHERE tenant_id=? AND state='SENDING' AND lease_deadline<? ORDER BY lease_deadline LIMIT 100`).bind(this.config.tenantId,ms).all();
    let n=0;
    for(const row of res.results||[]){const done=await this.#finalize(row,row.claim_token,'OUTCOME_UNKNOWN',null);if(done)n++;}
    return n;
  }
}
