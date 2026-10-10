/** Non-public isolated Cloudflare Queue + SQLite Durable Object smoke harness.
 *  Intentionally does not expose MMF API, DNS routes, outbound email or webhook.
 */
import {MmfStagingSqliteDO,createDurableSqlAdapter} from './sqlite-do.mjs';
import {stageCryptoSelfTest} from './stage-crypto.mjs';
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
   if(input?.type!=='MMF_STAGE_PROBE'||typeof input.probeId!=='string'||!PROBE.test(input.probeId)){m.ack();continue;}
   try{
    const cryptoProof = env.MMF_STAGE_CRYPTO_READY === 'true'
      ? stageCryptoSelfTest(env.MMF_STAGE_SIGNING_PRIVATE_KEY_PEM,env.MMF_STAGE_DATA_KEY_B64,input.probeId)
      : null;
    await db.prepare('INSERT OR IGNORE INTO mmf_staging_probes(probe_id,seen_ms) VALUES(?,?)').bind(input.probeId,Date.now()).run();
    const check=await db.prepare('SELECT probe_id FROM mmf_staging_probes WHERE probe_id=?').bind(input.probeId).first();
    if(check?.probe_id!==input.probeId)throw Error('PROBE_READBACK_MISSING');
    m.ack();
    console.log(JSON.stringify({gate:'MMF_ISOLATED_QUEUE_TO_SQLITE_DO',status:'PASS',probeRecorded:true,cryptoVerified:cryptoProof?.verified===true,publicKeySha256:cryptoProof?.publicKeySha256||null,customerMailSent:false}));
   }catch{m.retry();}
  }
 }
};
