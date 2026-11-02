/** Read-only account/AI admission. Never runs a model or changes billing. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const ACCOUNT_ID='93f395f5121954671f92fffa453d6b61';
export const FREE_MODEL='@cf/google/gemma-4-26b-a4b-it';

export async function inspectFreeWorkersAI({token,fetchImpl=fetch,observe=()=>{}}={}){
  const report={schema:'musitu.axiom.workers-ai-free-preflight.v1',observed_at:new Date().toISOString(),
    source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA??null,account_id:ACCOUNT_ID,model:FREE_MODEL,
    inference_calls:0,billing_changes:0,deployments:0,database_mutations:0,release_authorized:false,
    checks:{},admitted:false};
  if(!token?.trim()){report.blocker='EXISTING_CLOUDFLARE_TOKEN_MISSING';observe(report);return report;}
  const queries=[['subscriptions',`/accounts/${ACCOUNT_ID}/subscriptions`],
    ['worker_account_settings',`/accounts/${ACCOUNT_ID}/workers/account-settings`],
    ['ai_model_access',`/accounts/${ACCOUNT_ID}/ai/models/search?search=${encodeURIComponent(FREE_MODEL)}&per_page=100`]];
  for(const [name,path] of queries){
    try{
      const response=await fetchImpl('https://api.cloudflare.com/client/v4'+path,{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
      const data=await response.json();
      const item={http_status:response.status,success:response.ok&&data.success===true,error_codes:(data.errors??[]).map(e=>e.code)};
      if(item.success){
        if(name==='subscriptions'){
          item.subscriptions=(Array.isArray(data.result)?data.result:[]).map(x=>({status:x.state??x.status??null,price:x.price??null,rate_plan:x.rate_plan?{id:x.rate_plan.id,public_name:x.rate_plan.public_name,scope:x.rate_plan.scope}:null}));
          item.result_info=data.result_info??null;
        }else if(name==='worker_account_settings')item.settings={default_usage_model:data.result?.default_usage_model??null};
        else item.models=(Array.isArray(data.result)?data.result:[]).filter(x=>x.name===FREE_MODEL).map(x=>({name:x.name,id:x.id,properties:x.properties??null}));
      }
      report.checks[name]=item;
    }catch(error){report.checks[name]={success:false,error_name:error.name};}
    observe(report);
  }
  // A read-only catalogue response does not prove a usable, non-billable quota.
  // Require explicit Free plan evidence before admitting a later inference run.
  const subscriptions=report.checks.subscriptions;
  const plans=subscriptions?.subscriptions??[];
  const workerPlans=plans.filter(p=>/workers/i.test((p.rate_plan?.id??'')+' '+(p.rate_plan?.public_name??'')));
  const explicitFree=workerPlans.some(p=>/free/i.test((p.rate_plan?.id??'')+' '+(p.rate_plan?.public_name??''))&&p.price===0);
  const paidOrUnknown=workerPlans.some(p=>p.price!==0||!/free/i.test((p.rate_plan?.id??'')+' '+(p.rate_plan?.public_name??'')));
  const fullPage=!subscriptions?.result_info||!(subscriptions.result_info.total_pages>1);
  report.free_plan_verified=subscriptions?.success===true&&explicitFree&&!paidOrUnknown&&fullPage;
  report.model_listed=report.checks.ai_model_access?.success===true&&report.checks.ai_model_access.models?.length===1;
  report.admitted=report.free_plan_verified&&report.model_listed;
  report.blocker=report.admitted?null:!report.free_plan_verified?'NON_BILLABLE_PLAN_NOT_VERIFIED':'WORKERS_AI_MODEL_ACCESS_NOT_VERIFIED';
  observe(report);return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.env.GITHUB_REPOSITORY!=='evansmusitu/mft-axiom-build'||process.env.GITHUB_RUN_ATTEMPT!=='1'||process.env.AXIOM_FREE_AUTHORIZATION!=='user-do-it-20261101-free-alternative')throw new Error('authorized one-shot repository runner required');
  const out=resolve('qualification/whole-system-20261029/workers-ai-free-results');mkdirSync(out,{recursive:true});
  const report=await inspectFreeWorkersAI({token:process.env.CLOUDFLARE_API_TOKEN,observe:r=>writeFileSync(resolve(out,'preflight.json'),JSON.stringify(r,null,2)+'\n')});
  console.log(JSON.stringify({admitted:report.admitted,blocker:report.blocker,inference_calls:0}));
}
