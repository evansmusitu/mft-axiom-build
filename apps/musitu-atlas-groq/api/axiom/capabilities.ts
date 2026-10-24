import {mcpCall,respond,fail,authConfigured,requestId} from './_contract.js';
import {ledgerReady,auditStatus,assessRuntimeRole} from './_ledger.js';
import {finishOAuth,oauthConfigured,sessionStatus,publicIssuerStatus} from './_oauth.js';
export default async function handler(req:any,res:any){
 if(req.method!=='GET')return respond(res,405,{error:'Method not allowed.'});
 const u=new URL(String(req.url||'/api/axiom/capabilities'),'https://musitu-atlas-ai-lab.vercel.app');
 if(u.searchParams.has('code')||u.searchParams.has('error')||u.searchParams.has('state')){
   // Browser-to-server OAuth callback. Authorization code/state never enter
   // React, analytics or the final redirect URL.
   const next=(status:string)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
     res.setHeader('Location','/?tab=axiom&oauth='+status);res.statusCode=303;res.end();};
   if(u.searchParams.has('error'))return next('cancelled');
   try{
     const result=await finishOAuth(req,u.searchParams.get('code')||'',u.searchParams.get('state')||'');
     res.setHeader('Set-Cookie',result.clearCookie);
     return next('connected');
   }catch{return next('rejected');}
 }

 try{
  const result=await mcpCall({jsonrpc:'2.0',id:requestId(),method:'tools/list',params:{}});
  const all=result?.result?.tools;
  if(!Array.isArray(all)||!all.length)throw Object.assign(new Error('Axiom registry returned no tools.'),{code:502});
  const math=all.filter((item:any)=>typeof item?.name==='string'&&item.name.startsWith('axiom_'));
  const hasArithmetic=math.some((item:any)=>item.name==='axiom_arithmetic_evaluate');
  const [audit,role,oauth,issuer]=await Promise.all([ledgerReady()?auditStatus().catch(()=>null):null,ledgerReady()?assessRuntimeRole().catch(()=>null):null,sessionStatus().catch(()=>({configured:false,connected:false,status:'UNAVAILABLE'})),publicIssuerStatus()]);
  return respond(res,200,{
   source:'live MUSITU Axiom MCP tools/list',
   endpoint:'mcp.mftintelligence.com',
   publicTools:all.length,
   certifiedOperationTools:math.length,
   sample:math.slice(0,12).map((item:any)=>({name:String(item.name).slice(0,80),title:String(item.title||item.name).slice(0,100)})),
   arithmeticAvailable:hasArithmetic,
   executionConfigured:authConfigured()&&ledgerReady()&&role?.restricted===true,
   credentialStored:Boolean(process.env.AXIOM_MCP_BEARER_TOKEN),
   oauthConfigured:oauthConfigured(),oauthSession:oauth,
   issuerDiscovery:issuer,
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
