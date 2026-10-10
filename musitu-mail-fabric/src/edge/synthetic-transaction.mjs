/** Execute the REAL durable Mail Fabric outbox against a private stage SQL adapter.
 * The delivery provider is an in-process simulation, never an external email API.
 */
import {createHash,createHmac,createPrivateKey,createPublicKey} from 'node:crypto';
import {DurableMailFabric} from '../durable/fabric.mjs';
import {verifyProof} from '../evidence.mjs';
const PROBE=/^probe-[a-z0-9-]{8,56}$/;
/** Synthetic per-probe recipient isolation. A previous test's confirmed
 * suppression must NEVER contaminate a later independent stage test. */
export function syntheticStageRecipient(probeId){
 if(typeof probeId!=='string'||!PROBE.test(probeId))throw TypeError('INVALID_SYNTHETIC_PROBE');
 return 'probe-'+createHash('sha256').update(probeId).digest('hex').slice(0,24)+'@example.net';
}

const stage=(env)=>env?.MMF_STAGE_ONLY==='true'&&env?.MMF_REAL_SEND_ENABLED==='false'&&
 env?.MMF_API_ENABLED==='false'&&env?.MMF_WEBHOOK_ENABLED==='false'&&env?.MMF_STAGE_CRYPTO_READY==='true';
export function createSyntheticStageFabric(db,env,probeId){
 if(!stage(env))throw Error('STAGING_ONLY');
 if(typeof probeId!=='string'||!PROBE.test(probeId))throw TypeError('INVALID_SYNTHETIC_PROBE');
 if(!db?.prepare)throw Error('STAGING_STORAGE_REQUIRED');
 const raw=String(env.MMF_STAGE_DATA_KEY_B64||''),pem=String(env.MMF_STAGE_SIGNING_PRIVATE_KEY_PEM||'');
 if(!/^[A-Za-z0-9+/]{43}=$/.test(raw)||!pem.startsWith('-----BEGIN PRIVATE KEY-----'))throw Error('STAGING_SECRET_INVALID');
 const encryptionKey=Buffer.from(raw,'base64');
 if(encryptionKey.length!==32||encryptionKey.toString('base64')!==raw)throw Error('STAGING_SECRET_INVALID');
 let privateKey,publicKey;
 try{privateKey=createPrivateKey(pem);publicKey=createPublicKey(privateKey)}catch{throw Error('STAGING_SECRET_INVALID')}
 if(privateKey.asymmetricKeyType!=='ed25519')throw Error('STAGING_SECRET_INVALID');
 const privacyKey=createHmac('sha256',encryptionKey).update('MMF_SYNTHETIC_STAGE_PRIVACY_V1').digest();
 const provider={name:'synthetic-internal-only',region:'us-east-1',async send(){
   return {outcome:'accepted',providerId:'synthetic_'+probeId};
 }};
 const fabric=new DurableMailFabric({tenantId:'stage-tenant',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],
   provider,dailySendLimit:100,dailyRecipientLimit:100,minuteSendLimit:20,maxQueuedAgeMs:60000},
 {db,encryptionKey,privacyKey,keys:{privateKey,publicKey}});
 return Object.freeze({fabric,publicKey});
}
export async function runSyntheticTransactionProbe(db,env,probeId){
 const {fabric,publicKey}=createSyntheticStageFabric(db,env,probeId);
 const input={tenantId:'stage-tenant',from:'synthetic@example.org',to:syntheticStageRecipient(probeId),
   subject:'Synthetic isolated transaction',text:'Internal-only staging probe; no customer email is sent.',
   kind:'SERVICE_ALERT',idempotencyKey:probeId};
 let queued;
 try{queued=await fabric.enqueue(input);}catch{throw Error('STAGE_E2E_ENQUEUE_FAILED');}
 if(queued.state==='QUEUED'){
  try{await fabric.processById(queued.messageId);}catch{throw Error('STAGE_E2E_PROCESS_FAILED');}
 }
 let result;
 try{result=await fabric.get(queued.messageId,'stage-tenant');}catch{throw Error('STAGE_E2E_READ_FAILED');}
 if(result?.state!=='ACCEPTED_BY_PROVIDER'){
  const status=['QUEUED','SENDING','OUTCOME_UNKNOWN','REJECTED_BY_PROVIDER','BLOCKED_BY_POLICY'].includes(result?.state)?result.state:'MISSING';
  throw Error('STAGE_E2E_STATE_'+status);
 }
 if(!verifyProof(result.proof,{trustedPublicKey:result.proof.publicKey}))throw Error('STAGE_E2E_PROOF_INVALID');
 const persisted=await db.prepare('SELECT state,sealed_envelope FROM mail_messages WHERE message_id=? AND tenant_id=?')
   .bind(queued.messageId,'stage-tenant').first();
 if(persisted?.state!=='ACCEPTED_BY_PROVIDER'||persisted.sealed_envelope!==null)throw Error('SYNTHETIC_READBACK_FAILED');
 return Object.freeze({messageId:queued.messageId,state:result.state,proof:result.proof,evidenceVerified:true,
   publicKeySha256:createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex'),
   customerMailSent:false,providerIsSimulation:true});
}

/** Stage-only reconciliation. Refuses non-synthetic in-flight claims and never
 * retries unknown provider network attempts. Synthetic stage has no mail provider.
 */
export async function reconcileSyntheticStage(db,env){
 const {fabric}=createSyntheticStageFabric(db,env,'probe-stage-maintenance-20261010');
 const rows=await db.prepare("SELECT idempotency_key,lease_deadline FROM mail_messages WHERE tenant_id=? AND state='SENDING'")
   .bind('stage-tenant').all();
 const found=rows?.results||[];
 if(found.length>100||found.some(r=>!PROBE.test(r.idempotency_key)||!Number.isSafeInteger(r.lease_deadline)||r.lease_deadline<1))
   throw Error('STAGE_RECONCILIATION_SCOPE_DENIED');
 const now=Date.now();
 const staleBefore=found.filter(r=>r.lease_deadline<now).length;
 const reconciled=await fabric.reconcileExpired();
 const after=await db.prepare("SELECT COUNT(*) AS n FROM mail_messages WHERE tenant_id=? AND state='SENDING' AND lease_deadline<?")
   .bind('stage-tenant',Date.now()).first();
 if(Number(after?.n)!==0||reconciled!==staleBefore)throw Error('STAGE_RECONCILIATION_INCOMPLETE');
 return Object.freeze({reconciled,staleBefore,staleAfter:0,customerMailSent:false,providerRetryAttempted:false});
}
