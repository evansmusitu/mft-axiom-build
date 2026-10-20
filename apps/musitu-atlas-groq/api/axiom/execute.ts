import {createHash} from 'node:crypto';
import {parseBody,parseExpression,hashPayload,respond,deny,fail,authConfigured,verifyApproval,OPERATION,TOOL_NAME,mcpCall,requestId} from './_contract.js';
const attempts=new Map<string,{count:number;until:number}>();
export default async function handler(req:any,res:any){
 if(req.method!=='POST')return respond(res,405,{error:'Method not allowed.'});
 let id=requestId();
 try{
  if(!authConfigured())throw deny(503,'Axiom execution is not activated: server account authorization and execution switch are required.');
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'private').split(',')[0].slice(0,100);
  const now=Date.now(),prior=attempts.get(ip);
  if(prior&&prior.until>now&&prior.count>=3)throw deny(429,'Three attempts per minute maximum. Wait and review before retrying.');
  attempts.set(ip,{count:prior&&prior.until>now?prior.count+1:1,until:prior&&prior.until>now?prior.until:now+60000});
  if(attempts.size>300)for(const [key,value] of attempts)if(value.until<=now)attempts.delete(key);
  const data=parseBody(req);
  const expression=parseExpression(data.expression);
  verifyApproval(data.accessCode,data.digest,data.approved);
  if(data.digest!==hashPayload(expression))throw deny(409,'Expression changed after preview. Review again before execution.');
  const token=process.env.AXIOM_MCP_BEARER_TOKEN||'';
  // Only one allowlisted certified compute operation; never allow browser-supplied tool names, paths or hosts.
  // At-most-one dispatch attempt; no automatic retries on uncertain outcomes.
  const result=await mcpCall({jsonrpc:'2.0',id,method:'tools/call',params:{
    name:TOOL_NAME,arguments:{args:{expression}}
  }},token);
  const tool=result?.result;
  if(!tool||tool.isError===true||tool?.structuredContent?.authenticated===false)
   throw deny(502,'Axiom reported an error or missing authorization; no result was accepted.');
  const sc=tool.structuredContent;
  const payload=sc?.result;
  const inner=payload&&typeof payload==='object'
   ? payload.ok===true?payload:(payload.result&&typeof payload.result==='object'?payload.result:payload)
   : {};
  if(inner?.ok!==true||typeof inner?.result!=='string')
   throw deny(502,'Axiom response did not satisfy the certified arithmetic result contract.');
  const verified=inner.verified===true?true:inner.verified===false?false:null;
  const normalized={
   operation:OPERATION,expression,result:inner.result,verified,
   kernelVersion:typeof inner.kernel_version==='string'?inner.kernel_version:null,
   computeUnits:typeof inner?.axiom?.compute_units==='number'?inner.axiom.compute_units:null
  };
  const receipt={
   requestId:id,origin:'MUSITU Axiom MCP (authenticated account call)',
   status:'PROVIDER_EXECUTED',completedAt:new Date().toISOString(),
   requestSha256:hashPayload(expression),
   resultSha256:createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
   output:normalized,
   evidenceType:'Provider-returned result with locally calculated integrity fingerprint; NOT an independent correctness proof',
   retryPolicy:'Do not automatically retry a timed-out or uncertain request. Check Axiom usage first.'
  };
  return respond(res,200,receipt);
 }catch(error){return fail(res,error);}
}
