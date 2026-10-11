import {DatabaseSync} from 'node:sqlite';
import billingWorker from '../../src/commercial/billing-stage-worker.mjs';
import authorityWorker from '../../src/edge/mmf-paynow-private-authority-stage.mjs';
export function createInMemoryPrivateBillingTestEnv({operatorToken,callerToken,receiptToken,pem,fingerprint}){
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){return {
  bind(...values){const stmt=sqlite.prepare(sql);return {
   async run(){const x=stmt.run(...values);return {success:true,meta:{changes:Number(x.changes)}}},
   async first(){return stmt.get(...values)??null},
   async all(){return {success:true,results:stmt.all(...values)}}
  }},
  async run(){const x=sqlite.prepare(sql).run();return {success:true,meta:{changes:Number(x.changes)}}},
  async first(){return sqlite.prepare(sql).get()??null},
  async all(){return {success:true,results:sqlite.prepare(sql).all()}}
 }}};
 const base={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_TENANT_ID:'mmf_stage_20261011',MMF_STAGE_RECEIPTS_ENABLED:'true',MMF_STAGE_RECEIPT_TOKEN:receiptToken,MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM:pem,MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256:fingerprint};
 const billing={...base,MMF_PAYMENT_DB:db,MMF_BILLING_OPERATOR_TOKEN:operatorToken};
 const authority={...base,MMF_PRIVATE_AUTHORITY_STAGE_ENABLED:'true',MMF_STAGE_BRIDGE_ENABLED:'true',MMF_PRIVATE_AUTHORITY_EXPIRES_MS:String(Date.now()+12*60*1000),MMF_AUTHORITY_CALLER_TOKEN:callerToken,MMF_PRIVATE_PAYMENT_STAGE:{fetch:req=>billingWorker.fetch(req,billing)}};
 return {stage:{fetch:req=>billingWorker.fetch(req,billing)},authority:{fetch:req=>authorityWorker.fetch(req,authority)},close(){sqlite.close()}};
}
