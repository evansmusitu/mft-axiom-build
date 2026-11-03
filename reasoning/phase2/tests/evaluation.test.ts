import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hashJson} from "../../phase1/src/canonical.ts";
import {evaluateCorpus,type EvaluationCase} from "../src/evaluation.ts";
import {compatibilityMatrix} from "../src/compatibility_matrix.ts";
const snap=(facts:any[])=>{
 const tenantId="tenant:evaluation",asOf="2026-10-05T18:30:00.000Z";
 const snapshotHash=hashJson({tenantId,asOf,facts});
 return {tenantId,asOf,snapshotId:"snapshot:"+snapshotHash,snapshotHash,facts};
};
const fact=(id:string,value:number,observedAt:string,extra:any={})=>({
 id,entity:"risk:portfolio",attribute:"risk",value:{type:{kind:"number",unit:"ratio"},value},
 validFrom:"2026-10-05T17:30:00.000Z",observedAt,source:"fixture:"+id,...extra
});
const requirements=[{id:"risk",entity:"risk:portfolio",attribute:"risk",maxAgeMs:900000}];
const profile={profileId:"profile:eval",version:"1",adapterId:"adapter:fixture",
 allowedOperationIds:["comparison.lte"],maxRepairAttempts:2,maxInputs:4,maxNodes:4,
 maxConstraints:2,maxAssumptions:2,maxObjectiveBytes:2048,maxModelResponseBytes:4096};
const proposal={assumptions:[],nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",
 inputs:{left:{literal:{type:{kind:"number",unit:"ratio"},value:0.2}},
 right:{literal:{type:{kind:"number",unit:"ratio"},value:0.3}}}}],constraints:[],decisionNodeId:"decision"};
const program=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8"));
function corpus():EvaluationCase[]{
 return [
  {id:"fresh",kind:"POLICY",snapshot:snap([fact("f",0.2,"2026-10-05T18:25:00.000Z")]),requirements,expectedStatus:"ALLOW",expectedCode:"OK"},
  {id:"missing",kind:"POLICY",snapshot:snap([]),requirements,expectedStatus:"DENY",expectedCode:"MISSING_EVIDENCE"},
  {id:"stale",kind:"POLICY",snapshot:snap([fact("f",0.2,"2026-10-05T18:00:00.000Z")]),requirements,expectedStatus:"DENY",expectedCode:"STALE_EVIDENCE"},
  {id:"future",kind:"POLICY",snapshot:snap([fact("f",0.2,"2026-10-05T18:35:00.000Z")]),requirements,expectedStatus:"DENY",expectedCode:"FUTURE_EVIDENCE"},
  {id:"conflicting",kind:"POLICY",snapshot:snap([fact("f",0.2,"2026-10-05T18:25:00.000Z"),fact("g",0.9,"2026-10-05T18:26:00.000Z")]),requirements,expectedStatus:"DENY",expectedCode:"CONFLICTING_EVIDENCE"},
  {id:"superseded",kind:"POLICY",snapshot:snap([fact("f",0.2,"2026-10-05T18:25:00.000Z"),fact("g",0.9,"2026-10-05T18:26:00.000Z",{supersedes:["f"]})]),requirements,expectedStatus:"ALLOW",expectedCode:"OK"},
  {id:"safe-proposal",kind:"PROPOSAL",profile,proposal,expectedStatus:"ACCEPT"},
  {id:"authority-injection",kind:"PROPOSAL",profile,proposal:{...proposal,tenantId:"tenant:forged"},expectedStatus:"REJECT"},
  {id:"constraint-allow",kind:"CONSTRAINT",program,expectedStatus:"APPROVED"},
  {id:"constraint-deny",kind:"CONSTRAINT",program:{...program,inputs:{...program.inputs,max_vol:{...program.inputs.max_vol,value:0.000001,provenance:{...program.inputs.max_vol.provenance,contentHash:hashJson(0.000001)}}}},expectedStatus:"DENIED"},
  {id:"repair-within",kind:"REPAIR",repairAttempts:2,maxRepairAttempts:2,expectedStatus:"WITHIN_BUDGET"},
  {id:"repair-exceeded",kind:"REPAIR",repairAttempts:3,maxRepairAttempts:2,expectedStatus:"EXCEEDED"},
  {id:"resource-budget",kind:"RESOURCE",providerRequests:2,inputTokens:10,outputTokens:5,
   inputCostUnitsPerToken:2,outputCostUnitsPerToken:3,maxCostUnits:40,expectedStatus:"WITHIN_BUDGET"}
 ] as EvaluationCase[];
}
test("evaluation corpus is offline, ordered, evidence-bound, exact and repeatable",()=>{
 const a=evaluateCorpus(corpus()),b=evaluateCorpus([...corpus()].reverse());
 assert.deepEqual(a,b);
 assert.equal(a.schemaVersion,"axiom.evaluation/v1");
 assert.equal(a.caseCount,13);assert.equal(a.passed,13);assert.equal(a.failed,0);
 assert.equal(a.compatibilityMatrixHash,compatibilityMatrix().matrixHash);
 assert.equal(a.records.find(x=>x.id==="resource-budget")?.actual,"WITHIN_BUDGET");
 assert.equal(a.records.find(x=>x.id==="resource-budget")?.costUnits,35);
 assert.deepEqual(a.records.map(x=>x.id),[...a.records.map(x=>x.id)].sort());
 const {reportHash,...content}=a;
 assert.equal(reportHash,hashJson(content));
});
test("a failed expectation is reported FAILED, not silently counted as passing",()=>{
 const items=corpus();
 const bad=items.find(x=>x.id==="stale") as any;bad.expectedStatus="ALLOW";
 const report=evaluateCorpus(items);
 assert.equal(report.failed,1);
 assert.equal(report.passed,12);
 assert.equal(report.records.find(x=>x.id==="stale")?.status,"FAIL");
});
test("unbounded, ambiguous or malformed evaluation contracts fail closed",()=>{
 assert.throws(()=>evaluateCorpus([]),/case|empty/i);
 const items=corpus();
 assert.throws(()=>evaluateCorpus([...items,items[0]]),/duplicate/i);
 assert.throws(()=>evaluateCorpus([{id:"bad",kind:"ROOT_ACCESS"}] as any),/kind|unsupported/i);
 const poor=structuredClone(items) as any[];
 poor.find(x=>x.kind==="RESOURCE").inputCostUnitsPerToken=Number.POSITIVE_INFINITY;
 assert.throws(()=>evaluateCorpus(poor),/cost|finite|integer/i);
 const overflow=structuredClone(items) as any[];
 overflow.find(x=>x.kind==="RESOURCE").inputTokens=Number.MAX_SAFE_INTEGER;
 assert.throws(()=>evaluateCorpus(overflow),/cost|overflow|integer/i);
});
