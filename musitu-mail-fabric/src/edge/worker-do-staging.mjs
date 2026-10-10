/** Non-public isolated Cloudflare Queue + SQLite Durable Object smoke harness.
 *  Intentionally does not expose MMF API, DNS routes, outbound email or webhook.
 */
import {MmfStagingSqliteDO,createDurableSqlAdapter} from './sqlite-do.mjs';
import {stageCryptoSelfTest} from './stage-crypto.mjs';
import {runSyntheticTransactionProbe} from './synthetic-transaction.mjs';
import {createHash} from 'node:crypto';
export {MmfStagingSqliteDO};
const PROBE=/^probe-[a-z0-9-]{8,56}$/;
function gated(env){
 return env?.MMF_STAGE_ONLY==='true'&&env.MMF_REAL_SEND_ENABLED==='false'&&env.MMF_API_ENABLED==='false'&&env.MMF_WEBHOOK_ENABLED==='false';
}
export default {
 async fetch(){return new Response('Not Found',{status:404,headers:{'cache-control':'no-store'}});},
 async queue(batch,env){
  if(!Array.isArray(batch?.messages))return;
  if(!gated(env)){for(const msg of batch.messages)msg.retry();return;}
  let db;
  try{db=createDurableSqlAdapter(env.MMF_LEDGER,env.MMF_STORAGE_RPC_SECRET);}catch{for(const msg of batch.messages)msg.retry();return;}
  for(const m of batch.messages){
   const input=m.body;
   if((input?.type!=='MMF_STAGE_PROBE'&&input?.type!=='MMF_STAGE_RETRY_PROBE'&&input?.type!=='MMF_STAGE_TRANSACTION_PROBE')||typeof input.probeId!=='string'||!PROBE.test(input.probeId)){m.ack();continue;}
   try{
    if(input.type==='MMF_STAGE_TRANSACTION_PROBE'){
      // No customer data, public endpoint, real provider adapter or network mail can be activated here.
      const outcome=await runSyntheticTransactionProbe(db,env,input.probeId);
      if(outcome.customerMailSent!==false||outcome.providerIsSimulation!==true||outcome.evidenceVerified!==true)throw Error('STAGE_SYNTHETIC_GATE_FAILED');
      m.ack();
      console.log(JSON.stringify({gate:'MMF_STAGE_SYNTHETIC_DURABLE_MAIL_FABRIC_E2E',
        status:'PASS',probeSha256:createHash('sha256').update(input.probeId).digest('hex'),
        evidenceVerified:true,providerWasSimulation:true,publicKeySha256:outcome.publicKeySha256,
        receipt:outcome.proof,customerMailSent:false}));
      continue;
    }
    if(input.type==='MMF_STAGE_RETRY_PROBE'){
     // Staging-only fault injection: commit the first attempt to a real Durable Object,
     // request one genuine Queue redelivery, and prove subsequent idempotent recovery.
     const id=input.probeId;
     const probeSha256=createHash('sha256').update(id).digest('hex');
     await db.prepare('INSERT OR IGNORE INTO mmf_staging_recovery(probe_id,first_seen_ms,recovery_count,completed_ms) VALUES(?,?,0,NULL)').bind(id,Date.now()).run();
     const row=await db.prepare('SELECT recovery_count,completed_ms FROM mmf_staging_recovery WHERE probe_id=?').bind(id).first();
     if(!row||![0,1].includes(row.recovery_count))throw Error('STAGE_RECOVERY_STATE_INVALID');
     if(row.completed_ms!==null){
      m.ack();continue; // Redelivered messages remain idempotently acknowledged.
     }
     if(row.recovery_count===0){
      const first=await db.prepare('UPDATE mmf_staging_recovery SET recovery_count=1 WHERE probe_id=? AND recovery_count=0 AND completed_ms IS NULL').bind(id).run();
      if(first?.meta?.changes!==1)throw Error('STAGE_RETRY_LOCK_UNAVAILABLE');
      m.retry({delaySeconds:1});
      console.log(JSON.stringify({gate:'MMF_STAGE_SYNTHETIC_RETRY_INJECTED',status:'EXPECTED',probeSha256,durableFirstAttempt:true,customerMailSent:false}));
      continue;
     }
     const done=await db.prepare('UPDATE mmf_staging_recovery SET completed_ms=? WHERE probe_id=? AND recovery_count=1 AND completed_ms IS NULL').bind(Date.now(),id).run();
     const proof=await db.prepare('SELECT recovery_count,completed_ms FROM mmf_staging_recovery WHERE probe_id=?').bind(id).first();
     if(!proof||proof.recovery_count!==1||!Number.isSafeInteger(proof.completed_ms)||proof.completed_ms<=0)throw Error('STAGE_RETRY_PERSISTENCE_UNPROVEN');
     if(done?.meta?.changes!==1)throw Error('STAGE_RETRY_COMPLETION_UNPROVEN');
     m.ack();
     console.log(JSON.stringify({gate:'MMF_STAGE_QUEUE_REDELIVERY_DURABLE_RECOVERY',status:'PASS',probeSha256,recoveredAfterQueueRetry:true,persistedReadback:true,customerMailSent:false}));
     continue;
    }
    const cryptoProof = env.MMF_STAGE_CRYPTO_READY === 'true'
      ? stageCryptoSelfTest(env.MMF_STAGE_SIGNING_PRIVATE_KEY_PEM,env.MMF_STAGE_DATA_KEY_B64,input.probeId)
      : null;
    await db.prepare('INSERT OR IGNORE INTO mmf_staging_probes(probe_id,seen_ms) VALUES(?,?)').bind(input.probeId,Date.now()).run();
    const check=await db.prepare('SELECT probe_id FROM mmf_staging_probes WHERE probe_id=?').bind(input.probeId).first();
    if(check?.probe_id!==input.probeId)throw Error('PROBE_READBACK_MISSING');
    m.ack();
    console.log(JSON.stringify({gate:'MMF_ISOLATED_QUEUE_TO_SQLITE_DO',status:'PASS',probeRecorded:true,cryptoVerified:cryptoProof?.verified===true,publicKeySha256:cryptoProof?.publicKeySha256||null,customerMailSent:false}));
   }catch(error){
    if(input?.type==='MMF_STAGE_TRANSACTION_PROBE'){
      const reasons=new Set(['STAGING_SECRET_INVALID','STAGING_STORAGE_REQUIRED','STAGING_ONLY',
        'STAGE_E2E_ENQUEUE_FAILED','STAGE_E2E_PROCESS_FAILED','STAGE_E2E_READ_FAILED',
        'SYNTHETIC_TRANSACTION_NOT_VERIFIED','SYNTHETIC_READBACK_FAILED',
        'STAGE_E2E_STATE_QUEUED','STAGE_E2E_STATE_SENDING','STAGE_E2E_STATE_OUTCOME_UNKNOWN',
        'STAGE_E2E_STATE_REJECTED_BY_PROVIDER','STAGE_E2E_STATE_BLOCKED_BY_POLICY',
        'STAGE_E2E_STATE_MISSING','STAGE_E2E_PROOF_INVALID']);
      const reason=reasons.has(String(error?.message))?error.message:'UNCLASSIFIED_STAGE_FAILURE';
      console.log(JSON.stringify({gate:'MMF_STAGE_TRANSACTION_PROBE_DIAGNOSTIC',status:'RETRY',
        reason,probeSha256:createHash('sha256').update(input.probeId).digest('hex'),customerMailSent:false,providerWasSimulation:true}));
    }
    m.retry();
   }
  }
 }
};
