/** One user-authorized GitHub Secrets readback. No inference or resource writes. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {inspectProviderGates} from './provider-gates-readonly-20261101.mjs';
import {readAuthorityRoles} from './authority-provider-reconcile09.mjs';
import {readAINeurons} from './workers-ai-free-client.mjs';

if(process.env.GITHUB_REPOSITORY!=='evansmusitu/mft-axiom-build'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('authorized one-shot repository runner required');
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token?.trim())throw Error('existing GitHub Cloudflare credential required');
const source=process.env.AXIOM_ACCEPTANCE_SOURCE_SHA;
if(!/^[a-f0-9]{40}$/.test(source??''))throw Error('exact source identity required');
const out=resolve('qualification/whole-system-20261029/gates11-results');
mkdirSync(out,{recursive:true});
const save=(name,value)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n');
const provider=await inspectProviderGates({token,
  savedWindow:{start:'2026-11-01T15:40:00Z',end:'2026-11-02T00:00:00Z'},
  observe:value=>save('provider-readback.json',value)});
let incidentDay;
try{
  const value=await readAINeurons({token,now:new Date('2026-11-01T23:59:59.999Z')});
  incidentDay={status:'OBSERVED',queried_at:new Date().toISOString(),window:{start:value.start,end:value.end},neurons:value.neurons,rows:value.rows,
    scope:value.scope,saved_request_usage_attributed:false};
}catch(error){incidentDay={status:'UNAVAILABLE',queried_at:new Date().toISOString(),code:error.code??null,saved_request_usage_attributed:false};}
save('incident-day-usage.json',incidentDay);
const authority=await readAuthorityRoles({token});save('authority-roles.json',authority);
const summary={schema:'musitu.axiom.saved-provider-readback11.v1',source_sha:source,observed_at:new Date().toISOString(),
  credential_route:'GITHUB_ACTIONS_CLOUDFLARE_API_TOKEN_ENV_ONLY',inference_calls:0,resource_writes:0,billing_changes:0,
  saved_cf_ray:'a53c044b0eda9b36-IAD',provider_abort:provider.checks.saved_request_rows?.value?.classification??null,
  incident_day_usage_status:incidentDay.status,authority_checks:Object.fromEntries(Object.entries(authority.checks).map(([k,v])=>[k,v.status])),
  missing_final_usage_assumed_zero:false,provider_call_reservation_retained:1,budget_refunded:false,
  owner_custodian_appointment:'AUTHORIZED_DECISION_ONLY_CARRIED_FORWARD',independent_verifier_accepted:false,
  independent_custody_proven:false,anti_rollback_certified:false,release_authorized:false};
save('summary.json',summary);console.log(JSON.stringify(summary));
