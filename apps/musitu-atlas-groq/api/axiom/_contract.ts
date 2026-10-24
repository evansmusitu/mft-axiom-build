import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';

export const MCP_URL='https://mcp.mftintelligence.com/mcp';
export const OPERATION='arithmetic.evaluate';
export const TOOL_NAME='axiom_arithmetic_evaluate';
export function hashPayload(expression:string):string {
 return createHash('sha256').update(JSON.stringify({version:'axiom-atlas-v1',operation:OPERATION,args:{expression}})).digest('hex');
}
export function parseExpression(value:unknown):string{
 if(typeof value!=='string')throw Object.assign(new Error('Expression must be a string.'),{code:400});
 const expression=value.trim();
 if(!expression||expression.length>160||!/^[0-9+\-*/().,%^\s]+$/.test(expression)||!/[0-9]/.test(expression))
  throw Object.assign(new Error('Use a simple arithmetic expression (up to 160 characters; no variables or code).'),{code:400});
 return expression;
}
export function parseBody(req:any):Record<string,unknown>{
 if(typeof req.body==='string'){
  if(req.body.length>2500)throw Object.assign(new Error('Request exceeds size limit.'),{code:413});
  const o=JSON.parse(req.body);return o&&typeof o==='object'&&!Array.isArray(o)?o:{};
 }
 const o=req.body;
 return o&&typeof o==='object'&&!Array.isArray(o)?o:{};
}
export function respond(res:any,status:number,data:unknown){
 return res.setHeader('Cache-Control','no-store').status(status).json(data);
}
export function deny(status:number,message:string){return Object.assign(new Error(message),{code:status});}
export function fail(res:any,error:unknown){
 const e=error as {code?:number;message?:string};
 const status=typeof e.code==='number'&&[400,401,403,409,413,429,502,503].includes(e.code)?e.code:503;
 return respond(res,status,{error:e.message||'Operation unavailable.'});
}
export function authConfigured():boolean{
 return process.env.ATLAS_AXIOM_EXECUTE_ENABLED==='enabled'
  && Boolean(process.env.AXIOM_MCP_BEARER_TOKEN)
  && Boolean(process.env.ATLAS_AXIOM_OPERATOR_CODE)
  && (process.env.ATLAS_AXIOM_OPERATOR_CODE||'').length>=24;
}
export function verifyApproval(value:unknown,expected:unknown,approved:unknown){
 if(approved!==true)throw deny(403,'Approve the specific Axiom operation before it can execute.');
 const secret=process.env.ATLAS_AXIOM_OPERATOR_CODE||'';
 if(secret.length<24||typeof value!=='string')throw deny(403,'Private operator code required.');
 const a=createHash('sha256').update(value).digest();
 const b=createHash('sha256').update(secret).digest();
 if(!timingSafeEqual(a,b))throw deny(403,'Invalid private operator code.');
 if(typeof expected!=='string'|| !/^[a-f0-9]{64}$/.test(expected))throw deny(409,'Preview digest missing. Review the operation again.');
}
export async function mcpCall(request:Record<string,unknown>,bearer?:string){
 const headers:Record<string,string>={
  'Content-Type':'application/json','Accept':'application/json, text/event-stream',
  'MCP-Protocol-Version':'2025-06-18','User-Agent':'MUSITU-ATLAS-AXIOM-Bridge/1.0'
 };
 if(bearer)headers.Authorization='Bearer '+bearer;
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),18000);
 try{
  const response=await fetch(MCP_URL,{
   method:'POST',headers,body:JSON.stringify(request),signal:controller.signal
  });
  if(response.status===401||response.status===403)throw deny(403,'Axiom authentication failed or lacks axiom.execute permission.');
  if(!response.ok)throw deny(502,'Axiom MCP returned HTTP '+response.status+'.');
  const body=await response.text();
  if(body.length>260000)throw deny(502,'Axiom response exceeded the safe size limit.');
  const contentType=response.headers.get('content-type')||'';
  let data:any;
  if(contentType.includes('text/event-stream')){
   const events=body.split('\n').filter(x=>x.startsWith('data:'));
   if(events.length!==1)throw deny(502,'Axiom streamed an unexpected number of events.');
   data=JSON.parse(events[0].slice(5).trim());
  }else data=JSON.parse(body);
  if(data?.error)throw deny(502,'Axiom MCP rejected the request.');
  return data;
 }finally{clearTimeout(timer);}
}
export function requestId(){return randomUUID();}
