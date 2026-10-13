/** B21 TEST-ONLY local Workerd endpoint: real B18 admission for genuine OpenHands
 * requests; returns no model replies and has NO provider client, credentials,
 * deployment route, production authority or externally safe authentication.
 * Never deploy. The public/private Ed25519 JWK fixtures are known synthetic keys.
 */
import {guardedDispatch,digestPayload} from '../../trackb17/dispatch_guard.mjs';
import {utcDay} from '../../trackb16/src/identity.mjs';
import {TEST_PRIVATE_JWK} from '../../trackb16/test/fixture_key.mjs';
import {WORKLOAD_TEST_PRIVATE_JWK} from '../../trackb16/test/fixture_workload_key.mjs';
export {AxiomB16QuotaLedger} from '../../trackb16/src/worker.mjs';
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const MODEL='b21-synthetic-gated';
const WORKERS=new Set(['agent-a','agent-b']);
const OPERATIONS=new Set(['0','1','2']);
const DENY=Object.freeze({status:'DENIED',dispatch_allowed:false});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
async function sign(jwk,doc){
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'Ed25519'},false,['sign']);
  const bytes=encoder.encode(JSON.stringify(doc));
  return {payload_b64:b64(bytes),signature_b64:b64(await crypto.subtle.sign('Ed25519',key,bytes))};
}
async function hex(src){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',src)),x=>x.toString(16).padStart(2,'0')).join('');}
function validateBody(data){
  if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).sort().join(',')!=='agent,ordinal,raw_b64')throw Error('SCHEMA_DENIED');
  if(!WORKERS.has(data.agent)||!OPERATIONS.has(data.ordinal)||typeof data.raw_b64!=='string'||data.raw_b64.length<20||data.raw_b64.length>82000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.raw_b64))throw Error('INPUT_DENIED');
  const raw=Uint8Array.from(atob(data.raw_b64),c=>c.charCodeAt(0));
  if(raw.length>60000)throw Error('SDK_REQUEST_TOO_LARGE');
  if(b64(raw)!==data.raw_b64)throw Error('ENCODING_DENIED');
  const rawText=decoder.decode(raw);
  const incoming=JSON.parse(rawText);
  if(!incoming||Array.isArray(incoming)||typeof incoming!=='object'||!['b12-synthetic','openai/b12-synthetic'].includes(incoming.model)||incoming.stream===true||!Array.isArray(incoming.messages)||!Array.isArray(incoming.tools)||incoming.tools.length<2)throw Error('SDK_MODEL_SCHEMA_DENIED');
  const names=incoming.tools.map(t=>t?.function?.name);
  if(!names.includes('file_editor')||!names.includes('finish'))throw Error('SDK_TOOLS_DENIED');
  return {agent:data.agent,ordinal:data.ordinal,raw};
}
export default {
  async fetch(req,env){
    // ISOLATED TEST DRIVER ONLY. Keep this module out of production, and never
    // expose a public route. This bearer is ephemeral CI-scoped, not auth proof.
    if(req.headers.get('X-Axiom-B21-Local-Secret')!==env.AXIOM_B21_TEST_SECRET||!env.AXIOM_B21_TEST_SECRET||env.AXIOM_B21_TEST_SECRET.length<30)
      return json({...DENY,reason:'ISOLATED_TEST_BEARER_DENIED'},403);
    const url=new URL(req.url);
    if(req.method==='GET'&&url.pathname==='/_internal_s0_health')return json({stage:'B21_LOCAL_ONLY',ready:true});
    if(req.method!=='POST'||url.pathname!=='/_internal_s0_admit')return json({...DENY,reason:'ROUTE_DISABLED'},404);
    let operation;
    try{
      if(Number(req.headers.get('Content-Length')||0)>93000)throw Error('REQUEST_TOO_LARGE');
      operation=validateBody(await req.json());
    }catch{return json({...DENY,reason:'MALFORMED_SDK_REQUEST'},403);}
    const now=Math.floor(Date.now()/1000),day=utcDay(),worker=operation.agent;
    // Signed fixtures belong to this isolated test and are NOT independent
    // production grant or remaining-capacity certificates.
    const grant=await sign(TEST_PRIVATE_JWK,{
      schema:'musitu.axiom.trackb15.s0.quota-grant.v1',account_id:env.AXIOM_ACCOUNT_ID,
      utc_day:day,tenant_id:'tenant-b21-synthetic',workload_id:worker,
      grant_id:'b21-local-'+worker,issued_at:now-3,expires_at:now+90,
      max_calls:3,max_per_call_neurons:100,daily_capacity_neurons:600,
      provider_remaining_certified:true,production_authority:false
    });
    // B17 signed body includes the SHA-256 of every byte of the exact original
    // OpenHands SDK JSON request (which may exceed B17's 32KiB model-body cap).
    // The trusted broker replays the captured original unchanged only on PASS.
    const sdkRawSha256=await hex(operation.raw);
    const payload={model:MODEL,messages:[{role:'user',content:worker+'|sdk-original-sha256:'+sdkRawSha256}],max_output_tokens:32};
    let request_sha;
    try{request_sha=await digestPayload(payload);}catch{return json({...DENY,reason:'SDK_PAYLOAD_TOO_LARGE'},403);}
    const request_id='b21-'+worker+'-'+operation.ordinal;
    const signedGrantBytes=encoder.encode(grant.payload_b64+'.'+grant.signature_b64);
    const authorization=await sign(WORKLOAD_TEST_PRIVATE_JWK,{
      schema:'axiom.trackb16.s0.workload-auth.v1',audience:'axiom.trackb16.s0.reserve',
      account_id:env.AXIOM_ACCOUNT_ID,utc_day:day,tenant_id:'tenant-b21-synthetic',
      workload_id:worker,request_id,request_sha,neurons:100,
      grant_sha256:await hex(signedGrantBytes),issued_at:now-3,expires_at:now+60,
      production_authority:false
    });
    const request={auth:authorization,signed:grant,request_id,request_sha,neurons:100,
      tenant_id:'tenant-b21-synthetic',workload_id:worker};
    let result;
    try{
      result=await guardedDispatch({trustedEnv:env,request,payload,allowedModels:[MODEL],
        maxOutputTokens:32,now:()=>Date.now(),sendProvider:async bytes=>({
          synthetic_transport:true,canonical_body_sha256:await hex(bytes)})});
    }catch(err){
      const reason=(typeof err?.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(err.code))?err.code:'GOVERNED_ADMISSION_FAILURE';
      return json({...DENY,reason},403);
    }
    if(result.status!=='COMPLETED'||!result.provider_result?.synthetic_transport)
      return json({...DENY,reason:result.status==='REPLAY_DENIED'?'REPLAY_DENIED':
        (typeof result.reason==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(result.reason))?result.reason:'QUOTA_DENIED'},409);
    return json({status:'COMPLETED',synthetic:true,request_id,
      canonical_body_sha256:result.provider_result.canonical_body_sha256,dispatch_allowed:false});
  }
};
