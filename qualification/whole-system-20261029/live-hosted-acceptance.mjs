/** Owner-authorized, isolated live acceptance. Never an independent release gate.
 * Run only by the narrowly scoped workflow. Provider secrets remain in memory.
 * Keep the D1 one-shot ledger: deleting it would allow another hosted dispatch.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {createRemoteD1} from './hosted-storage-client.mjs';
import {createD1ExecutionGovernance} from '../../ops/axiom_execution_contract.mjs';
import {createGovernedAgentModel,inspectAgentInvocations,reconcileAgentInvocation} from '../../ops/axiom_agent_model_store.mjs';
import {createHostedAgentClient} from '../../integrations/openai-agents/client.mjs';
import OpenAI from '../../integrations/openai-agents/node_modules/openai/index.mjs';
import {canonicalJson,sha256Json,verifyTaskCommitments} from '../../axiom_interface/vnext/execution_integrity.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const runId='axiom-acceptance-20261101-01';
const repository='evansmusitu/mft-axiom-build';
const accountId='93f395f5121954671f92fffa453d6b61';
const hash=value=>createHash('sha256').update(value).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeError=error=>({name:String(error?.name||'Error').slice(0,80),code:String(error?.code||'ACCEPTANCE_STEP_FAILED').slice(0,100),status:Number.isInteger(error?.status)?error.status:null});

/** Close the actual creation SSE after a durably observed turn ID. No input is
 * resent and no provider cancellation is submitted by this observer disconnect.
 * Frame-at-a-time delivery prevents a buffered completion hiding the interruption.
 */
export function interruptedCreationFetch(fetchImpl,onEvent=()=>{}){
  let creates=0,dropped=false;
  const wrapped=async(url,init={})=>{
    const target=new URL(String(url));
    if(target.pathname!=='/v1/agents/sessions'||init.method?.toUpperCase()!=='POST')return fetchImpl(url,init);
    if(++creates!==1)throw new Error('single hosted session dispatch exhausted');
    const response=await fetchImpl(url,init);
    if(!response.ok||!response.body)return response;
    const reader=response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();
    let pending='',ended=false,closeAfterFrame=false;
    const body=new ReadableStream({async pull(controller){
      if(closeAfterFrame){dropped=true;void reader.cancel().catch(()=>{});controller.close();return;}
      for(;;){
        const boundary=/\r?\n\r?\n/.exec(pending);
        if(boundary){
          const frame=pending.slice(0,boundary.index+boundary[0].length);pending=pending.slice(frame.length);
          for(const line of frame.split(/\r?\n/))if(line.startsWith('data: ')){
            try{const event=JSON.parse(line.slice(6));onEvent(event);
              if(event.type?.startsWith('agent.session.turn.')&&(event.turn_id||event.turn?.id)&&event.turn?.subagent_id==null)closeAfterFrame=true;
            }catch{ /* SDK validates provider event JSON. */ }
          }
          controller.enqueue(encoder.encode(frame));return;
        }
        if(ended){if(pending)controller.enqueue(encoder.encode(pending));controller.close();return;}
        const next=await reader.read();ended=next.done;
        pending+=next.done?decoder.decode():decoder.decode(next.value,{stream:true});
        if(pending.length>1048576){void reader.cancel().catch(()=>{});controller.error(new Error('SSE frame exceeds acceptance bound'));return;}
      }
    },cancel(){void reader.cancel().catch(()=>{});}},{highWaterMark:0});
    return new Response(body,{status:response.status,headers:response.headers});
  };
  return {fetch:wrapped,get creates(){return creates;},get dropped(){return dropped;}};
}

export async function acceptanceResult({base,contract,output,providerEvidence,control}){
  const completed_at=new Date().toISOString();
  const artifact={schema:'musitu.axiom.runtime-artifact.v1',artifact_type:'HOSTED_PROTOCOL_ACCEPTANCE',title:'Hosted protocol acceptance',objective:base.objective,
    project_id:contract.project_id,work_id:contract.work_id,agent_id:contract.agent_id,contract_sha256:contract.contract_sha256,
    actual_output:output,control,citations:[],limitations:['A protocol oracle does not qualify general reasoning or factual accuracy.','Provider cancellation applies to the session active turn.','Provider deletion is acknowledged; sandbox destruction is asynchronous.'],synthesis_mode:'OPENAI_AGENTS_GROUNDED'};
  const payload={...base,status:'COMPLETED',completed_at,runtime:{build_id:'axiom-hosted-acceptance-v1',operation_count:0,fully_connected:false},sources:[],execution:null,provider_evidence:providerEvidence,artifact};
  const receiptBody={schema:'musitu.axiom.runtime-task-receipt.v1',task_id:base.task_id,request_id:base.request_id,customer_id:base.customer_id,contract_sha256:contract.contract_sha256,
    operation:null,runtime_result_sha256:null,source_ids:[],source_commitments:[],artifact_sha256:await sha256Json(artifact),started_at:base.started_at,completed_at,status:'COMPLETED',verification_scope:'HOSTED_PROTOCOL_AND_CONTENT_COMMITMENTS_ONLY',task_payload_sha256:await sha256Json(payload)};
  return {...payload,receipt:{...receiptBody,receipt_sha256:await sha256Json(receiptBody)}};
}

export async function runGovernedHostedTask({db,report,out,save,checkpoint=async()=>{}}){
  let sessionId,turnId,controlTurnId,client;
  const sourceSha=report.source_sha;
      // The durable claim precedes all inference. An uncertain run never resends.
      await db.exec('CREATE TABLE IF NOT EXISTS axiom_acceptance_live_claim(run_id TEXT PRIMARY KEY,claimed_at TEXT NOT NULL,source_sha TEXT NOT NULL);');
      const existing=await db.prepare('SELECT * FROM axiom_acceptance_live_claim WHERE run_id=?').bind(runId).first();
      assert.equal(existing,null,'one-shot claim already exists: reconcile saved IDs; do not create another session');
      await db.prepare('INSERT INTO axiom_acceptance_live_claim VALUES(?,?,?)').bind(runId,new Date().toISOString(),sourceSha||'local').run();
      const customer={customer_id:'acceptance-hosted'},objective='Verify one hosted agent acceptance protocol.';
      const governed=await createD1ExecutionGovernance({db,customer,serverPolicy:{max_compute_calls:0,max_provider_calls:2,lease_ms:600000}}).admit({objective,context:{project_id:'acceptance-project',work_id:'hosted-one-shot',controls:{privacy:'Project',budget:0}}});
      const base={schema:'musitu.axiom.runtime-task.v1',task_id:'task_hosted_acceptance_one',request_id:'HOSTED-ACCEPTANCE-20261101-01',customer_id:customer.customer_id,objective,execution_contract:governed.contract,status:'RUNNING',started_at:new Date().toISOString()};await governed.create(base);
      await governed.reserve({kind:'model'});
      const transport=interruptedCreationFetch(fetch,event=>{if(event.session_id||event.session?.id)sessionId=event.session_id||event.session.id;if(event.turn_id||event.turn?.id)turnId=event.turn_id||event.turn.id;});
      const modelName=process.env.OPENAI_AGENTS_MODEL||'gpt-6-astra';
      const provider=createHostedAgentClient({apiKey:process.env.OPENAI_API_KEY,model:modelName,fetchImpl:transport.fetch,timeoutMs:180000});
      client={...provider,create:params=>provider.create({...params,onCheckpoint:async update=>{
        report.resources.session_id=update.session_id;report.resources.primary_turn_id=update.turn_id;save();
        await params.onCheckpoint(update);await checkpoint(update);
      }})};
      const invoke=createGovernedAgentModel({db,customer,taskId:base.task_id,governance:governed,client,model:modelName,admitted:true});
      const nonce=randomBytes(12).toString('hex');
      const input={stage:'planning',objective,registered_operations:[],acceptance_test:{nonce,integers:[17,23],instruction:'Return operation null and needs_research false. Put the unchanged nonce and the product of the two integers in operation_args as nonce and product. Return only the required plan JSON.'}};
      let output;
      try{output=await invoke(input);}catch(error){report.initial_observation_error=safeError(error);}
      const saved=await inspectAgentInvocations({db,customer,taskId:base.task_id});assert.equal(saved.length,1);sessionId=saved[0].session_id||sessionId;turnId=saved[0].turn_id||turnId;
      report.resources.session_id=sessionId;report.resources.primary_turn_id=turnId;save();
      assert.ok(sessionId&&turnId,'saved provider identities required');assert.equal(transport.creates,1);assert.equal(transport.dropped,true);
      if(!output){
        for(const delay of [5000,10000,15000]){await pause(delay);try{const state=await reconcileAgentInvocation({db,customer,taskId:base.task_id,stage:'planning',client});if(state.status==='completed')break;}catch(error){report.reconciliation_error=safeError(error);}}
        // Reading the completed invocation cache does not dispatch another input.
        output=await invoke(input);
      }
      writeFileSync(resolve(out,'hosted-output.json'),JSON.stringify({session_id:sessionId,turn_id:turnId,output},null,2)+'\n');
      assert.equal(output.needs_research,false);assert.equal(output.operation,null);assert.equal(output.operation_args.nonce,nonce);assert.equal(output.operation_args.product,391);
      const readback=await client.reconcile({sessionId,turnId});assert.deepEqual(JSON.parse(readback.output_text),output);
      const evidence=invoke.getEvidence();assert.equal(evidence.length,1);
      // The second turn is a bounded cancellation control in this SAME session,
      // separately reserved and journaled. It is never a successful model proof.
      await governed.reserve({kind:'model'});
      await db.exec('CREATE TABLE IF NOT EXISTS axiom_acceptance_controls(run_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,primary_turn_id TEXT NOT NULL,control_turn_id TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL);');
      await db.prepare('INSERT INTO axiom_acceptance_controls VALUES(?,?,?,NULL,?,?)').bind(runId,sessionId,turnId,'BEFORE_DISPATCH',new Date().toISOString()).run();
      const sdk=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:30000,logLevel:'off'}).beta.agents.sessions;
      const observer=await sdk.events.stream(sessionId,{signal:AbortSignal.timeout(45000)});
      const controlPromise=(async()=>{for await(const event of observer){const id=event.turn_id||event.turn?.id;if(event.type==='agent.session.turn.created'&&id&&id!==turnId&&event.turn?.subagent_id==null){
        controlTurnId=id;report.resources.cancellation_turn_id=id;save();
        await db.prepare('UPDATE axiom_acceptance_controls SET control_turn_id=?,status=? WHERE run_id=?').bind(id,'CHECKPOINTED',runId).run();
        await client.cancel({sessionId,turnId:id});
        await checkpoint({session_id:sessionId,turn_id:id,stage:'cancellation_control'});return id;
      }}throw new Error('cancellation turn ID was not observed');})();
      controlPromise.catch(()=>{});
      let controlTurn;
      try{
        await sdk.events.create(sessionId,{'Idempotency-Key':runId+'-cancellation-control',events:[{type:'agent.session.input.message',input:[{role:'user',content:[{type:'input_text',text:'Cancellation control. Begin preparing a plan JSON and wait for cancellation. Do not use tools or external actions.'}]}]}]});
        controlTurn=await controlPromise;
      }finally{observer.controller.abort();}
      report.resources.cancellation_turn_id=controlTurn;save();
      let terminal;
      for(let i=0;i<10;i++){terminal=await sdk.turns.retrieve(controlTurn,{session_id:sessionId});if(['completed','cancelled','failed'].includes(terminal.status))break;await pause(2000);}
      await db.prepare('UPDATE axiom_acceptance_controls SET status=? WHERE run_id=?').bind(terminal.status,runId).run();
      assert.equal(terminal.status,'cancelled','cancel request alone does not establish cancellation');
      const control={session_id:sessionId,primary_turn_id:turnId,cancellation_turn_id:controlTurn,cancellation_status:terminal.status,stream_interrupted:true,recovered_from_saved_ids:true,session_creates:transport.creates,inputs_resent:false};
      const result=await acceptanceResult({base,contract:governed.contract,output,providerEvidence:evidence,control});
      await governed.complete(result);
      const restored=await createD1ExecutionGovernance({db,customer}).get(base.task_id);assert.equal(await verifyTaskCommitments(restored),true);assert.equal(restored.receipt.receipt_sha256,result.receipt.receipt_sha256);
      writeFileSync(resolve(out,'hosted-task-receipt.json'),JSON.stringify(restored,null,2)+'\n');
      return {task_id:base.task_id,...control,oracle:{nonce_matches:true,product:391},receipt_sha256:restored.receipt.receipt_sha256,artifact_sha256:restored.receipt.artifact_sha256,provider_proof:restored.provider_evidence[0]};
}

async function main(){
  assert.equal(process.env.GITHUB_REPOSITORY,repository,'only the authorized repository runner may execute');
  assert.equal(process.env.AXIOM_ACCEPTANCE_AUTHORIZATION,'user-request-20261101-governed-hosted-one');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1','automatic reruns cannot dispatch a hosted task');
  assert.ok(process.env.OPENAI_API_KEY?.trim(),'existing provider credential is required');
  const out=resolve(process.env.AXIOM_ACCEPTANCE_OUTPUT||'qualification/whole-system-20261029/live-results');mkdirSync(out,{recursive:true});
  const sourceSha=process.env.AXIOM_ACCEPTANCE_SOURCE_SHA||process.env.GITHUB_SHA;
  const report={schema:'musitu.axiom.live-acceptance.v1',run_id:runId,started_at:new Date().toISOString(),source_sha:sourceSha,
    scope:'ISOLATED_OWNER_AUTHORIZED_ACCEPTANCE_ONLY',independent_custody_certified:false,anti_rollback_certified:false,release_authorized:false,
    checks:{},resources:{account_id:accountId},cleanup:{},limits:{hosted_sessions:1,followup_cancellation_turns:1,provider_calls:2,network:'disabled',hard_token_or_currency_cap:false}};
  const save=()=>writeFileSync(resolve(out,'acceptance.json'),JSON.stringify(report,null,2)+'\n');
  const record=async(name,action)=>{try{const value=await action();report.checks[name]={status:'CONFIRMED',value:value??true};save();return value;}catch(error){report.checks[name]={status:'FAILED',error:safeError(error)};save();throw error;}};
  const cfHeaders={};
  async function cf(path,{method='GET',body,form,allow404=false}={}){
    const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{...cfHeaders,...(body?{'content-type':'application/json'}:{})},body:form|| (body?JSON.stringify(body):undefined),redirect:'error',signal:AbortSignal.timeout(45000)});
    if(allow404&&response.status===404)return null;
    const data=await response.json();
    if(!response.ok||data.success!==true){const error=new Error('Cloudflare acceptance operation failed');error.code='CF_'+String(data.errors?.[0]?.code||response.status);error.status=response.status;throw error;}
    return data.result;
  }
  const operator=randomBytes(32).toString('hex'),alpha=randomBytes(32).toString('hex'),beta=randomBytes(32).toString('hex'),revoked=randomBytes(32).toString('hex');
  for(const value of [operator,alpha,beta,revoked])process.stdout.write('::add-mask::'+value+'\n');
  const registry={
    [hash(alpha)]:{tenant_id:'acceptance-alpha',status:'ACTIVE',roles:['tasks:read','tasks:write']},
    [hash(beta)]:{tenant_id:'acceptance-beta',status:'ACTIVE',roles:['tasks:read','tasks:write']},
    [hash(revoked)]:{tenant_id:'acceptance-revoked',status:'REVOKED',roles:['tasks:read','tasks:write']},
  };
  let dbId,baseUrl,deploymentId,workerOwned=false,workerUploadAttempted=false,sessionId,turnId,controlTurnId,client,db,bundle;
  const ownedSettings=settings=>settings?.bindings?.some(b=>b.type==='d1'&&b.name==='AXIOM_DB'&&(b.database_id||b.id)===dbId)&&settings.bindings.some(b=>b.name==='ACCEPTANCE_RUN_ID'&&b.text===runId);
  async function deploy(){
    deploymentId=randomBytes(12).toString('hex');
    const metadata={main_module:'acceptance.mjs',compatibility_date:'2026-07-01',compatibility_flags:['nodejs_compat'],bindings:[
      {type:'d1',name:'AXIOM_DB',database_id:dbId},{type:'plain_text',name:'ACCEPTANCE_RUN_ID',text:runId},
      {type:'plain_text',name:'ACCEPTANCE_DEPLOYMENT_ID',text:deploymentId},
      {type:'secret_text',name:'ACCEPTANCE_OPERATOR_TOKEN',text:operator},{type:'secret_text',name:'ACCEPTANCE_TENANTS_JSON',text:JSON.stringify(registry)},
    ]};
    const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('acceptance.mjs',new Blob([bundle],{type:'application/javascript+module'}),'acceptance.mjs');
    workerUploadAttempted=true;
    const result=await cf(`/accounts/${accountId}/workers/scripts/${runId}`,{method:'PUT',form});workerOwned=true;
    await cf(`/accounts/${accountId}/workers/scripts/${runId}/subdomain`,{method:'POST',body:{enabled:true}});
    return {version_id:result.deployment_id||result.id||null,deployment_id:deploymentId};
  }
  async function request(path,{token=operator,method='GET',body,headers={}}={}){
    return fetch(baseUrl+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
  }
  async function waitHealth(){for(let i=0;i<15;i++){try{const response=await request('/health');const health=await response.json();if(response.status===200&&health.marker_matches&&health.deployment_id===deploymentId)return;}catch{}await pause(2000);}throw new Error('current isolated Worker deployment never became healthy');}
  try{
    await record('isolated_resources',async()=>{
      const candidates=[];
      if(process.env.CLOUDFLARE_EMAIL&&process.env.CLOUDFLARE_GLOBAL_API_KEY)candidates.push({kind:'existing_global_key',headers:{'X-Auth-Email':process.env.CLOUDFLARE_EMAIL,'X-Auth-Key':process.env.CLOUDFLARE_GLOBAL_API_KEY}});
      if(process.env.CLOUDFLARE_API_TOKEN)candidates.push({kind:'existing_api_token',headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});
      report.credential_preflight=[];let databases,lastError;
      for(const candidate of candidates){
        for(const key of Object.keys(cfHeaders))delete cfHeaders[key];Object.assign(cfHeaders,candidate.headers);
        try{databases=await cf(`/accounts/${accountId}/d1/database?per_page=100`);report.credential_preflight.push({kind:candidate.kind,status:'READ_ACCESS_VERIFIED'});break;}
        catch(error){lastError=error;report.credential_preflight.push({kind:candidate.kind,status:'REJECTED',error:safeError(error)});}
      }
      if(!databases)throw lastError||Object.assign(new Error('owner Cloudflare credential unavailable'),{code:'CF_CREDENTIAL_UNAVAILABLE'});
      const existing=databases.find(item=>item.name===runId);
      dbId=existing?.uuid||(await cf(`/accounts/${accountId}/d1/database`,{method:'POST',body:{name:runId}})).uuid;
      assert.match(dbId,/^[0-9a-f-]{36}$/);report.resources.database_id=dbId;
      const query=sql=>cf(`/accounts/${accountId}/d1/database/${dbId}/query`,{method:'POST',body:{sql,params:[]}});
      if(!existing)await query(`CREATE TABLE axiom_acceptance_isolation(singleton INTEGER PRIMARY KEY CHECK(singleton=1),run_id TEXT NOT NULL UNIQUE,isolated INTEGER NOT NULL CHECK(isolated=1)); INSERT INTO axiom_acceptance_isolation VALUES(1,'${runId}',1);`);
      const marker=await query('SELECT singleton,run_id,isolated FROM axiom_acceptance_isolation');assert.deepEqual(marker[0].results,[{singleton:1,run_id:runId,isolated:1}]);
      const settings=await cf(`/accounts/${accountId}/workers/scripts/${runId}/settings`,{allow404:true});
      if(settings)assert.ok(ownedSettings(settings),'refuse foreign Worker replacement');
      const {build}=await import(process.env.AXIOM_ESBUILD_MODULE||'esbuild');
      const result=await build({entryPoints:[resolve(root,'qualification/whole-system-20261029/hosted-storage-worker.mjs')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',loader:{'.sql':'text'},logLevel:'silent'});bundle=result.outputFiles[0].text;
      const subdomain=await cf(`/accounts/${accountId}/workers/subdomain`);assert.match(subdomain.subdomain,/^[a-z0-9-]+$/);
      baseUrl=`https://${runId}.${subdomain.subdomain}.workers.dev`;report.resources.worker_url=baseUrl;
      const deployed=await deploy();
      // Initial health reports 503 until migrations are applied; schema endpoint
      // itself authenticates and checks the out-of-band isolation marker.
      let migrated=false;
      for(let i=0;i<15;i++){try{const response=await request('/operator/schema',{method:'POST',body:{run_id:runId}});if(response.ok){migrated=true;break;}if(response.status!==404&&response.status!==503)throw new Error('schema admission rejected');}catch(error){if(i===14)throw error;}await pause(2000);}
      assert.equal(migrated,true);await waitHealth();
      db=createRemoteD1({baseUrl,operatorToken:operator,runId,timeoutMs:30000});
      return {database_id:dbId,worker_url:baseUrl,bundle_sha256:hash(bundle),...deployed,production_routes_modified:false,openai_key_in_worker:false};
    });
    await record('actual_tenant_pipeline',async()=>{
      const problem=JSON.parse(readFileSync(resolve(root,'frontier_v5/fixtures/decision_analysis_v1.json'),'utf8')).cases[0].problem;
      const body={objective:'Compare the declared alternatives.',submission_id:'hosted-submission-one',execution_context:{project_id:'acceptance-project',work_id:'acceptance-decision',controls:{privacy:'Private',budget:1}},decision:problem};
      for(const token of [alpha,beta]){const response=await request('/vnext/api/tasks',{token,method:'POST',body});assert.equal(response.status,200);assert.match(await response.text(),/event: complete/);}
      const get=async token=>(await request('/vnext/api/submissions/hosted-submission-one',{token})).json();
      const first=await get(alpha),second=await get(beta);assert.equal(first.execution.result.expected_utilities.launch,28);assert.notEqual(first.task_id,second.task_id);assert.equal(await verifyTaskCommitments(first),true);
      assert.equal((await request('/vnext/api/tasks/'+first.task_id,{token:beta})).status,404);
      for(const token of [revoked,operator])assert.equal((await request('/vnext/api/submissions/hosted-submission-one',{token})).status,401);
      assert.equal((await request('/rpc-d1',{token:alpha,method:'POST',body:{run_id:runId,action:'first',sql:'SELECT 1'}})).status,401);
      assert.equal((await request('/vnext/api/submissions/hosted-submission-one',{token:alpha,headers:{origin:'https://example.com'}})).status,403);
      const replay=await request('/vnext/api/tasks',{token:alpha,method:'POST',body});assert.equal(replay.status,200);assert.ok((await replay.text()).includes(first.receipt.receipt_sha256));
      report.decision_receipt=first.receipt;writeFileSync(resolve(out,'decision-output.json'),JSON.stringify(first,null,2)+'\n');
      return {alpha_task_id:first.task_id,beta_task_id:second.task_id,expected_utility:28,receipt_sha256:first.receipt.receipt_sha256,cross_tenant_read:'DENIED',replay_same_receipt:true};
    });
    await record('durable_call_budgets_and_revocation',async()=>{
      const customer={customer_id:'acceptance-budgets'},gate=createD1ExecutionGovernance({db,customer,serverPolicy:{max_compute_calls:1,max_provider_calls:1}});
      const governed=await gate.admit({objective:'Check bounded reservations.',context:{work_id:'budget-concurrency',controls:{budget:1,privacy:'Project'}}});
      const provider=await Promise.allSettled([governed.reserve({kind:'model'}),governed.reserve({kind:'model'})]);assert.equal(provider.filter(x=>x.status==='fulfilled').length,1);
      const compute=await Promise.allSettled([governed.reserve({kind:'compute',operation:governed.contract.policy.allowed_operations[0]}),governed.reserve({kind:'compute',operation:governed.contract.policy.allowed_operations[0]})]);assert.equal(compute.filter(x=>x.status==='fulfilled').length,1);
      await governed.revoke();await assert.rejects(()=>governed.reserve({kind:'decision'}));
      const row=await db.prepare('SELECT state,compute_calls,provider_calls FROM axiom_ec_works WHERE tenant_id=? AND work_id=?').bind(customer.customer_id,'budget-concurrency').first();assert.deepEqual(row,{state:'REVOKED',compute_calls:1,provider_calls:1});
      return {concurrent_provider_reservations:1,concurrent_compute_reservations:1,revocation:'DENIED',budget_unit:'CALLS_NOT_CURRENCY'};
    });
    await record('credential_revocation_and_worker_restart',async()=>{
      const customer={customer_id:'acceptance-recovery'},objective='Recover an interrupted storage fixture.',context={work_id:'restart-work',controls:{budget:0,privacy:'Private'}};
      const policy={max_compute_calls:0,max_provider_calls:0,lease_ms:1000};
      const old=await createD1ExecutionGovernance({db,customer,serverPolicy:policy}).admit({objective,context});
      const base={task_id:'task_restart_fixture',request_id:'ACCEPTANCE-RESTART',customer_id:customer.customer_id,objective,status:'RUNNING',started_at:new Date().toISOString(),execution_contract:old.contract};await old.create(base);
      registry[hash(alpha)].status='REVOKED';const deployed=await deploy();await pause(2500);await waitHealth();
      assert.equal((await request('/vnext/api/submissions/hosted-submission-one',{token:alpha})).status,401);
      await assert.rejects(()=>old.assertBound());
      const contenders=await Promise.all([1,2].map(()=>createD1ExecutionGovernance({db,customer,serverPolicy:{...policy,lease_ms:120000}}).admit({objective,context})));
      const attempts=await Promise.allSettled(contenders.map(c=>c.resume(base.task_id)));assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
      const winner=contenders[attempts.findIndex(x=>x.status==='fulfilled')];await winner.fail({...base,status:'FAILED',completed_at:new Date().toISOString(),error_code:'ACCEPTANCE_INTERRUPTION_FIXTURE'});
      assert.equal((await createD1ExecutionGovernance({db,customer}).get(base.task_id)).status,'FAILED');
      const persisted=await (await request('/vnext/api/submissions/hosted-submission-one',{token:beta})).json();assert.equal(persisted.status,'COMPLETED');
      return {...deployed,old_lease:'DENIED',new_generation_single_winner:true,revoked_credential:'DENIED',completed_result_survived:true};
    });
    await record('governed_hosted_task',()=>runGovernedHostedTask({db,report,out,save}));
  }catch(error){report.failure=safeError(error);process.exitCode=1;}
  finally{
    // Remove the public RPC before provider cleanup; an upstream outage must not
    // keep temporary bearer credentials reachable for the rest of this job.
    if(workerUploadAttempted&&!workerOwned)try{workerOwned=ownedSettings(await cf(`/accounts/${accountId}/workers/scripts/${runId}/settings`,{allow404:true}));report.cleanup.uncertain_worker_upload_reconciled=!!workerOwned;}catch(error){report.cleanup.worker_ownership_error=safeError(error);process.exitCode=1;}
    if(workerOwned)try{await cf(`/accounts/${accountId}/workers/scripts/${runId}`,{method:'DELETE'});assert.equal(await cf(`/accounts/${accountId}/workers/scripts/${runId}/settings`,{allow404:true}),null);report.cleanup.worker={name:runId,delete_acknowledged:true,provider_readback_status:404,edge_revocation:'NOT_INDEPENDENTLY_ATTESTED'};}catch(error){report.cleanup.worker_error=safeError(error);process.exitCode=1;}
    sessionId=report.resources.session_id;turnId=report.resources.primary_turn_id;controlTurnId=report.resources.cancellation_turn_id;
    if(sessionId){try{
      // Downloaded actual text and receipt above precede deletion. Failed runs
      // preserve any available provider identities and observed terminal status.
      report.resources.session_id=sessionId;report.resources.primary_turn_id=turnId||null;report.resources.cancellation_turn_id=controlTurnId||null;
      const cleanupClient=createHostedAgentClient({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_AGENTS_MODEL||'gpt-6-astra',timeoutMs:10000});
      const cleanupSdk=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:10000,logLevel:'off'}).beta.agents.sessions;
      try{await cleanupSdk.events.create(sessionId,{events:[{type:'agent.session.input.cancel'}]},{signal:AbortSignal.timeout(10000)});report.cleanup.active_turn_cancel_requested=true;}catch(error){report.cleanup.cancel_error=safeError(error);}
      let deleted;
      for(let attempt=0;attempt<3;attempt++){try{deleted=await cleanupClient.delete({sessionId});break;}catch(error){report.cleanup.session_delete_error=safeError(error);if(attempt<2)await pause(3000);}}
      assert.equal(deleted?.deleted,true);
      const response=await fetch('https://api.openai.com/v1/agents/sessions/'+sessionId,{headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'OpenAI-Beta':'agents=v1'},redirect:'error',signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,404);await response.body?.cancel();report.cleanup.session={id:sessionId,delete_acknowledged:true,readback_status:404,sandbox_destruction:'ASYNCHRONOUS_NOT_INDEPENDENTLY_ATTESTED'};
    }catch(error){report.cleanup.session_error=safeError(error);process.exitCode=1;}}
    report.cleanup.database={id:dbId||null,retained:!!dbId,reason:'ONE_SHOT_LEDGER_AND_VERIFIABLE_ACCEPTANCE_RECORDS'};
    report.completed_at=new Date().toISOString();report.status=process.exitCode?'FAILED':'CONFIRMED';save();
    const files=['acceptance.json','hosted-output.json','hosted-task-receipt.json','decision-output.json'];
    const manifest={schema:'musitu.axiom.acceptance-files.v1',files:files.flatMap(name=>{try{const content=readFileSync(resolve(out,name));return [{name,bytes:content.length,sha256:hash(content)}];}catch{return [];}})};
    writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    process.stdout.write(JSON.stringify({status:report.status,checks:Object.fromEntries(Object.entries(report.checks).map(([k,v])=>[k,v.status])),release_authorized:false})+'\n');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
