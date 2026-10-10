/** Execute the REAL durable Mail Fabric outbox against a private stage SQL adapter.
 * The delivery provider is an in-process simulation, never an external email API.
 */
import {createHash,createHmac,createPrivateKey,createPublicKey} from 'node:crypto';
import {DurableMailFabric} from '../durable/fabric.mjs';
import {verifyProof} from '../evidence.mjs';
const PROBE=/^probe-[a-z0-9-]{8,56}$/;
const stage=(env)=>env?.MMF_STAGE_ONLY==='true'&&env?.MMF_REAL_SEND_ENABLED==='false'&&
 env?.MMF_API_ENABLED==='false'&&env?.MMF_WEBHOOK_ENABLED==='false'&&env?.MMF_STAGE_CRYPTO_READY==='true';
export async function runSyntheticTransactionProbe(db,env,probeId){
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
 const input={tenantId:'stage-tenant',from:'synthetic@example.org',to:'synthetic-recipient@example.net',
   subject:'Synthetic isolated transaction',text:'Internal-only staging probe; no customer email is sent.',
   kind:'SERVICE_ALERT',idempotencyKey:probeId};
 let queued;
 try{queued=await fabric.enqueue(input);}catch{throw Error('STAGE_E2E_ENQUEUE_FAILED');}
 if(queued.state==='QUEUED'){
  try{await fabric.processById(queued.messageId);}catch{throw Error('STAGE_E2E_PROCESS_FAILED');}
 }
 let result;
 try{result=await fabric.get(queued.messageId,'stage-tenant');}catch{throw Error('STAGE_E2E_READ_FAILED');}
 if(result?.state!=='ACCEPTED_BY_PROVIDER'||!verifyProof(result.proof,{trustedPublicKey:result.proof.publicKey}))
   throw Error('SYNTHETIC_TRANSACTION_NOT_VERIFIED');
 const persisted=await db.prepare('SELECT state,sealed_envelope FROM mail_messages WHERE message_id=? AND tenant_id=?')
   .bind(queued.messageId,'stage-tenant').first();
 if(persisted?.state!=='ACCEPTED_BY_PROVIDER'||persisted.sealed_envelope!==null)throw Error('SYNTHETIC_READBACK_FAILED');
 return Object.freeze({messageId:queued.messageId,state:result.state,proof:result.proof,evidenceVerified:true,
   publicKeySha256:createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex'),
   customerMailSent:false,providerIsSimulation:true});
}
