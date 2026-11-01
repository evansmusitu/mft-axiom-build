/** Reconcile saved requests and inspect capacity. No inference or remote writes. */
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ACCOUNT_ID} from './workers-ai-free-preflight.mjs';
import {readAINeurons} from './workers-ai-free-client.mjs';

const digest=v=>createHash('sha256').update(String(v)).digest('hex');
const unwrap=t=>t?(t.name||unwrap(t.ofType)):null;
const scalarNames=new Set(['datetime','date','modelId','modelName','requestId','rayId','status','statusCode','errorCode','errorDescription','responseStatus','responseStatusCode','totalNeurons','neurons','totalInputTokens','totalOutputTokens','inputTokens','outputTokens','requestSource','sampleInterval','inferenceTimeMs','requestBytesIn','requestBytesOut']);
export function safeInferenceFields(rowType){return (rowType?.fields??[]).filter(x=>scalarNames.has(x.name)&&['String','Int','Float','Boolean','Date','DateTime','Time','string','uint64','uint32','float64','datetime'].includes(unwrap(x.type))).map(x=>x.name);}
export function classifySavedCancellation(rows,ray='a53c044b0eda9b36'){
  const exact=rows.filter(row=>Object.entries(row).some(([key,value])=>/^(?:rayId|requestId)$/i.test(key)&&String(value).split('-')[0]===ray));
  if(exact.length!==1)return {status:'UNRESOLVED',reason:exact.length?'AMBIGUOUS_REQUEST_ID':'SAVED_REQUEST_ID_NOT_FOUND',exact_matches:exact.length,final_usage:null};
  const row=exact[0],code=row.errorCode,status=String(row.status??row.responseStatus??'').toLowerCase();
  const cancelled=code===3008||code==='3008'||['aborted','cancelled','canceled'].includes(status);
  const usage=row.totalNeurons??row.neurons;
  return {status:cancelled?'PROVIDER_ABORT_RECORD_CONFIRMED':'PROVIDER_TERMINAL_ABORT_NOT_CONFIRMED',provider_record:row,
    final_usage:typeof usage==='number'&&Number.isFinite(usage)&&usage>=0?usage:null,
    usage_scope:'EXACT_ID_PROVIDER_ANALYTICS_RECORD_NOT_INVOICE'};
}

export async function inspectProviderGates({token,fetchImpl=fetch,observe=()=>{},savedWindow={start:'2026-11-01T15:42:00Z',end:'2026-11-01T15:46:00Z'}}={}){
  const {start,end}=savedWindow;
  if(typeof start!=='string'||typeof end!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(start)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(end)||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>86400000)throw new TypeError('bounded saved-request time window required');
  const report={schema:'musitu.axiom.provider-gates-readonly.v1',observed_at:new Date().toISOString(),source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,
    inference_calls:0,remote_resource_writes:0,existing_database_mutations:0,billing_changes:0,release_authorized:false,checks:{}};
  if(!token?.trim())throw new Error('existing Cloudflare token required');
  async function call(path,{query}={}){
    const response=await fetchImpl('https://api.cloudflare.com/client/v4'+path,{method:query?'POST':'GET',headers:{authorization:'Bearer '+token,...(query?{'content-type':'application/json'}:{})},...(query?{body:JSON.stringify({query})}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
    const data=await response.json();
    if(!response.ok||data.success===false||data.errors?.length)throw Object.assign(new Error('read-only provider query rejected'),{http_status:response.status,errors:(data.errors??[]).map(e=>({code:e.code,message:e.message}))});
    return data;
  }
  const capture=async(name,fn)=>{try{report.checks[name]={status:'OBSERVED',value:await fn()};}catch(error){report.checks[name]={status:'UNAVAILABLE',error:{name:error.name,http_status:error.http_status??null,errors:error.errors??null}};}await observe(report);};
  await capture('current_daily_usage',()=>readAINeurons({token,fetchImpl}));
  await capture('d1_inventory',async()=>{
    const data=await call(`/accounts/${ACCOUNT_ID}/d1/database?per_page=100`);
    if(!Array.isArray(data.result))throw new Error('database inventory missing');
    return {count:data.result.length,result_info:data.result_info??null,databases:data.result.map(x=>({name:x.name,id_sha256:digest(x.uuid)})),existing_database_changes:0};
  });
  await capture('account_entitlements',async()=>{const data=await call(`/accounts/${ACCOUNT_ID}/entitlements`);return data.result;});
  await capture('security_account_visibility',async()=>{
    const data=await call('/accounts?per_page=50');if(!Array.isArray(data.result))throw new Error('account inventory missing');
    const matches=data.result.filter(x=>x.name==='MUSITU AXIOM Security Authority');
    return {accounts_visible:data.result.length,result_info:data.result_info??null,production_account_visible:data.result.some(x=>x.id===ACCOUNT_ID),security_account_matches:matches.map(x=>({name:x.name,id:x.id,id_sha256:digest(x.id),is_production:x.id===ACCOUNT_ID})),independent_custody_proven:false};
  });
  let types=[];
  await capture('inference_analytics_schema',async()=>{
    const data=await call('/graphql',{query:'query { __schema { types { name } } }'});
    types=(data.data?.__schema?.types??[]).map(x=>x.name).filter(x=>/AiInferenceAdaptive(?:$|Fields$|Filter_InputObject$|GroupsDimensions$|GroupsSum$)/i.test(x)).slice(0,12);
    const result=[];
    for(const name of types){
      const x=await call('/graphql',{query:`query { __type(name: "${name}") { name fields { name description type { name kind ofType { name kind ofType {name kind} } } } inputFields { name type {name kind ofType {name kind}} } } }`});
      result.push(x.data?.__type);
    }
    return result;
  });
  const schema=report.checks.inference_analytics_schema?.value??[];
  const rowType=schema.find(x=>/AiInferenceAdaptive(?:Fields)?$/i.test(x?.name??'')&&x?.fields);
  await capture('saved_request_rows',async()=>{
    const fields=safeInferenceFields(rowType);
    if(!fields.length)throw new Error('per-request analytics schema unavailable');
    const filters=schema.find(x=>/AiInferenceAdaptiveFilter_InputObject$/i.test(x?.name??''))?.inputFields?.map(x=>x.name)??[];
    const startKey=filters.includes('datetime_geq')?'datetime_geq':'datetime_gt';
    const endKey=filters.includes('datetime_leq')?'datetime_leq':'datetime_lt';
    const query=`query { viewer { accounts(filter: {accountTag: "${ACCOUNT_ID}"}) { aiInferenceAdaptive(limit: 100, filter: {${startKey}: "${start}", ${endKey}: "${end}"}) { ${fields.join(' ')} } } } }`;
    const data=await call('/graphql',{query}),accounts=data.data?.viewer?.accounts;
    if(!Array.isArray(accounts)||accounts.length!==1||!Array.isArray(accounts[0].aiInferenceAdaptive))throw new Error('per-request analytics missing');
    return {window:{start,end},fields,rows:accounts[0].aiInferenceAdaptive,classification:classifySavedCancellation(accounts[0].aiInferenceAdaptive),pagination_exhausted:accounts[0].aiInferenceAdaptive.length<100};
  });
  report.completed_at=new Date().toISOString();await observe(report);return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.env.GITHUB_REPOSITORY!=='evansmusitu/mft-axiom-build'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw new Error('authorized one-shot repository runner required');
  const out=resolve('qualification/whole-system-20261029/provider-gates-readonly-results');mkdirSync(out,{recursive:true});
  const report=await inspectProviderGates({token:process.env.CLOUDFLARE_API_TOKEN,observe:r=>writeFileSync(resolve(out,'readback.json'),JSON.stringify(r,null,2)+'\n')});
  console.log(JSON.stringify(report));
}
