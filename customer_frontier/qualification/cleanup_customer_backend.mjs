// Fixed-run credentialed cleanup. No caller SQL; no schema/data deletion.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DB,RUN,MARKER,DISABLE_SQL,DISABLED_SQL,CANCEL_SQL} from './customer_acceptance_contract.mjs';
const base='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61';
const sha=s=>createHash('sha256').update(s).digest('hex');
const out={run_id:RUN,database_id:DB,database_deleted:false,fixture_authority_disabled:null,temporary_worker_removed:false};
async function call(path,{method='GET',body,allow404=false}={}){
 const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(allow404&&r.status===404)return null;
 const data=await r.json();if(!r.ok||data.success!==true)throw Error('provider_rejected');return data.result;
}
async function query(sql,params){const result=await call('/d1/database/'+DB+'/query',{method:'POST',body:{sql,...(params?{params}:{})}});if(!Array.isArray(result)||result.length!==1||result[0].success!==true)throw Error('cleanup_query_failed');return result[0].results;}
try{
 const report=JSON.parse(await readFile('customer-backend-result.json','utf8'));
 if(report.run_id!==RUN||report.database_id!==DB||!/^[0-9a-f]{64}$/.test(report.worker_ownership_sha256||''))throw Error('missing_ownership');
 if(report.fixture_attempted===true){
  const marker=await query("SELECT name FROM sqlite_master WHERE type='table' AND name='"+MARKER+"'");
  if(marker.length===0){try{await query(CANCEL_SQL,[report.worker_ownership_sha256]);}catch{}}
  if(marker.length<=1){
   const receipt=await query('SELECT run_id,ownership_sha256,phase FROM '+MARKER);
   if(receipt.length!==1||receipt[0].run_id!==RUN||receipt[0].ownership_sha256!==report.worker_ownership_sha256)throw Error('foreign_fixture_receipt');
   if(receipt[0].phase!=='CANCELLED'){
    for(const sql of DISABLE_SQL)await query(sql);
    await query('UPDATE '+MARKER+" SET phase=CASE WHEN phase='PASS_DISABLED' THEN phase ELSE 'DISABLED' END WHERE run_id='"+RUN+"'");
    const verification=await query(DISABLED_SQL);if(verification.length!==1||verification[0].n!==0)throw Error('cleanup_incomplete');
   }
  }else throw Error('invalid_marker');
  out.fixture_authority_disabled=true;
 }
 const settings=await call('/workers/scripts/'+RUN+'/settings',{allow404:true});
 if(settings!==null){const b=settings.bindings;
  if(!Array.isArray(b)||!b.some(x=>x.name==='DB'&&x.type==='d1'&&(x.id||x.database_id)===DB)||!b.some(x=>x.name==='RUN'&&x.text===RUN)||!b.some(x=>x.name==='OWNERSHIP'&&typeof x.text==='string'&&sha(x.text)===report.worker_ownership_sha256))throw Error('foreign_worker_cleanup_denied');
  await call('/workers/scripts/'+RUN,{method:'DELETE'});
 }
 if(await call('/workers/scripts/'+RUN+'/settings',{allow404:true})!==null)throw Error('worker_cleanup_unconfirmed');out.temporary_worker_removed=true;
}catch{out.error='cleanup_not_confirmed_reconcile_fixed_fixture_and_owned_worker';process.exitCode=1;}
await writeFile('customer-backend-cleanup.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
