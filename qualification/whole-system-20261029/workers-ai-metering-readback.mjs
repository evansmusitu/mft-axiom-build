/** Delayed usage read only. No inference, resource or billing mutations. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {readAINeurons} from './workers-ai-free-client.mjs';
assert.equal(process.env.GITHUB_REPOSITORY,'evansmusitu/mft-axiom-build');
assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
const out='qualification/whole-system-20261029/workers-ai-metering-results';mkdirSync(out,{recursive:true});
const report={schema:'musitu.axiom.workers-ai-metering-readback.v1',source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,inference_calls:0,billing_changes:0,prior_completed_response_neurons:52.20908737182617,cancellation_final_usage:'UNAVAILABLE_AFTER_CLIENT_ABORT',snapshots:[],release_authorized:false};
try{
  for(let i=0;i<3;i++){
    const usage=await readAINeurons({token:process.env.CLOUDFLARE_API_TOKEN});report.snapshots.push(usage);
    if(usage.neurons>=report.prior_completed_response_neurons)break;
    if(i<2)await new Promise(r=>setTimeout(r,10000));
  }
  const last=report.snapshots.at(-1);
  report.status=last.neurons>=report.prior_completed_response_neurons?'PROVIDER_USAGE_VISIBLE':'ANALYTICS_NOT_RECONCILED_WITH_COMPLETED_RESPONSES';
  report.daily_allowance_observed_remaining=10000-last.neurons;
  report.zero_invoice_or_atomic_billing_cap_certified=false;
}catch(error){report.status='READBACK_FAILED';report.error={name:error.name,code:error.code??null};process.exitCode=1;}
finally{writeFileSync(out+'/metering.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
