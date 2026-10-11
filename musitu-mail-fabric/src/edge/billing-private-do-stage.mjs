/** Private Cloudflare SQLite Durable Object isolated to MMF billing STAGE.
 * Keeps FMI/Axiom/Chemistry/Paynow Workers and tables out of its capabilities.
 * workers_dev=false, routes=[], preview_urls=false, no customer payment/mail.
 */
import {fetchPrivateMmfBillingStage} from '../commercial/billing-stage-worker.mjs';
const tenantActor='mmf-stage-tenant';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const deny=()=>new Response(JSON.stringify({error:'BILLING_STAGE_DISABLED'}),{status:503,headers:H});
const safe=env=>env?.MMF_STAGE_ONLY==='true'&&env?.MMF_REAL_SEND_ENABLED==='false'&&
 env?.MMF_MAIL_SENDING_ENABLED==='false'&&env?.MMF_COMMERCE_ENABLED==='false'&&
 env?.MMF_BILLING_API_ENABLED==='true'&&env?.MMF_STAGE_RECEIPTS_ENABLED==='false'&&
 env?.MMF_API_ENABLED==='false'&&env?.MMF_WEBHOOK_ENABLED==='false'&&
 env?.MMF_TENANT_ID==='mmf_stage_20261011';
export function createIsolatedBillingSqlDb(sql){
 if(!sql||typeof sql.exec!=='function')throw Error('MMF_PRIVATE_SQLITE_STORAGE_REQUIRED');
 const run=(q,params)=>{
  if(typeof q!=='string'||q.length>4096||!/^\s*(?:CREATE TABLE|CREATE INDEX|INSERT|UPDATE|SELECT)\b/i.test(q))
   throw Error('MMF_PRIVATE_SQLITE_QUERY_DENIED');
  if(q.includes(';')||params.length>12||params.some(x=>x!==null&&!['string','number','boolean'].includes(typeof x)))
   throw Error('MMF_PRIVATE_SQLITE_QUERY_DENIED');
  const result=sql.exec(q,...params),rows=result.toArray();
  const count=sql.exec('SELECT changes() AS changes').toArray()[0]?.changes;
  if(!Array.isArray(rows)||!Number.isSafeInteger(count)||count<0)throw Error('MMF_PRIVATE_SQLITE_RESULT_DENIED');
  return {rows,changes:count};
 };
 return Object.freeze({prepare(q){
  function statement(args){return Object.freeze({
   async run(){const result=run(q,args);return {success:true,meta:{changes:result.changes}}},
   async first(){const result=run(q,args);return result.rows[0]??null},
   async all(){const result=run(q,args);return {success:true,results:result.rows}}
  })}
  return Object.freeze({...statement([]),bind(...args){return statement(args)}});
 }});
}
export class MmfBillingPrivateStageSqliteDO{
 constructor(ctx,env){
  if(!ctx?.storage?.sql?.exec)throw Error('MMF_PRIVATE_SQLITE_STORAGE_REQUIRED');
  this.env=env;
  this.db=createIsolatedBillingSqlDb(ctx.storage.sql);
 }
 async fetch(request){
  if(!safe(this.env))return deny();
  return fetchPrivateMmfBillingStage(request,{...this.env,MMF_PAYMENT_DB:this.db});
 }
}
export default {async fetch(req,env){
 if(!safe(env)||!env.MMF_BILLING_LEDGER||typeof env.MMF_BILLING_LEDGER.idFromName!=='function'||
   typeof env.MMF_BILLING_LEDGER.get!=='function')return deny();
 try{
  const id=env.MMF_BILLING_LEDGER.idFromName(tenantActor);
  const stub=env.MMF_BILLING_LEDGER.get(id);
  if(!stub?.fetch)return deny();
  return await stub.fetch(req);
 }catch{return deny()}
}};
