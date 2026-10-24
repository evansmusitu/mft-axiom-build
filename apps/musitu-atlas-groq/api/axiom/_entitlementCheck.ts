// Owner-initiated non-compute Axiom entitlement check.
// No arbitrary tool dispatch: requests a deliberately nonexistent operation.
// An unknown-tool response from the known OAuth gate is a *preliminary* signal,
// NOT proof of a successful account-metered arithmetic execution.
import {MCP_URL,deny,mcpCall,requestId} from './_contract.js';
import {enforceRuntimeRole} from './_ledger.js';
import {oauthConfigured,oauthBearer} from './_oauth.js';
const PROBE_NAME='__atlas_permission_probe_NOT_A_REAL_TOOL_v1__';
function kindOf(token:string):AxiomPreflight['credentialKind']{
 if(token.startsWith('musitu_oauth_at_'))return 'OAUTH_ACCESS';
 if(token.startsWith('musitu_oauth_rt_'))return 'OAUTH_REFRESH';
 if(token.startsWith('musitu_axiom_'))return 'NON_OAUTH_MUSITU_PREFIX';
 return 'OTHER';
}
async function inspectOAuthAccess(token:string):Promise<AxiomPreflight['identityVerification']>{
 // Read-only OAuth userinfo check; no raw token or personal identity ever returned.
 // Missing openid/email scope (403) does not imply missing axiom.execute scope.
 if(kindOf(token)!=='OAUTH_ACCESS')return 'NOT_CHECKED';
 try{
  const response=await fetch('https://auth.mftintelligence.com/oauth/userinfo',{
   method:'GET',
   headers:{'Authorization':'Bearer '+token,'Accept':'application/json'},
   signal:AbortSignal.timeout(7500)
  });
  if(response.status===401)return 'INVALID_OR_EXPIRED';
  if(response.status===403)return 'IDENTITY_SCOPE_MISSING';
  if(response.status===200)return 'IDENTITY_VALID_NOT_EXECUTION_VERIFIED';
 }catch{/* Fail closed when OAuth userinfo is unreachable. */}
 return 'NOT_CHECKED';
}

export type AxiomPreflight={
 databaseRestricted:boolean;providerResponded:boolean;
 providerGateStatus:'CREDENTIAL_REJECTED'|'UNKNOWN_TOOL_AFTER_GATE'|'INCONCLUSIVE';
 credentialKind:'OAUTH_ACCESS'|'OAUTH_REFRESH'|'NON_OAUTH_MUSITU_PREFIX'|'OTHER';
 identityVerification:'INVALID_OR_EXPIRED'|'IDENTITY_VALID_NOT_EXECUTION_VERIFIED'|'IDENTITY_SCOPE_MISSING'|'NOT_CHECKED';
 operationExecuted:false;providerComputeUnitsClaimed:0;
 readyForApprovedArithmeticTest:boolean;
 note:string;
};
export async function preflight():Promise<AxiomPreflight>{
 const role=await enforceRuntimeRole();
 if(!role.restricted)throw deny(503,'Execution ledger role did not satisfy read-only privilege qualification.');
 const credential=oauthConfigured()?await oauthBearer():(process.env.AXIOM_MCP_BEARER_TOKEN||'');
 // The legacy static value is retained only for diagnostic classification.
 // A live operation can never be unlocked with a static bearer alone.
 const credentialKind=kindOf(credential);
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
   credentialKind,identityVerification:await inspectOAuthAccess(credential),
   operationExecuted:false,providerComputeUnitsClaimed:0,readyForApprovedArithmeticTest:false,
   note:'The provider did not authorize an Axiom operation. The diagnostic reports only credential category, never its value. An approved ATLAS OAuth flow with renewable access is required.'
  };
  if(!response.ok)throw deny(502,'Provider returned a non-success HTTP status during preflight.');
  const body=await response.text();
  if(body.length>15000)throw deny(502,'Unexpected oversized preflight response.');
  const data=JSON.parse(body);
  const rejected=data?.result?.structuredContent?.authenticated===false;
  if(rejected)return{
   databaseRestricted:true,providerResponded:true,providerGateStatus:'CREDENTIAL_REJECTED',
   credentialKind,identityVerification:await inspectOAuthAccess(credential),
   operationExecuted:false,providerComputeUnitsClaimed:0,readyForApprovedArithmeticTest:false,
   note:'Axiom denied the credential. The original secret stays on the server; check whether it is an OAuth access token, account key, or expired session.'
  };
  // The published gate implementation validates OAuth scope before forwarding
  // unregistered tools. Unknown-tool is promising, but deployment might differ.
  const unknownTool=data?.error?.code===-32601
   ||(data?.result?.isError===true&&JSON.stringify(data.result?.content||[]).toLowerCase().includes('not found'));
  return {
   databaseRestricted:true,providerResponded:true,
   credentialKind,identityVerification:'NOT_CHECKED',
   providerGateStatus:unknownTool?'UNKNOWN_TOOL_AFTER_GATE':'INCONCLUSIVE',
   operationExecuted:false,providerComputeUnitsClaimed:0,
   readyForApprovedArithmeticTest:unknownTool,
   note:unknownTool?
    'Unknown-tool rejection observed after the known OAuth-gate route. This suggests authorization was accepted, but does not certify a real arithmetic execution or account billing status.':
    'Axiom responded, but its authorization status cannot be inferred without a separately approved real operation.'
  };
 }finally{clearTimeout(timer);}
}
