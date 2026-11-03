import {hashJson} from "../../phase1/src/canonical.ts";
import {AxiomRuntime} from "../../phase1/src/runtime.ts";
import {createDefaultRegistry} from "../../phase1/src/registry.ts";
import {evaluateEvidencePolicy} from "./policy.ts";
import {parseModelProposal} from "./model_compiler.ts";
import {compatibilityMatrix} from "./compatibility_matrix.ts";
import type {WorldSnapshot,EvidenceRequirement,ModelCompilerProfile} from "./types.ts";
import type {AxiomProgram} from "../../phase1/src/types.ts";
export type EvaluationCase=
 |{id:string;kind:"POLICY";snapshot:WorldSnapshot;requirements:EvidenceRequirement[];expectedStatus:"ALLOW"|"DENY";expectedCode:string}
 |{id:string;kind:"PROPOSAL";profile:ModelCompilerProfile;proposal:unknown;expectedStatus:"ACCEPT"|"REJECT"}
 |{id:string;kind:"CONSTRAINT";program:AxiomProgram;expectedStatus:"APPROVED"|"DENIED"}
 |{id:string;kind:"REPAIR";repairAttempts:number;maxRepairAttempts:number;expectedStatus:"WITHIN_BUDGET"|"EXCEEDED"}
 |{id:string;kind:"RESOURCE";providerRequests:number;inputTokens:number;outputTokens:number;
   inputCostUnitsPerToken:number;outputCostUnitsPerToken:number;maxCostUnits:number;
   expectedStatus:"WITHIN_BUDGET"|"EXCEEDED"};
export interface EvaluationRecord{
 id:string;kind:EvaluationCase["kind"];caseHash:string;expected:string;actual:string;
 status:"PASS"|"FAIL";costUnits?:number;
}
export interface EvaluationReport{
 schemaVersion:"axiom.evaluation/v1";compatibilityMatrixHash:string;corpusHash:string;
 caseCount:number;passed:number;failed:number;records:EvaluationRecord[];reportHash:string;
}
const KINDS=new Set(["POLICY","PROPOSAL","CONSTRAINT","REPAIR","RESOURCE"]);
function bounded(value:unknown,label:string,max=100000000):number{
 if(!Number.isSafeInteger(value)||(value as number)<0||(value as number)>max)
  throw new TypeError(label+" must be a bounded nonnegative safe integer");
 return value as number;
}
function exactFields(value:EvaluationCase,allowed:string[]):void{
 const unknown=Object.keys(value as any).filter(k=>!allowed.includes(k));
 if(unknown.length)throw new TypeError("Unexpected evaluation case field: "+unknown[0]);
 for(const key of allowed)if(!(key in (value as any)))throw new TypeError("Missing evaluation case field: "+key);
}
function evaluate(item:EvaluationCase):{actual:string;costUnits?:number}{
 switch(item.kind){
  case "POLICY":{
   exactFields(item,["id","kind","snapshot","requirements","expectedStatus","expectedCode"]);
   if(!Array.isArray(item.requirements)||item.requirements.length!==1)throw new TypeError("Policy evaluation requires exactly one evidence requirement");
   if(item.expectedStatus!=="ALLOW"&&item.expectedStatus!=="DENY")throw new TypeError("Invalid expected policy status");
   if(typeof item.expectedCode!=="string"||!item.expectedCode.trim())throw new TypeError("Missing expected policy check");
   const decision=evaluateEvidencePolicy(item.snapshot,item.requirements);
   return {actual:decision.status+":"+decision.checks[0].code};
  }
  case "PROPOSAL":{
   exactFields(item,["id","kind","profile","proposal","expectedStatus"]);
   if(item.expectedStatus!=="ACCEPT"&&item.expectedStatus!=="REJECT")throw new TypeError("Invalid proposal expectation");
   try{parseModelProposal(item.proposal,item.profile);return {actual:"ACCEPT"};}
   catch(e){if(e instanceof TypeError||e instanceof RangeError||e instanceof Error)return {actual:"REJECT"};throw e;}
  }
  case "CONSTRAINT":{
   exactFields(item,["id","kind","program","expectedStatus"]);
   if(item.expectedStatus!=="APPROVED"&&item.expectedStatus!=="DENIED")throw new TypeError("Invalid constraint expectation");
   return {actual:new AxiomRuntime(createDefaultRegistry()).execute(item.program).decisionStatus};
  }
  case "REPAIR":{
   exactFields(item,["id","kind","repairAttempts","maxRepairAttempts","expectedStatus"]);
   if(item.expectedStatus!=="WITHIN_BUDGET"&&item.expectedStatus!=="EXCEEDED")throw new TypeError("Invalid repair expectation");
   const limit=bounded(item.maxRepairAttempts,"maxRepairAttempts",2);
   return {actual:bounded(item.repairAttempts,"repairAttempts",100000)>limit?"EXCEEDED":"WITHIN_BUDGET"};
  }
  case "RESOURCE":{
   exactFields(item,["id","kind","providerRequests","inputTokens","outputTokens",
    "inputCostUnitsPerToken","outputCostUnitsPerToken","maxCostUnits","expectedStatus"]);
   if(item.expectedStatus!=="WITHIN_BUDGET"&&item.expectedStatus!=="EXCEEDED")throw new TypeError("Invalid resource expectation");
   bounded(item.providerRequests,"providerRequests",1000000);
   const input=bounded(item.inputTokens,"inputTokens",100000000);
   const output=bounded(item.outputTokens,"outputTokens",100000000);
   const weightIn=bounded(item.inputCostUnitsPerToken,"input cost",100000000);
   const weightOut=bounded(item.outputCostUnitsPerToken,"output cost",100000000);
   const max=bounded(item.maxCostUnits,"maxCostUnits",Number.MAX_SAFE_INTEGER);
   const cost=input*weightIn+output*weightOut;
   if(!Number.isSafeInteger(cost))throw new RangeError("Resource cost overflow");
   return {actual:cost>max?"EXCEEDED":"WITHIN_BUDGET",costUnits:cost};
  }
  default:throw new TypeError("Unsupported evaluation kind");
 }
}
export function evaluateCorpus(input:readonly EvaluationCase[]):EvaluationReport{
 if(!Array.isArray(input)||input.length===0||input.length>1000)throw new TypeError("Evaluation cases must be nonempty and bounded");
 const seen=new Set<string>();
 const cases=[...input].map(item=>{
  if(!item||typeof item!=="object"||Array.isArray(item))throw new TypeError("Invalid evaluation case");
  if(typeof item.id!=="string"||!item.id.trim()||item.id.length>128)throw new TypeError("Invalid evaluation case ID");
  if(seen.has(item.id))throw new TypeError("Duplicate evaluation case ID");
  seen.add(item.id);
  if(!KINDS.has(item.kind))throw new TypeError("Unsupported evaluation kind");
  return item;
 }).sort((a,b)=>a.id.localeCompare(b.id));
 const records=cases.map(item=>{
  const outcome=evaluate(item);
  const expected=item.kind==="POLICY"?item.expectedStatus+":"+item.expectedCode:item.expectedStatus;
  const record:EvaluationRecord={id:item.id,kind:item.kind,caseHash:hashJson(item as any),
   expected,actual:outcome.actual,status:expected===outcome.actual?"PASS":"FAIL"};
  if(outcome.costUnits!==undefined)record.costUnits=outcome.costUnits;
  return record;
 });
 const passed=records.filter(x=>x.status==="PASS").length;
 const core={schemaVersion:"axiom.evaluation/v1" as const,
  compatibilityMatrixHash:compatibilityMatrix().matrixHash,
  corpusHash:hashJson(cases as any),caseCount:cases.length,passed,failed:cases.length-passed,records};
 return {...core,reportHash:hashJson(core as any)};
}
