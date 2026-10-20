import {getVercelOidcToken} from '@vercel/oidc';

type Msg={role:'system'|'user'|'assistant';content:string};
export type CreditStatus={balance:number|null,totalUsed:number|null,verified:boolean,status:string};
export async function token():Promise<string>{
  const v=await getVercelOidcToken();
  if(!v || typeof v!=='string')throw Object.assign(new Error('Vercel project OIDC not available'),{code:503});
  return v;
}
export async function credits():Promise<CreditStatus>{
  let key:string;
  try{key=await token();}catch{return {balance:null,totalUsed:null,verified:false,status:'oidc-unavailable'};}
  try{
    const response=await fetch('https://ai-gateway.vercel.sh/v1/credits',{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    if(!response.ok)return {balance:null,totalUsed:null,verified:false,status:'gateway-http-'+response.status};
    const data=await response.json();
    const balance=Number(data.balance),totalUsed=Number(data.total_used);
    if(!Number.isFinite(balance)||!Number.isFinite(totalUsed))return{balance:null,totalUsed:null,verified:false,status:'malformed-response'};
    return {balance,totalUsed,verified:true,status:'readable'};
  }catch{return {balance:null,totalUsed:null,verified:false,status:'network-error'};}
}
function deny(status:number,message:string){return Object.assign(new Error(message),{code:status});}
export async function viaGateway(model:string,messages:Msg[],maxTokens:number):Promise<{answer:string;model:string;provider:string;promptTokens:number|null;completionTokens:number|null;generationId:string|null}>{
  // Neither the OIDC token nor the credits are ever returned to the client.
  if(process.env.ATLAS_LAB_USE_GATEWAY!=='enabled' || process.env.ATLAS_GATEWAY_BUDGET_VERIFIED!=='yes')
    throw deny(403,'Gateway tests require a separately verified, capped budget.');
  const credit=await credits();
  if(!credit.verified||credit.balance===null||credit.balance<0.3)
    throw deny(403,'No confirmed sufficient Gateway credit balance. Tests are blocked.');
  const oidc=await token();
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),55000);
  try{
    const res=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{
      method:'POST',headers:{Authorization:'Bearer '+oidc,'Content-Type':'application/json'},
      body:JSON.stringify({
        model,messages,stream:false,max_completion_tokens:Math.min(1100,Math.max(180,maxTokens)),
        // Never request a different model if this one fails.
      }),signal:controller.signal
    });
    if(!res.ok){
      const code=res.status===429?429:502;
      throw deny(code,'Vercel Gateway rejected model request (HTTP '+res.status+'). No fallback or retry.');
    }
    const payload=await res.json();
    const answer=payload?.choices?.[0]?.message?.content;
    if(typeof answer!=='string'||!answer.trim())throw deny(502,'Gateway returned no usable text');
    return {answer:answer.trim(),model,provider:'Vercel AI Gateway',
      promptTokens:Number.isFinite(Number(payload.usage?.prompt_tokens))?Number(payload.usage.prompt_tokens):null,
      completionTokens:Number.isFinite(Number(payload.usage?.completion_tokens))?Number(payload.usage.completion_tokens):null,
      generationId:typeof payload.id==='string'?payload.id:null
    };
  }finally{clearTimeout(timeout);}
}
export async function generationCost(generationId:string):Promise<number|null>{
 if(!/^gen_[A-Za-z0-9_-]{8,64}$/.test(generationId))return null;
 const oidc=await token();
 for(let i=0;i<3;i++){
  const res=await fetch('https://ai-gateway.vercel.sh/v1/generation?id='+encodeURIComponent(generationId),{
    headers:{Authorization:'Bearer '+oidc,Accept:'application/json'},signal:AbortSignal.timeout(10000)
  }).catch(()=>null);
  if(res?.ok){const data=await res.json();const cost=Number(data?.data?.total_cost);return Number.isFinite(cost)?cost:null;}
  if(res?.status!==404)break;
  if(i<2)await new Promise(resolve=>setTimeout(resolve,1300));
 }
 return null; // Asynchronous ingestion: unknown is not zero.
}


// Zero-rated models must be explicit free-only slugs. Never accept arbitrary model
// IDs or fall back to a paid model when provider availability changes.
const ZERO_RATED_MODELS=new Set(['reflection/beam-free']);
export async function viaZeroRatedGateway(
 model:string,messages:Msg[],maxTokens:number
):Promise<{answer:string;model:string;provider:string;promptTokens:number|null;completionTokens:number|null;generationId:string|null}>{
 if(!ZERO_RATED_MODELS.has(model))throw deny(403,'Model is not in the strictly zero-rated allowlist.');
 if(process.env.ATLAS_LAB_USE_GATEWAY!=='enabled')throw deny(403,'Private lab Gateway connection unavailable.');
 const bearer=await token();
 const timeout=AbortSignal.timeout(45000);
 const trimmed=messages.slice(-3).map(m=>({role:m.role,content:m.content.slice(0,1000)}));
 const response=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{
  method:'POST',
  headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
  body:JSON.stringify({model,messages:trimmed,stream:false,max_completion_tokens:Math.max(100,Math.min(650,maxTokens))}),
  signal:timeout
 });
 if(!response.ok)throw deny(response.status===429?429:502,'Free-only Gateway model refused the request (HTTP '+response.status+'). No paid fallback attempted.');
 const payload=await response.json();
 const message=payload?.choices?.[0]?.message?.content;
 if(typeof message!=='string'||!message.trim())throw deny(502,'Free-only Gateway returned no usable text.');
 return {answer:message.trim(),model,provider:'Vercel Gateway / Reflection Free',
  promptTokens:typeof payload?.usage?.prompt_tokens==='number'?payload.usage.prompt_tokens:null,
  completionTokens:typeof payload?.usage?.completion_tokens==='number'?payload.usage.completion_tokens:null,
  generationId:typeof payload.id==='string'?payload.id:null};
}
