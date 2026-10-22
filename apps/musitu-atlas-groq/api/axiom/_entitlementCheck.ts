// Owner-initiated non-compute Axiom entitlement check.
// No arbitrary tool dispatch: requests a deliberately nonexistent operation.
// An unknown-tool response from the known OAuth gate is a *preliminary* signal,
// NOT proof of a successful account-metered arithmetic execution.
import {MCP_URL,deny,mcpCall,requestId} from './_contract.js';
import {enforceRuntimeRole} from './_ledger.js';
const PROBE_NAME='__atlas_permission_probe_NOT_A_REAL_TOOL_v1__';
export type AxiomPreflight={
 databaseRestricted:boolean;providerResponded:boolean;
 providerGateStatus:'CREDENTIAL_REJECTED'|'UNKNOWN_TOOL_AFTER_GATE'|'INCONCLUSIVE';
 operationExecuted:false;providerComputeUnitsClaimed:0;
 readyForApprovedArithmeticTest:boolean;
 note:string;
};
export async function preflight():Promise<AxiomPreflight>{
 const role=await enforceRuntimeRole();
 if(!role.restricted)throw deny(503,'Execution ledger role did not satisfy read-only privilege qualification.');
 const credential=process.env.AXIOM_MCP_BEARER_TOKEN||'';
 if(credential.length<12)throw deny(503,'Server-held Axiom bearer credential is missing.');
 const available=await mcpCall({jsonrpc:'2.0',id:requestId(),method:'tools/list',params:{}});
 const catalog=available?.result?.tools;
 if(!Array.isArray(catalog)||catalog.length<1)throw deny(502,'Live provider registry unavailable.');
 if(catalog.some((tool:any)=>tool?.name===PROBE_NAME))throw deny(503,'Preflight name unexpectedly registered; refusing tool invocation.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
 try{
  const response=await fetch(MCP_URL,{method:'POST',signal:controller.signal,
   headers:{
    'Content-Type':'application/json','Accept':'application/json',
    'MCP-Protocol-Version':'2025-06-18',
    'User-Agent':'MUSITU-ATLAS-Authorization-Preflight/1.0',
    'Authorization':'Bearer '+credential
   },
   body:JSON.stringify({
    jsonrpc:'2.0',id:requestId(),method:'tools/call',
    params:{name:PROBE_NAME,arguments:{}}
   })
  });
  if(response.status===401||response.status===403)return{
   databaseRestricted:true,providerResponded:true,providerGateStatus:'CREDENTIAL_REJECTED',
   operationExecuted:false,providerComputeUnitsClaimed:0,readyForApprovedArithmeticTest:false,
   note:'The provider rejected this token. Check its type, expiry and axiom.execute entitlement; no arithmetic request was sent.'
  };
  if(!response.ok)throw deny(502,'Provider returned a non-success HTTP status during preflight.');
  const body=await response.text();
  if(body.length>15000)throw deny(502,'Unexpected oversized preflight response.');
  const data=JSON.parse(body);
  const rejected=data?.result?.structuredContent?.authenticated===false;
  if(rejected)return{
   databaseRestricted:true,providerResponded:true,providerGateStatus:'CREDENTIAL_REJECTED',
   operationExecuted:false,providerComputeUnitsClaimed:0,readyForApprovedArithmeticTest:false,
   note:'Axiom denied entitlement for this bearer; this test did not request arithmetic execution.'
  };
  // The published gate implementation validates OAuth scope before forwarding
  // unregistered tools. Unknown-tool is promising, but deployment might differ.
  const unknownTool=data?.error?.code===-32601
   ||(data?.result?.isError===true&&JSON.stringify(data.result?.content||[]).toLowerCase().includes('not found'));
  return {
   databaseRestricted:true,providerResponded:true,
   providerGateStatus:unknownTool?'UNKNOWN_TOOL_AFTER_GATE':'INCONCLUSIVE',
   operationExecuted:false,providerComputeUnitsClaimed:0,
   readyForApprovedArithmeticTest:unknownTool,
   note:unknownTool?
    'Unknown-tool rejection observed after the known OAuth-gate route. This suggests authorization was accepted, but does not certify a real arithmetic execution or account billing status.':
    'Axiom responded, but its authorization status cannot be inferred without a separately approved real operation.'
  };
 }finally{clearTimeout(timer);}
}
