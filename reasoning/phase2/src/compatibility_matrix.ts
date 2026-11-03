import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {hashJson,sha256Hex} from "../../phase1/src/canonical.ts";
import {compilerManifest} from "../../phase1/src/compiler.ts";
import {AxiomRuntime} from "../../phase1/src/runtime.ts";
import {createDefaultRegistry} from "../../phase1/src/registry.ts";
import {evidencePolicyManifest} from "./policy.ts";
export interface CompatibilityComponent {version:string;implementationHash:string}
export interface AxiomCompatibilityMatrix {
 schemaVersion:"axiom.compatibility/v1";
 components:Record<string,CompatibilityComponent>;
 matrixHash:string;
}
export interface CompatibilityResult {status:"MATCH"|"INCOMPATIBLE";diagnostics:string[]}
function source(path:string):string{
 return sha256Hex(readFileSync(fileURLToPath(new URL(path,import.meta.url))));
}
const COMPAT={
 ir:{version:"0.1",implementationHash:source("../../phase1/src/types.ts")},
 runtime:{version:AxiomRuntime.VERSION,implementationHash:source("../../phase1/src/runtime.ts")},
 compiler:{version:compilerManifest().version,implementationHash:compilerManifest().implementationHash},
 operationRegistry:{version:"1.0.0",implementationHash:hashJson(createDefaultRegistry().manifest() as any)},
 policy:{version:evidencePolicyManifest().version,implementationHash:evidencePolicyManifest().implementationHash},
 modelProposal:{version:"axiom.model-proposal.v1",implementationHash:source("./model_compiler.ts")},
 certificate:{version:"axiom.reasoning-certificate/v1",implementationHash:source("../../phase1/src/certificate.ts")},
 workerCompletionVerifier:{version:"axiom.verified-remote-completion/v1",implementationHash:source("./verified_remote_completion.ts")},
 workerControlHttp:{version:"axiom.worker-control-http/v2",implementationHash:source("./worker_control_http.ts")},
 workerRequest:{version:"axiom.worker-request/v1",implementationHash:source("./worker_authentication.ts")},
 workerLease:{version:"axiom.worker-lease/v1",implementationHash:source("./worker_lease_capability.ts")},
 objectEvidenceAdapter:{version:"axiom.version-pinned-object-evidence/v1",implementationHash:source("./version_pinned_object_evidence_adapter.ts")},
 postgresViewEvidenceAdapter:{version:"axiom.postgres-view-evidence/v1",implementationHash:source("./postgres_view_evidence_adapter.ts")},
 mcpEvidenceAdapter:{version:"axiom.fixed-mcp-evidence/v1",implementationHash:source("./fixed_mcp_evidence_adapter.ts")},
 fileEvidenceAdapter:{version:"axiom.file-json-evidence/v1",implementationHash:source("./file_json_evidence_adapter.ts")},
 evidenceAdapter:{version:"axiom.evidence-adapter/v1",implementationHash:source("./http_evidence_adapter.ts")},
 musituComputeAdapter:{version:"axiom.musitu-compute-adapter/v1",implementationHash:source("./musitu_axiom_evidence_adapter.ts")},
 modelAdapter:{version:"axiom.model-adapter/v1",implementationHash:source("./model_adapter.ts")},
 modelProviderTransport:{version:"axiom.model-transport/v1",implementationHash:source("./model_provider_transport.ts")},
 providerUsageBudget:{version:"axiom.provider-usage-budget/v1",implementationHash:source("./provider_budget.ts")},
 providerUsageBudgetPostgres:{version:"axiom.provider-usage-budget-pg/v1",implementationHash:source("./provider_budget_postgres.ts")},
 executionApi:{version:"axiom.execution-api/v1",implementationHash:source("./api_service.ts")},
 reasoningSigner:{version:"axiom.signer/v1",implementationHash:source("./signer.ts")},
 workerReceiptStore:{version:"axiom.worker-receipts/v1",implementationHash:hashJson({
  sqlite:source("./authenticated_worker_transactions.ts"),
  postgres:source("./authenticated_worker_postgres_transactions.ts")
 })}
} as const;
export function compatibilityMatrix():AxiomCompatibilityMatrix{
 const components=Object.fromEntries(Object.entries(COMPAT).sort(([a],[b])=>a.localeCompare(b))
  .map(([id,item])=>[id,{version:item.version,implementationHash:item.implementationHash}]));
 const core={schemaVersion:"axiom.compatibility/v1" as const,components};
 return {...core,matrixHash:hashJson(core)};
}
function exactRecord(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==="object"&&!Array.isArray(value)
  &&Object.keys(value).sort().join("\0")===keys.slice().sort().join("\0");
}
function validatedMatrix(value:unknown):string[]{
 const problems:string[]=[];
 if(!exactRecord(value,["schemaVersion","components","matrixHash"]))return ["matrix:invalid-shape"];
 const record=value as any;
 if(record.schemaVersion!=="axiom.compatibility/v1")problems.push("matrix:unsupported-schema");
 if(!record.components||typeof record.components!=="object"||Array.isArray(record.components)){
  problems.push("matrix:invalid-components");return problems;
 }
 for(const [id,comp] of Object.entries(record.components)){
  if(!id.trim()||!exactRecord(comp,["version","implementationHash"])
   ||typeof (comp as any).version!=="string"||!(comp as any).version.trim()
   ||typeof (comp as any).implementationHash!=="string"
   ||!/^[0-9a-f]{64}$/.test((comp as any).implementationHash))problems.push("component:"+id+":invalid");
 }
 if(typeof record.matrixHash!=="string"||!/^[0-9a-f]{64}$/.test(record.matrixHash)
  ||record.matrixHash!==hashJson({schemaVersion:record.schemaVersion,components:record.components}))
   problems.push("matrix:hash-mismatch");
 return problems;
}
export function verifyCompatibility(expected:unknown,observed:unknown):CompatibilityResult{
 const problems=[...validatedMatrix(expected).map(x=>"expected:"+x),
  ...validatedMatrix(observed).map(x=>"observed:"+x)];
 const current=compatibilityMatrix();
 if(problems.length)return {status:"INCOMPATIBLE",diagnostics:[...new Set(problems)].sort()};
 const a=expected as AxiomCompatibilityMatrix,b=observed as AxiomCompatibilityMatrix;
 if(a.matrixHash!==current.matrixHash)problems.push("expected:not-current");
 if(b.schemaVersion!==a.schemaVersion)problems.push("matrix:schema-drift");
 const ids=new Set([...Object.keys(a.components),...Object.keys(b.components)]);
 for(const id of [...ids].sort()){
  const x=a.components[id],y=b.components[id];
  if(!x)problems.push("component:"+id+":unexpected");
  else if(!y)problems.push("component:"+id+":missing");
  else{
   if(x.version!==y.version)problems.push("component:"+id+":version-drift");
   if(x.implementationHash!==y.implementationHash)problems.push("component:"+id+":implementation-drift");
  }
 }
 return {status:problems.length?"INCOMPATIBLE":"MATCH",diagnostics:[...new Set(problems)].sort()};
}
