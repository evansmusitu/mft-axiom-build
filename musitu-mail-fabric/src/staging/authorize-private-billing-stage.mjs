/** User-authorized MMF-only private Cloudflare billing stage.
 * Restrict all mutations to one new D1 and one nonpublic Worker. Never operate
 * on existing FMI, Axiom, Chemistry, mail, DNS, Paynow, or production resources.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {MMF_PREP_BILLING_SCHEMA} from '../commercial/mmf-order-ledger.mjs';
export const BILLING_STAGE_TARGET=Object.freeze({
 account:'93f395f5121954671f92fffa453d6b61',
 worker:'musitu-mail-fabric-payment-private-stage-20261011',
 database:'mmf-isolated-billing-stage',
 tenant:'mmf_stage_20261011'
});
const deny=()=>{throw Error('MMF_PRIVATE_STAGE_DENIED')};
const ROOT='https://api.cloudflare.com/client/v4/accounts/';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const KEYS=Object.freeze({
 MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',
 MMF_COMMERCE_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_STAGE_RECEIPTS_ENABLED:'false',
 MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_TENANT_ID:BILLING_STAGE_TARGET.tenant
});
const path=(suffix)=>ROOT+BILLING_STAGE_TARGET.account+suffix;
function safeToken(token){if(typeof token!=='string'||token.length<20)deny();return token;}
async function cfGet(token,suffix,fetchImpl=fetch,{allow404=false}={}){
 const res=await fetchImpl(path(suffix),{method:'GET',headers:{authorization:'Bearer '+safeToken(token),accept:'application/json'},signal:AbortSignal.timeout(16000),redirect:'error'});
 if(allow404&&res.status===404)return {absent:true};
 if(!res.ok)deny();
 let body;try{body=await res.json()}catch{deny()}
 if(body?.success!==true)deny();
 return body.result;
}
async function cfPost(token,suffix,body,fetchImpl=fetch){
 const res=await fetchImpl(path(suffix),{method:'POST',headers:{authorization:'Bearer '+safeToken(token),accept:'application/json','content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!res.ok){
  let err;try{err=await res.json()}catch{err=null}
  const codes=(Array.isArray(err?.errors)?err.errors:[]).map(x=>Number(x.code)).filter(Number.isSafeInteger);
  if(codes.includes(7406))throw Error('MMF_PRIVATE_STAGE_D1_ACCOUNT_QUOTA_7406');
  throw Error('MMF_PRIVATE_STAGE_CLOUD_MUTATION_HTTP_'+res.status+(codes.length?'_CODES_'+codes.join('_'):''));
 }
 let obj;try{obj=await res.json()}catch{deny()}
 if(obj?.success!==true)deny();
 return obj.result;
}
export function privateStageConfig(databaseId){
 if(!UUID.test(databaseId))deny();
 return {
  name:BILLING_STAGE_TARGET.worker,
  main:'src/commercial/billing-stage-worker.mjs',
  compatibility_date:'2026-10-11',compatibility_flags:['nodejs_compat'],
  workers_dev:false,preview_urls:false,routes:[],
  d1_databases:[{binding:'MMF_PAYMENT_DB',database_name:BILLING_STAGE_TARGET.database,database_id:databaseId}],
  vars:{...KEYS}
 };
}
export function assertPrivateStageDefinition(c){
 if(!c||typeof c!=='object'||Array.isArray(c))deny();
 if(c.name!==BILLING_STAGE_TARGET.worker||c.main!=='src/commercial/billing-stage-worker.mjs'||
    c.workers_dev!==false||c.preview_urls!==false||
    !Array.isArray(c.routes)||c.routes.length!==0||
    c.services!==undefined||c.queues!==undefined||c.triggers!==undefined||
    c.routes?.some(()=>true)||c.route!==undefined||c.assets!==undefined||
    c.durable_objects!==undefined||c.send_email!==undefined)deny();
 if(!Array.isArray(c.d1_databases)||c.d1_databases.length!==1)deny();
 const d=c.d1_databases[0];
 if(d.binding!=='MMF_PAYMENT_DB'||d.database_name!==BILLING_STAGE_TARGET.database||!UUID.test(d.database_id))deny();
 if(!c.vars||Object.keys(c.vars).length!==Object.keys(KEYS).length||
    Object.entries(KEYS).some(([k,v])=>c.vars[k]!==v))deny();
 return true;
}
export async function billingStagePreflight({account,dbToken,workerToken,fetchImpl=fetch}={}){
 if(account!==BILLING_STAGE_TARGET.account||!safeToken(dbToken)||!safeToken(workerToken))deny();
 const info=await cfGet(dbToken,'',fetchImpl);
 if(info?.id!==account)deny();
 const [list,worker]=await Promise.all([
  cfGet(dbToken,'/d1/database?name='+encodeURIComponent(BILLING_STAGE_TARGET.database)+'&per_page=100',fetchImpl),
  cfGet(workerToken,'/workers/scripts/'+BILLING_STAGE_TARGET.worker+'/settings',fetchImpl,{allow404:true})
 ]);
 if(!Array.isArray(list)||list.some(x=>x.name===BILLING_STAGE_TARGET.database)||worker?.absent!==true)deny();
 return Object.freeze({isolated:true,readyToCreate:true,existingWorkerUnchanged:true,
  newDatabase:BILLING_STAGE_TARGET.database,newWorker:BILLING_STAGE_TARGET.worker,
  customerFunds:false,publicRoutes:false,customerEmail:false});
}
function flattenQueryResult(result){
 const rows=Array.isArray(result)?result:[result];
 if(!rows.length||rows.some(x=>x?.success!==true||!Array.isArray(x.results)))deny();
 return rows.flatMap(x=>x.results);
}
export async function billingStagePrepare({account,dbToken,workerToken,fetchImpl=fetch}={}){
 await billingStagePreflight({account,dbToken,workerToken,fetchImpl});
 let writeToken=dbToken,db;
 try{db=await cfPost(writeToken,'/d1/database',{name:BILLING_STAGE_TARGET.database},fetchImpl)}
 catch(e){
  // Existing D1 token can list databases while lacking create permission.
  // Try only the separate, already-scoped Worker token, and only on HTTP 403.
  if(!String(e?.message).startsWith('MMF_PRIVATE_STAGE_CLOUD_MUTATION_HTTP_403')||
     workerToken===dbToken)throw e;
  writeToken=workerToken;
  db=await cfPost(writeToken,'/d1/database',{name:BILLING_STAGE_TARGET.database},fetchImpl);
 }
 if(db?.name!==BILLING_STAGE_TARGET.database||!UUID.test(db?.uuid))deny();
 const dbRead=await cfGet(dbToken,'/d1/database/'+db.uuid,fetchImpl);
 if(dbRead?.uuid!==db.uuid||dbRead.name!==BILLING_STAGE_TARGET.database)deny();
 const root='/d1/database/'+db.uuid+'/query';
 const schema=await cfPost(writeToken,root,{sql:MMF_PREP_BILLING_SCHEMA.join(';\n')},fetchImpl);
 // Cloudflare D1 returns a result object per SQL statement. Verify every statement.
 if(!Array.isArray(schema)||schema.length!==MMF_PREP_BILLING_SCHEMA.length||schema.some(x=>x?.success!==true))deny();
 const proof=flattenQueryResult(await cfPost(writeToken,root,{sql:"SELECT name FROM sqlite_master WHERE type='table' AND name='mmf_prep_orders'"},fetchImpl));
 if(proof.length!==1||proof[0]?.name!=='mmf_prep_orders')deny();
 const count=flattenQueryResult(await cfPost(writeToken,root,{sql:'SELECT COUNT(*) AS n FROM mmf_prep_orders'},fetchImpl));
 if(count.length!==1||count[0]?.n!==0)deny();
 const cfg=privateStageConfig(db.uuid);
 assertPrivateStageDefinition(cfg);
 return Object.freeze({databaseId:db.uuid,config:cfg,worker:BILLING_STAGE_TARGET.worker,
  sqlTablesVerified:1,initialOrders:0,publicRoutes:0,realPayment:false,customerSending:false});
}
export async function billingStageVerify({account,dbToken,workerToken,databaseId,fetchImpl=fetch}={}){
 if(account!==BILLING_STAGE_TARGET.account||!UUID.test(databaseId))deny();
 const t='/workers/scripts/'+BILLING_STAGE_TARGET.worker;
 const [cfg,sub,secret,db]=await Promise.all([
  cfGet(workerToken,t+'/settings',fetchImpl),cfGet(workerToken,t+'/subdomain',fetchImpl),
  cfGet(workerToken,t+'/secrets',fetchImpl),cfGet(dbToken,'/d1/database/'+databaseId,fetchImpl)
 ]);
 if(db?.uuid!==databaseId||db?.name!==BILLING_STAGE_TARGET.database||
    sub?.enabled!==false||sub?.previews_enabled!==false||!Array.isArray(secret)||
    !secret.some(x=>x.name==='MMF_BILLING_OPERATOR_TOKEN')||
    secret.some(x=>/PAYNOW|FMI|CHEMISTRY|RESEND|SENDING|PRIVATE_KEY/.test(x.name)))deny();
 const b=cfg?.bindings||[],value=k=>b.find(x=>x.name===k&&x.type==='plain_text')?.text;
 if(Object.entries(KEYS).some(([k,v])=>value(k)!==v))deny();
 const d=b.find(x=>x.name==='MMF_PAYMENT_DB');
 if(!d||d.type!=='d1'||(d.database_id||d.id)!==databaseId||b.some(x=>x.type==='service'||x.type==='queue'||x.type==='send_email'))deny();
 const orders=flattenQueryResult(await cfPost(dbToken,'/d1/database/'+databaseId+'/query',{sql:'SELECT COUNT(*) AS n FROM mmf_prep_orders'},fetchImpl));
 if(orders.length!==1||orders[0]?.n!==0)deny();
 return Object.freeze({gate:'MMF_PRIVATE_CLOUDFLARE_BILLING_STAGE',status:'PASS',worker:BILLING_STAGE_TARGET.worker,
  databaseId,bindingsD1Only:true,publicRoutes:0,workerDev:false,previewUrls:false,
  operatorSecretInstalled:true,stageReceiptsEnabled:false,existingPaynowBindings:0,
  customerFunds:false,customerEmail:false,actualProviderSettlement:false,orders:0});
}
async function cli(){
 const cmd=process.argv[2];if(!['preflight','prepare','verify'].includes(cmd))deny();
 const keys={account:process.env.CLOUDFLARE_ACCOUNT_ID,dbToken:process.env.MMF_D1_TOKEN,workerToken:process.env.CLOUDFLARE_API_TOKEN};
 if(cmd==='preflight'){const p=await billingStagePreflight(keys);console.log(JSON.stringify({gate:'MMF_PRIVATE_CLOUD_STAGE_PREFLIGHT',...p}));return;}
 if(cmd==='prepare'){
  const p=await billingStagePrepare(keys);
  const target='wrangler.mmf.billing-stage.deploy-20261011.jsonc';
  writeFileSync(target,JSON.stringify(p.config,null,2)+'\n',{mode:0o600});
  if(typeof process.env.RUNNER_TEMP!=='string'||!process.env.RUNNER_TEMP.startsWith('/'))deny();
  const secretPath=process.env.RUNNER_TEMP+'/mmf-billing-private-secret-20261011.json';
  writeFileSync(secretPath,JSON.stringify({MMF_BILLING_OPERATOR_TOKEN:randomBytes(48).toString('base64url')}),{mode:0o600});
  const statePath=process.env.RUNNER_TEMP+'/mmf-billing-private-db-id-20261011.txt';
  writeFileSync(statePath,p.databaseId+'\n',{mode:0o600});
  console.log(JSON.stringify({gate:'MMF_PRIVATE_CLOUD_STAGE_DATABASE_CREATED',status:'PASS',worker:p.worker,databaseId:p.databaseId,rows:0,publicRoutes:0,secretValuesPrinted:false}));
  return;
 }
 if(cmd==='verify'){
  const location=process.env.RUNNER_TEMP+'/mmf-billing-private-db-id-20261011.txt';
  const id=readFileSync(location,'utf8').trim();
  const proof=await billingStageVerify({...keys,databaseId:id});
  console.log(JSON.stringify(proof));
  writeFileSync(process.env.RUNNER_TEMP+'/mmf-billing-private-cloud-evidence-20261011.json',JSON.stringify({...proof,verifiedAt:new Date().toISOString()})+'\n',{mode:0o600});
 }
}
if(process.argv[1]?.endsWith('/authorize-private-billing-stage.mjs'))cli().catch(e=>{console.error(e.message.startsWith('MMF_PRIVATE_STAGE_')?e.message:'MMF_PRIVATE_STAGE_DENIED');process.exitCode=1});
