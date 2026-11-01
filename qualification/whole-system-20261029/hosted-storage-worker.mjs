/** Temporary acceptance worker. Bind only a fresh isolated D1 whose marker was
 * seeded out of band before deployment. This worker has no provider credential,
 * production runtime, kernel substitute, or claimed compute qualification.
 * Bundle with esbuild --bundle --format=esm --platform=browser --loader:.sql=text.
 * Tenant registry: SHA256(bearer) -> {tenant_id,status,roles}; roles are
 * tasks:read/tasks:write and status is ACTIVE/REVOKED.
 */
import executionContractSchema from '../../ops/axiom_execution_contract_schema.sql';
import evidenceLifecycleSchema from '../../ops/axiom_evidence_lifecycle_schema.sql';
import {handleRuntimeTaskApi} from '../../ops/axiom_runtime_task_api.mjs';

const encoder=new TextEncoder();
const runPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;
const tenantPattern=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/;
const commonHeaders=Object.freeze({'cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin','content-type':'application/json; charset=utf-8'});
const rateSchema='CREATE TABLE IF NOT EXISTS axiom_acceptance_rate_limits(run_id TEXT NOT NULL,tenant_id TEXT NOT NULL,window_start INTEGER NOT NULL,hits INTEGER NOT NULL CHECK(hits BETWEEN 1 AND 30),PRIMARY KEY(run_id,tenant_id,window_start));';
const canonicalDDL=[executionContractSchema,evidenceLifecycleSchema].map(schema=>schema.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n').trim().split(/\n(?=(?:PRAGMA|INSERT|CREATE (?:TABLE|TRIGGER|INDEX))\b)/u).map(sql=>sql.replace(/\s+/g,' ').trim()).join('\n')).join('\n')+'\n'+rateSchema;
const schemaObjects=['axiom_ec_projects','axiom_ec_agents','axiom_ec_works','axiom_ec_runs','axiom_ec_artifacts','axiom_ec_reservations','axiom_ec_evidence','axiom_ec_agent_invocations','axiom_ec_agent_completion_guards','axiom_ec_artifact_active_lease','axiom_ec_agent_completion_snapshot','axiom_acceptance_rate_limits'];

class BoundaryError extends Error{
  constructor(status,code){super(code);this.status=status;this.code=code;}
}
const reject=(status,code)=>{throw new BoundaryError(status,code);};
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,400);
function json(status,value){return new Response(JSON.stringify(value),{status,headers:commonHeaders});}
function fail(status,code,extra={}){return json(status,{ok:false,error:{code,message:code,...extra}});}
function record(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))reject(400,'unsupported_request_fields');
  return value;
}
function expectedRun(env){
  if(typeof env.ACCEPTANCE_RUN_ID!=='string'||!runPattern.test(env.ACCEPTANCE_RUN_ID)||!env.AXIOM_DB?.prepare)reject(503,'acceptance_configuration_unavailable');
  return env.ACCEPTANCE_RUN_ID;
}
async function markerMatches(db,runId){
  try{
    const rows=await db.prepare('SELECT singleton,run_id,isolated FROM axiom_acceptance_isolation LIMIT 2').all();
    return rows.results?.length===1&&rows.results[0].singleton===1&&rows.results[0].run_id===runId&&rows.results[0].isolated===1;
  }catch{return false;}
}
async function assertMarker(env,runId){if(!await markerMatches(env.AXIOM_DB,runId))reject(503,'isolated_database_marker_required');}
function rejectBrowser(request){
  // Undici adds sec-fetch-mode:cors to server fetches. Browsers also supply
  // Sec-Fetch-Site (a forbidden script header), which we always reject.
  if(request.headers.has('origin')||request.headers.has('cookie')||[...request.headers.keys()].some(key=>key.startsWith('sec-fetch-')&&(key!=='sec-fetch-mode'||request.headers.get(key)!=='cors')))reject(403,'browser_request_forbidden');
}
function bearer(request){
  const match=/^Bearer ([\x21-\x7e]{32,512})$/.exec(request.headers.get('authorization')||'');
  if(!match)reject(401,'acceptance_bearer_required');
  return match[1];
}
async function sha256(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function sameHash(left,right){let difference=left.length^right.length;for(let i=0;i<64;i++)difference|=(left.charCodeAt(i)||0)^(right.charCodeAt(i)||0);return difference===0;}
async function operatorHash(env){
  if(typeof env.ACCEPTANCE_OPERATOR_TOKEN!=='string'||!/^[\x21-\x7e]{32,512}$/.test(env.ACCEPTANCE_OPERATOR_TOKEN))reject(503,'acceptance_operator_unavailable');
  return sha256(env.ACCEPTANCE_OPERATOR_TOKEN);
}
async function authenticateOperator(request,env){if(!sameHash(await sha256(bearer(request)),await operatorHash(env)))reject(401,'operator_bearer_required');}
async function authenticateTenant(request,env,requiredRole){
  const digest=await sha256(bearer(request));
  if(sameHash(digest,await operatorHash(env)))reject(401,'tenant_bearer_required');
  let registry;
  try{registry=JSON.parse(env.ACCEPTANCE_TENANTS_JSON);}catch{reject(503,'acceptance_tenant_registry_unavailable');}
  if(!registry||typeof registry!=='object'||Array.isArray(registry)||Object.keys(registry).length>512)reject(503,'acceptance_tenant_registry_unavailable');
  for(const [key,value]of Object.entries(registry)){
    if(!/^[0-9a-f]{64}$/.test(key)||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(field=>!['tenant_id','status','roles'].includes(field))||typeof value.tenant_id!=='string'||!tenantPattern.test(value.tenant_id)||!['ACTIVE','REVOKED'].includes(value.status)||!Array.isArray(value.roles)||new Set(value.roles).size!==value.roles.length||value.roles.some(role=>!['tasks:read','tasks:write'].includes(role)))reject(503,'acceptance_tenant_registry_unavailable');
  }
  const tenant=Object.hasOwn(registry,digest)?registry[digest]:null;
  if(!tenant||tenant.status!=='ACTIVE')reject(401,'tenant_bearer_required');
  if(!tenant.roles.includes(requiredRole))reject(403,'tenant_role_required');
  return Object.freeze({customer_id:tenant.tenant_id});
}
async function boundedJson(request,maxBytes){
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))reject(415,'application_json_required');
  if(Number(request.headers.get('content-length')||0)>maxBytes)reject(413,'request_too_large');
  if(!request.body)reject(400,'json_body_required');
  const reader=request.body.getReader(),decoder=new TextDecoder();let text='',received=0,done=false,timer;
  const expired=new Promise((_,fail)=>{timer=setTimeout(()=>fail(new BoundaryError(408,'request_body_deadline')),10000);});
  try{
    for(;;){
      const next=await Promise.race([reader.read(),expired]);
      if(next.done){done=true;break;}
      received+=next.value.byteLength;if(received>maxBytes)reject(413,'request_too_large');
      text+=decoder.decode(next.value,{stream:true});
    }
    text+=decoder.decode();
    try{return JSON.parse(text);}catch{reject(400,'invalid_json');}
  }finally{clearTimeout(timer);if(!done)void reader.cancel().catch(()=>{});else reader.releaseLock();}
}
function checkedSql(sql){
  if(typeof sql!=='string'||!sql.trim()||encoder.encode(sql).byteLength>262144)reject(400,'bounded_sql_required');
  if(/axiom_acceptance_isolation/i.test(sql))reject(403,'protected_isolation_marker');
  if(/\b(?:ATTACH|DETACH)\b/i.test(sql))reject(403,'database_attachment_forbidden');
  return sql;
}
function params(values=[]){
  if(!Array.isArray(values)||values.length>1000)reject(400,'bounded_bindings_required');
  return values.map(value=>{
    if(value===null||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return value;
    if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&Array.isArray(value.$d1_blob)&&value.$d1_blob.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))return new Uint8Array(value.$d1_blob).buffer;
    reject(400,'unsupported_binding_type');
  });
}
function statement(db,value){record(value,['sql','params']);return db.prepare(checkedSql(value.sql)).bind(...params(value.params));}
async function rpc(request,env,runId){
  const input=record(await boundedJson(request,4194304),['run_id','action','sql','params','column','statements']);
  if(input.run_id!==runId)reject(409,'acceptance_run_mismatch');
  await assertMarker(env,runId);
  if(!['first','all','run','batch','exec'].includes(input.action))reject(400,'unsupported_d1_operation');
  if(input.action==='batch'){
    record(input,['run_id','action','statements']);
    if(!Array.isArray(input.statements)||!input.statements.length||input.statements.length>100)reject(400,'bounded_nonempty_batch_required');
  }else if(input.action==='exec')record(input,['run_id','action','sql']);
  else record(input,['run_id','action','sql','params',...(input.action==='first'?['column']:[])]);
  if(input.column!==undefined&&(typeof input.column!=='string'||!input.column||input.column.length>200))reject(400,'bounded_first_column_required');
  try{
    let result;
    if(input.action==='batch')result=await env.AXIOM_DB.batch(input.statements.map(value=>statement(env.AXIOM_DB,value)));
    else if(input.action==='exec')result=await env.AXIOM_DB.exec(checkedSql(input.sql));
    else{
      const prepared=statement(env.AXIOM_DB,{sql:input.sql,params:input.params});
      result=input.action==='first'?await prepared.first(input.column):await prepared[input.action]();
    }
    return json(200,{ok:true,run_id:runId,result});
  }catch(error){
    if(error instanceof BoundaryError)throw error;
    return fail(502,'D1_OPERATION_FAILED',{message:clean(error?.message||'D1 operation failed'),may_have_executed:true});
  }
}
function rateLimiter(db,runId,customer){
  return {async limit(){
    const window=Math.floor(Date.now()/60000);
    const row=await db.prepare('INSERT INTO axiom_acceptance_rate_limits(run_id,tenant_id,window_start,hits) VALUES(?1,?2,?3,1) ON CONFLICT(run_id,tenant_id,window_start) DO UPDATE SET hits=hits+1 WHERE hits<30 RETURNING hits').bind(runId,customer.customer_id,window).first();
    return {success:!!row&&row.hits<=30};
  }};
}
async function health(env){
  let runId;
  try{runId=expectedRun(env);}catch{return json(503,{schema:'axiom.hosted-storage-acceptance.v1',marker_matches:false,execution_schema_ready:false,production_authority:false});}
  const marker=await markerMatches(env.AXIOM_DB,runId);let schemaReady=false;
  if(marker)try{
    const rows=await env.AXIOM_DB.prepare("SELECT name FROM sqlite_master WHERE type IN('table','trigger')").all();
    const names=new Set(rows.results.map(row=>row.name));schemaReady=schemaObjects.every(name=>names.has(name));
  }catch{}
  return json(marker?200:503,{schema:'axiom.hosted-storage-acceptance.v1',run_id:runId,deployment_id:typeof env.ACCEPTANCE_DEPLOYMENT_ID==='string'?env.ACCEPTANCE_DEPLOYMENT_ID:null,marker_matches:marker,execution_schema_ready:schemaReady,production_authority:false,compute_qualified:false});
}

export default {
  async fetch(request,env,executionCtx){
    try{
      const path=new URL(request.url).pathname;
      if(path==='/health')return request.method==='GET'?health(env):fail(405,'method_not_allowed');
      const operator=path==='/rpc-d1'||path==='/operator/schema';
      const tenant=path==='/vnext/api/tasks'||/^\/vnext\/api\/tasks\/[A-Za-z0-9_-]{6,100}$/.test(path)||/^\/vnext\/api\/submissions\/[A-Za-z0-9_-]{6,90}$/.test(path);
      if(!operator&&!tenant)return fail(404,'not_found');
      rejectBrowser(request);
      const runId=expectedRun(env);
      if(operator){
        await authenticateOperator(request,env);
        if(request.method!=='POST')return fail(405,'method_not_allowed');
        if(path==='/rpc-d1')return await rpc(request,env,runId);
        const body=record(await boundedJson(request,1024),['run_id']);
        if(body.run_id!==runId)reject(409,'acceptance_run_mismatch');
        await assertMarker(env,runId);
        const result=await env.AXIOM_DB.exec(canonicalDDL);
        return json(200,{ok:true,run_id:runId,schema:'ops/axiom_execution_contract_schema.sql',result});
      }
      if(!(request.method==='POST'&&path==='/vnext/api/tasks'||request.method==='GET'&&path!=='/vnext/api/tasks'))return fail(405,'method_not_allowed');
      const customer=await authenticateTenant(request,env,request.method==='POST'?'tasks:write':'tasks:read');
      await assertMarker(env,runId);
      let forwarded=request;
      if(request.method==='POST'){
        const body=await boundedJson(request,8192);
        if(!body||typeof body!=='object'||Array.isArray(body)||!Object.hasOwn(body,'decision'))reject(400,'acceptance_decision_required');
        const headers=new Headers(request.headers);headers.delete('content-length');
        forwarded=new Request(request.url,{method:'POST',headers,body:JSON.stringify(body)});
      }
      // Pass only the D1 binding and a real D1 counter. No provider bindings,
      // OpenAI secret, service substitute, or externally fetched data enter here.
      return await handleRuntimeTaskApi(forwarded,{AXIOM_DB:env.AXIOM_DB,TASK_RATE_LIMITER:rateLimiter(env.AXIOM_DB,runId,customer)},{customer,origin:null,executionCtx,fetchImpl:async()=>{throw new DOMException('acceptance external provider access forbidden','NotAllowedError');}});
    }catch(error){
      if(error instanceof BoundaryError)return fail(error.status,error.code);
      return fail(503,'acceptance_operation_unavailable');
    }
  },
};
