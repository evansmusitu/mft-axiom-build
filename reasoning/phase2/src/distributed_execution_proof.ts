import { hashJson } from "../../phase1/src/canonical.ts";
import { compilerManifest } from "../../phase1/src/compiler.ts";
import type { OperationRegistry } from "../../phase1/src/registry.ts";
import { ReasoningControlPlane } from "./control_plane.ts";
import { evaluateEvidencePolicy } from "./policy.ts";
import type { ExecutionRepository, WorldStateRepository } from "./repositories.ts";
import type { SignerProvider } from "./signer.ts";
import type { ControlPlaneResult, DistributedExecutionIntent, TenantScope } from "./types.ts";

export interface DistributedCompletionProofVerifier {
  verify(scope:TenantScope,intent:DistributedExecutionIntent,result:ControlPlaneResult):Promise<void>;
}

/** Server-owned resolver. Worker-authored result references never establish proof. */
export class PersistedDistributedCompletionVerifier implements DistributedCompletionProofVerifier {
  private readonly deps:{world:WorldStateRepository;executions:ExecutionRepository;signer:SignerProvider;registry:OperationRegistry};
  constructor(deps:{world:WorldStateRepository;executions:ExecutionRepository;signer:SignerProvider;registry:OperationRegistry}){
    if(!deps?.world?.getSnapshot||!deps?.executions?.get||!deps?.executions?.getByIntent||!deps?.signer?.trustedPublicKeyPem||!deps?.registry?.manifest){
      throw new TypeError("Complete server-owned persisted-proof dependencies are required");
    }
    this.deps=deps;
  }
  async verify(scope:TenantScope,intent:DistributedExecutionIntent,result:ControlPlaneResult):Promise<void>{
    if(scope.tenantId!==intent.tenantId)throw new Error("Distributed proof tenant mismatch");
    if(hashJson(compilerManifest() as any)!==hashJson(intent.compilerManifest as any))throw new Error("Distributed proof compiler identity mismatch");
    if(hashJson(this.deps.registry.manifest())!==intent.operationRegistryManifestHash)throw new Error("Distributed proof registry identity mismatch");
    const snapshot=await this.deps.world.getSnapshot(scope,intent.snapshotId);
    if(snapshot.tenantId!==scope.tenantId||snapshot.snapshotId!==intent.snapshotId||snapshot.snapshotHash!==intent.snapshotHash||snapshot.asOf!==intent.executionRequest.asOf){
      throw new Error("Distributed proof frozen snapshot mismatch");
    }
    const expectedPolicy=evaluateEvidencePolicy(snapshot,[...intent.executionRequest.requirements].sort((a,b)=>a.id.localeCompare(b.id)));
    if(hashJson(expectedPolicy as any)!==hashJson(result.policyDecision as any)||result.snapshotId!==snapshot.snapshotId)throw new Error("Distributed proof evidence policy mismatch");
    if(expectedPolicy.status==="DENY"){
      if(result.status!=="DENIED"||result.certificateId!==undefined||result.executionRecordId!==undefined)throw new Error("Distributed proof policy denial mismatch");
      return;
    }
    if(!result.executionRecordId||!result.certificateId)throw new Error("Distributed proof references are required");
    const record=await this.deps.executions.get(scope,result.executionRecordId);
    const mapped=await this.deps.executions.getByIntent(scope,intent.jobId);
    if(!mapped||mapped.id!==record.id||mapped.recordHash!==record.recordHash||record.executionIntentId!==intent.jobId||record.executionRequestHash!==hashJson(intent.executionRequest as any)||record.snapshotId!==intent.snapshotId||record.snapshotHash!==intent.snapshotHash){
      throw new Error("Distributed proof execution intent binding mismatch");
    }
    const expected={status:(record.certificate.core as any).decisionStatus,snapshotId:record.snapshotId,policyDecision:record.policyDecision,certificateId:record.certificate.certificateId,executionRecordId:record.id};
    if(hashJson(expected as any)!==hashJson(result as any))throw new Error("Distributed proof result does not match persisted execution");
    const replay=await new ReasoningControlPlane({tenant:scope,...this.deps}).replayStored(record.id);
    if(replay.status!=="MATCH")throw new Error(`Distributed proof replay verification failed: ${replay.diagnostics.join("; ")}`);
  }
}
