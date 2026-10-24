import {mcpCall,respond,fail,authConfigured,requestId} from './_contract.js';
import {ledgerReady,auditStatus,assessRuntimeRole} from './_ledger.js';
export default async function handler(req:any,res:any){
 if(req.method!=='GET')return respond(res,405,{error:'Method not allowed.'});
 try{
  const result=await mcpCall({jsonrpc:'2.0',id:requestId(),method:'tools/list',params:{}});
  const all=result?.result?.tools;
  if(!Array.isArray(all)||!all.length)throw Object.assign(new Error('Axiom registry returned no tools.'),{code:502});
  const math=all.filter((item:any)=>typeof item?.name==='string'&&item.name.startsWith('axiom_'));
  const hasArithmetic=math.some((item:any)=>item.name==='axiom_arithmetic_evaluate');
  const [audit,role]=await Promise.all([ledgerReady()?auditStatus().catch(()=>null):null,ledgerReady()?assessRuntimeRole().catch(()=>null):null]);
  return respond(res,200,{
   source:'live MUSITU Axiom MCP tools/list',
   endpoint:'mcp.mftintelligence.com',
   publicTools:all.length,
   certifiedOperationTools:math.length,
   sample:math.slice(0,12).map((item:any)=>({name:String(item.name).slice(0,80),title:String(item.title||item.name).slice(0,100)})),
   arithmeticAvailable:hasArithmetic,
   executionConfigured:authConfigured()&&ledgerReady()&&role?.restricted===true,
   credentialStored:Boolean(process.env.AXIOM_MCP_BEARER_TOKEN),
   ledgerConfigured:ledgerReady(),ledgerOperational:audit!==null,ledger:audit,
   runtimeRoleRestricted:role?.restricted===true,
   runtimeRoleChecked:role!==null,
   runtimeRoleOverprivileged:role?.excessivePrivilege===true,
   qualification:'Live PostgreSQL session assessed for unsafe inherited membership, RLS bypass, DELETE, DDL and required minimum table grants.',
   authorizationModel:'explicit preview → operator confirmation → server-held bearer; never automatic',
   currentCapability:'arithmetic.evaluate',
   note:'Live registry discovery is read-only. Certified operations require an entitled Axiom account. No execution is performed by this endpoint.',
   checkedAt:new Date().toISOString()
  });
 }catch(error){return fail(res,error);}
}
