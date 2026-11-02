/** Qualification transport: one fixed account/model, no retries or fallback. */
import {ACCOUNT_ID,FREE_MODEL} from './workers-ai-free-preflight.mjs';

export async function readAINeurons({token,fetchImpl=fetch,now=new Date()}={}){
  const end=now.toISOString(),start=end.slice(0,10)+'T00:00:00.000Z';
  const query=`query { viewer { accounts(filter: {accountTag: "${ACCOUNT_ID}"}) { aiInferenceAdaptiveGroups(limit: 1, filter: {datetime_geq: "${start}", datetime_leq: "${end}"}) { count sum { totalNeurons totalInputTokens totalOutputTokens } } } } }`;
  const response=await fetchImpl('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok||data.errors?.length)throw Object.assign(new Error('Workers AI usage could not be verified'),{code:'CF_USAGE_UNAVAILABLE',details:data.errors?.map(x=>({message:x.message,path:x.path}))});
  const accounts=data.data?.viewer?.accounts;
  if(!Array.isArray(accounts)||accounts.length!==1||!Array.isArray(accounts[0].aiInferenceAdaptiveGroups)||accounts[0].aiInferenceAdaptiveGroups.length>1)throw new Error('Workers AI account usage response invalid');
  const rows=accounts[0].aiInferenceAdaptiveGroups;
  const total=rows.length?rows[0].sum.totalNeurons:0;
  if(typeof total!=='number'||!Number.isFinite(total)||total<0)throw new Error('Workers AI neuron total invalid');
  return {observed_at:end,start,end,neurons:total,rows,scope:'ACCOUNT_WIDE_ANALYTICS_NOT_AN_ATOMIC_BILLING_LOCK'};
}

export function admitFreeAllowance(usage){
  if(!usage||!Number.isFinite(usage.neurons)||usage.neurons<0||usage.neurons>500)throw new DOMException('insufficient verified headroom for the free-allowance acceptance','QuotaExceededError');
  const observed=Date.parse(usage.observed_at);
  if(!Number.isFinite(observed)||Date.now()-observed>60000||observed>Date.now()+1000)throw new DOMException('fresh usage observation required','NotAllowedError');
  return {free_daily_neurons:10000,observed_neurons:usage.neurons,max_calls:3,max_request_bytes:8000,max_output_tokens_per_call:1800,conservative_test_allowance_neurons:1000,account_billing_hard_cap:false};
}

export function createBoundedWorkersAI({token,usage,fetchImpl=fetch,observe=()=>{}}={}){
  if(!token?.trim())throw new TypeError('existing Cloudflare credential required');
  const limits=admitFreeAllowance(usage),calls=[];
  async function request(model,input,{signal}={}){
    if(model!==FREE_MODEL||input.max_tokens>limits.max_output_tokens_per_call||!Number.isInteger(input.max_tokens)||input.max_tokens<1)throw new TypeError('only the pinned bounded model is admitted');
    const body=JSON.stringify(input);
    if(new TextEncoder().encode(body).length>limits.max_request_bytes||calls.length>=limits.max_calls)throw new DOMException('acceptance provider-call budget exhausted','QuotaExceededError');
    admitFreeAllowance(usage);
    const item={sequence:calls.length+1,model,started_at:new Date().toISOString(),request:input,status:'BEFORE_DISPATCH'};calls.push(item);await observe(calls);
    try{
      const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});
      item.http_status=response.status;item.cf_ray=response.headers.get('cf-ray');
      if(input.stream){
        if(!response.ok){await response.body?.cancel();throw new Error('Workers AI streaming request failed');}
        item.status='STREAM_OPEN';await observe(calls);return response;
      }
      const data=await response.json();
      if(!response.ok||data.success!==true)throw Object.assign(new Error('Workers AI inference failed'),{code:'CF_'+String(data.errors?.[0]?.code??response.status)});
      item.status='RESPONSE_RECEIVED';item.result=data.result;item.completed_at=new Date().toISOString();await observe(calls);return data.result;
    }catch(error){item.status='FAILED_OR_INTERRUPTED';item.error_name=error.name;item.error_code=error.code??null;await observe(calls);throw error;}
  }
  return {AI:{run:(model,input)=>request(model,input)},request,calls,limits};
}
