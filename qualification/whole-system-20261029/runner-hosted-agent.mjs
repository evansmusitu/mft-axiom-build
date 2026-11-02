/** Live OpenAI-hosted model test; governance is local workerd, with immutable
 * remote checkpoint artifacts. This explicitly does NOT qualify hosted D1.
 */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {runGovernedHostedTask} from './live-hosted-acceptance.mjs';
import {createHostedAgentClient,safeHostedProviderFailureCode} from '../../integrations/openai-agents/client.mjs';
import OpenAI from '../../integrations/openai-agents/node_modules/openai/index.mjs';

const root=process.cwd(),out=resolve(root,'qualification/whole-system-20261029/runner-live-results');
const attempt=process.env.AXIOM_ACCEPTANCE_ATTEMPT||'01';assert.ok(['01','02','03','04'].includes(attempt));
const repo='evansmusitu/mft-axiom-build',claimName='axiom-hosted-dispatch-20261101-'+attempt;
assert.equal(process.env.GITHUB_REPOSITORY,repo);assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
assert.equal(process.env.AXIOM_ACCEPTANCE_AUTHORIZATION,'user-request-20261101-governed-hosted-one');
mkdirSync(out,{recursive:true});
async function github(path){
  const response=await fetch('https://api.github.com/repos/'+repo+path,{headers:{authorization:'Bearer '+process.env.GH_TOKEN,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(response.ok,true,'remote dispatch claim must be readable');return response.json();
}
if(process.argv.includes('--claim')){
  const result=await github('/actions/artifacts?per_page=100&name='+claimName);
  assert.equal(result.artifacts.filter(item=>item.name===claimName).length,0,'a prior remote dispatch claim exists; do not resend');
  assert.equal(result.total_count,0,'remote claim lookup must be empty before dispatch');
  writeFileSync(resolve(out,'dispatch-claim.json'),JSON.stringify({schema:'musitu.axiom.hosted-dispatch-claim.v1',name:claimName,run_id:process.env.GITHUB_RUN_ID,source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,claimed_at:new Date().toISOString(),status:'RESERVED_BEFORE_ANY_PROVIDER_DISPATCH',storage_scope:'LOCAL_WORKERD_WITH_REMOTE_CHECKPOINTS',release_authorized:false},null,2)+'\n');
}else{
  assert.ok(process.env.OPENAI_API_KEY?.trim(),'reuse-approved provider credential required');
  assert.match(process.env.AXIOM_REMOTE_CLAIM_ID||'',/^\d+$/);
  const claim=await github('/actions/artifacts/'+process.env.AXIOM_REMOTE_CLAIM_ID);
  assert.equal(claim.name,claimName);assert.equal(String(claim.workflow_run.id),process.env.GITHUB_RUN_ID);assert.equal(claim.expired,false);
  if(attempt!=='01')for(const previous of ['sess_0f98359bc2ef389b006ae6d3c45d90819da04de8d14d057f1c',...(['03','04'].includes(attempt)?['sess_0511bcd34e3b2dbc006ae6d582055c819e84a5078d8ca685c9']:[]),...(attempt==='04'?['sess_05e73702a5f56bd0006ae6d8bdd54c8192997871f2c6ef9538']:[])]){
    const response=await fetch('https://api.openai.com/v1/agents/sessions/'+previous,{headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'OpenAI-Beta':'agents=v1'},redirect:'error',signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,404,'the previous failed mission must be deleted; never resend uncertain input');await response.body?.cancel();
  }
  const dependencies=createRequire(new URL('./live-runner-deps/package.json',import.meta.url));
  const {Miniflare}=await import(dependencies.resolve('miniflare')),{build}=await import(dependencies.resolve('esbuild')),{DefaultArtifactClient}=await import(dependencies.resolve('@actions/artifact'));
  const artifactClient=new DefaultArtifactClient();
  assert.ok(process.env.ACTIONS_RUNTIME_TOKEN&&process.env.ACTIONS_RESULTS_URL,'Actions-native artifact credentials required before provider dispatch');
  const probePath=resolve(out,'checkpoint-service-probe.json');
  writeFileSync(probePath,JSON.stringify({run_id:process.env.GITHUB_RUN_ID,source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,provider_dispatched:false})+'\n');
  const probe=await artifactClient.uploadArtifact('axiom-hosted-checkpoint-probe-'+process.env.GITHUB_RUN_ID,[probePath],out,{retentionDays:90});
  assert.ok(probe.id,'remote checkpoint client must ACK its pre-inference probe');
  const runId='axiom-acceptance-20261101-'+attempt,operator=randomBytes(32).toString('hex');
  process.stdout.write('::add-mask::'+operator+'\n');
  const built=await build({entryPoints:[resolve(root,'qualification/whole-system-20261029/hosted-storage-worker.mjs')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',loader:{'.sql':'text'},logLevel:'silent'});
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],cf:false,script:built.outputFiles[0].text,
    d1Databases:{AXIOM_DB:'00000000-0000-4000-8000-000000002026'},d1Persist:resolve(out,'private-local-d1'),bindings:{ACCEPTANCE_RUN_ID:runId,ACCEPTANCE_OPERATOR_TOKEN:operator,ACCEPTANCE_TENANTS_JSON:'{}'}});
  const report={schema:'musitu.axiom.runner-hosted-acceptance.v1',run_id:runId,source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,started_at:new Date().toISOString(),
    scope:'OPENAI_HOSTED_MODEL_WITH_LOCAL_WORKERD_GOVERNANCE',hosted_storage_qualified:false,hosted_d1_blocker:'CF_7406_ACCOUNT_DATABASE_LIMIT',remote_claim_artifact_id:claim.id,
    resources:{},checkpoint_probe_artifact_id:probe.id,checkpoints:[],checks:{},cleanup:{},independent_custody_certified:false,anti_rollback_certified:false,release_authorized:false,
    limits:{sessions:1,cancellation_followup_turns:1,hard_token_or_currency_cap:false}};
  const save=()=>writeFileSync(resolve(out,'acceptance.json'),JSON.stringify(report,null,2)+'\n');save();
  const safe=error=>({name:String(error?.name||'Error').slice(0,80),code:String(error?.code||'ACCEPTANCE_FAILED').slice(0,100),status:Number.isInteger(error?.status)?error.status:null,...(typeof error?.provider_error_code==='string'?{provider_error_code:safeHostedProviderFailureCode(error.provider_error_code)}:{})});
  let db;
  try{
    db=await mf.getD1Database('AXIOM_DB');
    await db.exec('CREATE TABLE axiom_acceptance_isolation(singleton INTEGER PRIMARY KEY CHECK(singleton=1),run_id TEXT NOT NULL UNIQUE,isolated INTEGER NOT NULL CHECK(isolated=1));');
    await db.prepare('INSERT INTO axiom_acceptance_isolation VALUES(1,?1,1)').bind(runId).run();
    const schema=await mf.dispatchFetch('https://isolated-acceptance.test/operator/schema',{method:'POST',headers:{authorization:'Bearer '+operator,'content-type':'application/json'},body:JSON.stringify({run_id:runId})});assert.equal(schema.status,200);
    const checkpoint=async update=>{
      const name='axiom-hosted-checkpoint-'+process.env.GITHUB_RUN_ID+'-'+(report.checkpoints.length+1);
      const path=resolve(out,name+'.json');
      const journal={schema:'musitu.axiom.hosted-checkpoint.v1',source_sha:report.source_sha,claim_artifact_id:claim.id,checkpoint:update,at:new Date().toISOString(),rows:{}};
      for(const table of ['axiom_ec_works','axiom_ec_runs','axiom_ec_reservations','axiom_ec_agent_invocations'])journal.rows[table]=(await db.prepare('SELECT * FROM '+table+' WHERE tenant_id=?').bind('acceptance-hosted').all()).results;
      if(update.stage==='cancellation_control')journal.rows.axiom_acceptance_controls=(await db.prepare('SELECT * FROM axiom_acceptance_controls WHERE run_id=?').bind(runId).all()).results;
      writeFileSync(path,JSON.stringify(journal,null,2)+'\n');
      const uploaded=await artifactClient.uploadArtifact(name,[path],out,{retentionDays:90});assert.ok(uploaded.id,'checkpoint must be remotely acknowledged');
      report.checkpoints.push({artifact_id:uploaded.id,name,checkpoint:update,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});save();
    };
    const verified=await runGovernedHostedTask({db,report,out,save,checkpoint,acceptanceRunId:runId});
    report.checks.governed_hosted_task={status:'CONFIRMED',value:verified};
  }catch(error){
    report.checks.governed_hosted_task={status:'FAILED',error:safe(error)};process.exitCode=1;
    if(report.resources.session_id&&report.resources.primary_turn_id)try{
      const sdk=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:10000,logLevel:'off'}).beta.agents.sessions;
      const turn=await sdk.turns.retrieve(report.resources.primary_turn_id,{session_id:report.resources.session_id},{signal:AbortSignal.timeout(10000)});
      report.provider_status_before_cleanup={turn_id:turn.id,session_id:turn.session_id,status:turn.status,object:turn.object,...(turn.error?{provider_error_code:safeHostedProviderFailureCode(turn.error.code)}:{})};
    }catch(statusError){report.provider_status_error=safe(statusError);}
  }
  finally{
    if(db)try{
      const rows={};for(const table of ['axiom_ec_works','axiom_ec_runs','axiom_ec_artifacts','axiom_ec_evidence','axiom_ec_reservations','axiom_ec_agent_invocations','axiom_ec_agent_completion_guards'])rows[table]=(await db.prepare('SELECT * FROM '+table+' WHERE tenant_id=?').bind('acceptance-hosted').all()).results;
      writeFileSync(resolve(out,'final-governance-journal.json'),JSON.stringify({schema:'musitu.axiom.local-governance-journal.v1',scope:report.scope,source_sha:report.source_sha,rows},null,2)+'\n');
    }catch(journalError){report.journal_error=safe(journalError);process.exitCode=1;}
    const sessionId=report.resources.session_id;
    if(sessionId)try{
      const sdk=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:10000,logLevel:'off'}).beta.agents.sessions;
      try{await sdk.events.create(sessionId,{events:[{type:'agent.session.input.cancel'}]},{signal:AbortSignal.timeout(10000)});report.cleanup.active_turn_cancel_requested=true;}catch(error){report.cleanup.cancel_error=safe(error);}
      const client=createHostedAgentClient({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_AGENTS_MODEL||'gpt-6-astra',timeoutMs:10000});
      let deleted;for(let i=0;i<3;i++){try{deleted=await client.delete({sessionId});break;}catch(error){report.cleanup.delete_error=safe(error);if(i<2)await new Promise(resolve=>setTimeout(resolve,3000));}}
      assert.equal(deleted?.deleted,true);
      const response=await fetch('https://api.openai.com/v1/agents/sessions/'+sessionId,{headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'OpenAI-Beta':'agents=v1'},redirect:'error',signal:AbortSignal.timeout(10000)});
      assert.equal(response.status,404);await response.body?.cancel();report.cleanup.session={id:sessionId,delete_acknowledged:true,readback_status:404,sandbox_destruction:'ASYNCHRONOUS_NOT_INDEPENDENTLY_ATTESTED'};
    }catch(error){report.cleanup.session_error=safe(error);process.exitCode=1;}
    await mf.dispose();report.completed_at=new Date().toISOString();report.status=process.exitCode?'FAILED':'CONFIRMED';save();
    process.stdout.write(JSON.stringify({status:report.status,scope:report.scope,checkpoint_count:report.checkpoints.length,hosted_storage_qualified:false,release_authorized:false})+'\n');
  }
}
