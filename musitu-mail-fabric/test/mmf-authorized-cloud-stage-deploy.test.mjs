import test from 'node:test';
import assert from 'node:assert/strict';
import {BILLING_STAGE_TARGET,assertPrivateStageDefinition,billingStagePreflight} from '../src/staging/authorize-private-billing-stage.mjs';
const base=Object.freeze({name:BILLING_STAGE_TARGET.worker,main:'src/commercial/billing-stage-worker.mjs',workers_dev:false,preview_urls:false,routes:[],d1_databases:[{binding:'MMF_PAYMENT_DB',database_name:BILLING_STAGE_TARGET.database,database_id:'1d7e0e84-7663-4cc1-9c63-874c48cbf064'}],vars:{MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_STAGE_RECEIPTS_ENABLED:'false',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_TENANT_ID:BILLING_STAGE_TARGET.tenant}});
test('only a new nonpublic worker with distinct D1 and payment/mail disabled is permitted',()=>{
 assert.equal(assertPrivateStageDefinition(base),true);
 for(const changed of [{workers_dev:true},{preview_urls:true},{routes:[{pattern:'example.com/*'}]},{services:[{binding:'FMI_BILLING',service:'mft-fmi-billing'}]},{vars:{...base.vars,MMF_COMMERCE_ENABLED:'true'}},{vars:{...base.vars,MMF_REAL_SEND_ENABLED:'true'}},{vars:{...base.vars,MMF_STAGE_RECEIPTS_ENABLED:'true'}},{d1_databases:[{...base.d1_databases[0],database_name:'musitu-mail-fabric-staging-20261010'}]},{name:'mft-fmi-billing'}])assert.throws(()=>assertPrivateStageDefinition({...base,...changed}),/MMF_PRIVATE_STAGE_DENIED/);
});
test('read-only Cloudflare preflight refuses reused targets, mismatched account and missing credentials',async()=>{
 const target=BILLING_STAGE_TARGET;
 const calls=[];
 const response=(code,result)=>({ok:code>=200&&code<300,status:code,json:async()=>({success:code>=200&&code<300,result})});
 const make=({dbs=[],workerMissing=true}={})=>async (url,opts)=>{
  calls.push({url,method:opts.method||'GET'});
  if(url.endsWith('/accounts/'+target.account))return response(200,{id:target.account});
  if(url.includes('/d1/database?'))return response(200,dbs);
  if(url.endsWith('/workers/scripts/'+target.worker+'/settings'))return response(workerMissing?404:200,workerMissing?null:{bindings:[]});
  return response(500,{});
 };
 const good=await billingStagePreflight({account:target.account,dbToken:'d'.repeat(24),workerToken:'w'.repeat(24),fetchImpl:make()});
 assert.equal(good.isolated,true);assert.equal(good.readyToCreate,true);assert.equal(calls.every(x=>x.method==='GET'),true);
 await assert.rejects(()=>billingStagePreflight({account:target.account,dbToken:'d'.repeat(24),workerToken:'w'.repeat(24),fetchImpl:make({dbs:[{name:target.database}]})}),/MMF_PRIVATE_STAGE_DENIED/);
 await assert.rejects(()=>billingStagePreflight({account:target.account,dbToken:'d'.repeat(24),workerToken:'w'.repeat(24),fetchImpl:make({workerMissing:false})}),/MMF_PRIVATE_STAGE_DENIED/);
 await assert.rejects(()=>billingStagePreflight({account:'other',dbToken:'d'.repeat(24),workerToken:'w'.repeat(24),fetchImpl:make()}),/MMF_PRIVATE_STAGE_DENIED/);
 await assert.rejects(()=>billingStagePreflight({account:target.account,dbToken:'',workerToken:'w'.repeat(24),fetchImpl:make()}),/MMF_PRIVATE_STAGE_DENIED/);
});
