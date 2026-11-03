import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hashJson} from "../../phase1/src/canonical.ts";
import {compatibilityMatrix,verifyCompatibility} from "../src/compatibility_matrix.ts";
import {evaluateCorpus,type EvaluationCase} from "../src/evaluation.ts";
const expected=compatibilityMatrix();
assert.equal(verifyCompatibility(expected,structuredClone(expected)).status,"MATCH");
const drift=structuredClone(expected);
drift.components.policy.implementationHash="0".repeat(64);
drift.matrixHash=hashJson({schemaVersion:drift.schemaVersion,components:drift.components});
assert.equal(verifyCompatibility(expected,drift).status,"INCOMPATIBLE");
const missing=structuredClone(expected);
delete missing.components.workerLease;
missing.matrixHash=hashJson({schemaVersion:missing.schemaVersion,components:missing.components});
assert.equal(verifyCompatibility(expected,missing).status,"INCOMPATIBLE");
const tenantId="tenant:evaluation-gate",asOf="2026-10-05T18:30:00.000Z";
const snap=(facts:any[])=>{
 const snapshotHash=hashJson({tenantId,asOf,facts});
 return {tenantId,asOf,snapshotId:"snapshot:"+snapshotHash,snapshotHash,facts};
};
const fact=(id:string,value:number,observedAt:string,extra:any={})=>({
 id,entity:"risk:bound",attribute:"risk",value:{type:{kind:"number",unit:"ratio"},value},
 validFrom:"2026-10-05T17:30:00.000Z",observedAt,source:"fixture:"+id,...extra
});
const requirements=[{id:"risk",entity:"risk:bound",attribute:"risk",maxAgeMs:900000}];
const policy=(id:string,facts:any[],expectedStatus:"ALLOW"|"DENY",expectedCode:string)=>({
 id,kind:"POLICY" as const,snapshot:snap(facts),requirements,expectedStatus,expectedCode
});
const profile={profileId:"profile:eval",version:"1",adapterId:"adapter:fixture",
 allowedOperationIds:["comparison.lte"],maxRepairAttempts:2,maxInputs:4,maxNodes:4,
 maxConstraints:2,maxAssumptions:2,maxObjectiveBytes:2048,maxModelResponseBytes:4096};
const proposal={assumptions:[],nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",
 inputs:{left:{literal:{type:{kind:"number",unit:"ratio"},value:0.2}},
 right:{literal:{type:{kind:"number",unit:"ratio"},value:0.3}}}}],constraints:[],decisionNodeId:"decision"};
const program=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8"));
const cases:EvaluationCase[]=[
 policy("fresh",[fact("a",0.2,"2026-10-05T18:25:00.000Z")],"ALLOW","OK"),
 policy("missing",[],"DENY","MISSING_EVIDENCE"),
 policy("stale",[fact("a",0.2,"2026-10-05T18:00:00.000Z")],"DENY","STALE_EVIDENCE"),
 policy("future",[fact("a",0.2,"2026-10-05T18:35:00.000Z")],"DENY","FUTURE_EVIDENCE"),
 policy("conflicting",[fact("a",0.2,"2026-10-05T18:25:00.000Z"),
  fact("b",0.9,"2026-10-05T18:26:00.000Z")],"DENY","CONFLICTING_EVIDENCE"),
 policy("superseded",[fact("a",0.2,"2026-10-05T18:25:00.000Z"),
  fact("b",0.9,"2026-10-05T18:26:00.000Z",{supersedes:["a"]})],"ALLOW","OK"),
 {id:"proposal-safe",kind:"PROPOSAL",profile,proposal,expectedStatus:"ACCEPT"},
 {id:"proposal-authority",kind:"PROPOSAL",profile,proposal:{...proposal,tenantId:"tenant:evil"},expectedStatus:"REJECT"},
 {id:"constraint-allow",kind:"CONSTRAINT",program,expectedStatus:"APPROVED"},
 {id:"constraint-deny",kind:"CONSTRAINT",program:{...program,inputs:{
  ...program.inputs,max_vol:{...program.inputs.max_vol,value:0.000001,provenance:{...program.inputs.max_vol.provenance,contentHash:hashJson(0.000001)}}}},expectedStatus:"DENIED"},
 {id:"repair-within",kind:"REPAIR",repairAttempts:2,maxRepairAttempts:2,expectedStatus:"WITHIN_BUDGET"},
 {id:"repair-over",kind:"REPAIR",repairAttempts:3,maxRepairAttempts:2,expectedStatus:"EXCEEDED"},
 {id:"resource",kind:"RESOURCE",providerRequests:2,inputTokens:10,outputTokens:5,
  inputCostUnitsPerToken:2,outputCostUnitsPerToken:3,maxCostUnits:40,expectedStatus:"WITHIN_BUDGET"}
];
const report=evaluateCorpus(cases);
assert.equal(report.passed,cases.length);
assert.equal(report.failed,0);
assert.deepEqual(report,evaluateCorpus([...cases].reverse()));
assert.equal(report.records.find(x=>x.id==="resource")?.costUnits,35);
const failed=structuredClone(cases);
const stale=failed.find(x=>x.id==="stale") as any;stale.expectedStatus="ALLOW";
assert.equal(evaluateCorpus(failed).failed,1);
console.log(JSON.stringify({
 phase:"P2.6 — Deterministic Evaluation and Compatibility Matrix",status:"PASS",
 checks:["source-anchored compatibility identity","version/implementation drift denies",
  "missing protocol denies","offline fresh/missing/stale/conflicting/future/superseded evidence",
  "untrusted authority-bearing model proposal rejected","hard constraint passes and denies",
  "bounded repair attempts","explicit non-priced resource accounting",
  "order-independent report hash and mismatch detection"],
 matrixHash:expected.matrixHash,corpusHash:report.corpusHash,reportHash:report.reportHash,
 cases:report.caseCount,failed:report.failed
}));
