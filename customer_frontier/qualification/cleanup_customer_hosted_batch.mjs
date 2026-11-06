// Always-run readback/deletion of this newly owned temporary Worker only.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const DB='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f',RUN='axiom-customer-d1-20261106-01';
const base='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts/'+RUN;
const sha=x=>createHash('sha256').update(x).digest('hex');
const out={run_id:RUN,database_id:DB,database_deleted:false,temporary_worker_removed:false};
try{
 const report=JSON.parse(await readFile('customer-hosted-batch-result.json','utf8'));
 if(report.run_id!==RUN||report.database_id!==DB||!/^[0-9a-f]{64}$/.test(report.worker_ownership_sha256||''))throw Error('missing_ownership_proof');
 async function call(path,method='GET'){
  const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});if(method==='GET'&&r.status===404)return null;
  const value=await r.json();if(!r.ok||value.success!==true)throw Error('provider_rejected');return value.result;
 }
 const settings=await call('/settings');
 if(settings!==null){
  const bindings=settings?.bindings;
  if(!Array.isArray(bindings)||!bindings.some(b=>b.name==='DB'&&b.type==='d1'&&(b.id||b.database_id)===DB)||!bindings.some(b=>b.name==='RUN'&&b.text===RUN)||!bindings.some(b=>b.name==='OWNERSHIP'&&typeof b.text==='string'&&sha(b.text)===report.worker_ownership_sha256))throw Error('foreign_worker_cleanup_denied');
  await call('','DELETE');
 }
 if(await call('/settings')!==null)throw Error('cleanup_unconfirmed');out.temporary_worker_removed=true;
}catch{out.error='owned_worker_cleanup_not_confirmed';process.exitCode=1;}
await writeFile('customer-hosted-batch-cleanup.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
