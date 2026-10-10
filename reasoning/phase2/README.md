# AXIOM Reasoning Platform — Phase 2

Phase 2 now includes Phase 2.5A fenced distributed execution above the Phase-2.4B proof-carrying model and advisory-explanation boundary. Distribution changes where deterministic reasoning runs, not what is authoritative: workers cannot establish tenant scope, caller authority, trusted values, evidence policy, program identity, signing authority, or provider capabilities.

```text
Ed25519 API JWT
      ↓
Authenticated Principal
      ↓
Exact Server-Side Tenant/Action Authorization
      ↓
Mutation Idempotency Claim
      ↓
┌────────────────────────────────────────────────────────────┐
│ Phase 2.4A proof-carrying model compilation                │
│                                                            │
│ Server-owned compiler profile + operation identities       │
│      ↓                                                     │
│ Fixed HTTPS structured model adapter                       │
│      ↓                                                     │
│ Bounded proposal → strict parser → deterministic assembly  │
│      ↓                                                     │
│ Phase-1 compile validation                                 │
│      ↳ at most 2 deterministic repairs                     │
│      ↓                                                     │
│ Immutable exchange artifacts + terminal compilation record │
└────────────────────────────────────────────────────────────┘
      ↓ model:execute loads only a VALIDATED compilation
Fresh Tenant World State
      ↓
Deterministic Evidence Policy
      ↓
Replace every compile-only placeholder from world state
      ↓
Signed Tenant / State / Policy / Binding Context
      ↓
Phase-1 AXIOM Compiler + Runtime
      ↓
Independently Verified Reasoning Signer
      ↓
Tenant-Scoped Execution + Network-Free Replay
```

## HTTP API

The built-in HTTP boundary exposes:

- `POST /v1/tenants/:tenantId/facts`
- `POST /v1/tenants/:tenantId/evidence/acquisitions`
- `POST /v1/tenants/:tenantId/executions`
- `GET /v1/tenants/:tenantId/executions/:executionId`
- `POST /v1/tenants/:tenantId/executions/:executionId/replay`
- `POST /v1/tenants/:tenantId/model/compilations`
- `POST /v1/tenants/:tenantId/model/compilations/:compilationId/executions`
- `POST /v1/tenants/:tenantId/model/compilations/:compilationId/execution-jobs`
- `GET /v1/tenants/:tenantId/execution-jobs/:jobId`
- `POST /v1/tenants/:tenantId/executions/:executionId/explanations`

Fact ingestion, evidence acquisition, execution creation, model compilation, model-compilation execution, distributed model dispatch, and advisory explanation creation require `Idempotency-Key`. Authentication and exact server-side authorization occur before tenant runtime creation. For model compilation they also occur before profile resolution, secret resolution, or provider access.

`model:compile`, `model:execute`, `model:dispatch`, `execution:job:read`, and `model:explain` are independent grants. Neither implies `execution:create`, and a compilation may be executed by any principal independently authorized for that tenant and compilation resource.

## Proof-carrying model compilation

A server-owned `ModelCompilerProfile` fixes the adapter identity, allowed operation IDs, repair budget, input/node/constraint/assumption limits, and request/response bounds. The caller supplies only a profile ID, objective, and immutable typed input contracts.

The model sees sanitized contracts and allowed operation identities. It does not receive provider secrets, trusted runtime values, tenant authority, policy authority, signer authority, or an installable registry. Provider responses are accepted only as bounded JSON proposal material.

Each proposal is strictly parsed and assembled with deterministic compile-only placeholder values. Those placeholders exist only to make the proposed AXIOM program type-checkable. Phase-1 `compileProgram` remains authoritative. Invalid proposals can be repaired at most twice, so one compilation performs at most three model calls.

Every model exchange is persisted as an immutable tenant-scoped artifact binding the exact sanitized request body, exact bounded response body, adapter implementation identity, profile hash, request hash, attempt/mode, and content hashes. Provider secrets are header-only and are rejected if they appear in captured request/response material.

A terminal `ModelCompilationRecord` is either:

- `VALIDATED`, with the exact deterministic compiled template and program hash; or
- `REJECTED`, with deterministic final issues and no executable program.

Compilation identity commits tenant, compiler principal, canonical request, profile identity, adapter implementation identity, Phase-1 compiler identity, full operation-registry manifest hash, ordered exchange artifact hashes, terminal status, and program/final-issues commitment.

## Immutable model execution

Model execution never calls the model provider. It loads the authorized tenant's immutable compilation, verifies record/program integrity, requires `VALIDATED`, resolves the current profile, and compares current Phase-1 compiler and operation-registry identities with the stored commitments.

The compiled template must have exactly the contract input names, matching types, untouched compile-only placeholder provenance, and no reserved platform-context assumption. The platform derives `EvidenceRequirement[]` and `InputBinding[]` only from the stored contracts.

The unchanged `ReasoningControlPlane` then snapshots fresh trusted world state, applies deterministic evidence policy, replaces every placeholder input with selected world-state evidence, signs the platform context, runs Phase-1, verifies the reasoning signer, and persists the execution/certificate. The signed certificate therefore contains real world-state values and provenance, not compile placeholders.

Legitimate profile/compiler/registry drift returns `409 COMPILATION_STALE`; the remedy is a new explicit compilation. A terminal rejected compilation cannot execute. Persisted integrity corruption fails closed without reaching the reasoning control plane.

## Idempotency and replay

Completed identical model-compilation retries return the exact stored HTTP response without another provider call. Completed identical model-execution retries return the exact stored response without another reasoning execution. A changed request using the same key is rejected. An unfinished claim remains `IN_PROGRESS` and is not automatically retried.

Provider/network/internal 5xx failures do not complete the idempotency record, preventing an ambiguous automatic refetch. Stored reasoning replay never calls the model or any external evidence source.

## External evidence

Phase 2.3A remains the only external-evidence trust path. Registered READ/COMPUTE adapters capture bounded evidence, persist immutable artifacts, deterministically map them into provenance-bound facts, adapter-attest the existing signed fact-envelope format, and pass those envelopes through the normal authenticated-ingestion verifier before atomic persistence.

Model output is not evidence and cannot bypass this path.

## Storage

SQLite and PostgreSQL 17 implementations persist tenant-scoped:

- temporal facts and deterministic snapshots;
- reasoning execution records/certificates;
- authenticated-ingestion nonces;
- authorization grants;
- idempotency outcomes;
- tamper-evident audit streams;
- evidence artifacts/acquisition records;
- model exchange artifacts;
- terminal model compilation records;
- execution-intent mappings and fenced distributed execution jobs.

Model exchange artifacts plus the terminal compilation record commit atomically. Artifact request/response hashes, artifact hash, compiled-program hash, and record hash are redundantly checked on reads. PostgreSQL CI verifies the same isolation, rollback, terminal-shape, and tamper behavior as SQLite.

## Run

Node 24.12+:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run conformance
npm run gate
```

Individual gates:

```sh
npm run gate:phase21
npm run gate:phase22
npm run gate:phase23a
npm run gate:phase24a
npm run gate:phase24b
npm run gate:phase25a
```

PostgreSQL integration:

```sh
npm run test:postgres
```

## Current boundaries

Phase 2.4A deliberately does not provide brokerage/action execution, arbitrary outbound HTTP, arbitrary SQL, user-installed adapters/mapping code, MCP as a privileged reasoning trust path, connector administration, distributed workers, autonomous background model repair, provider-specific first-party model adapters, natural-language explanation authority, human login/session flows, authorization administration, wildcard roles, quotas/billing, HSM/KMS deployment, or UI.

Provider-specific model integrations and advisory natural-language explanation are deferred to Phase 2.4B. TLS termination, database encryption/backups, and production network perimeter controls remain deployment responsibilities.

## Legacy SQLite boundary

Pre-tenant Phase-2 SQLite databases cannot be safely relabeled because historical hashes were computed under different semantics. Phase 2.1+ fails closed on that legacy schema; migrate through an explicit purpose-built process rather than opening it in-place.


## Phase 2.4B first-party providers and advisory explanation

Phase 2.4B adds first-party OpenAI Responses and Anthropic Messages adapters over a fixed, bounded HTTPS transport. Provider/model/origin/version/capabilities remain server-owned. Credentials are resolved into headers only. Tools, MCP, web search, arbitrary URLs, provider-managed conversation state, previous-response chaining, and code execution are not enabled.

The exact provider request and exact bounded provider response are persisted independently from a canonical normalized AXIOM proposal. All three representations are hash-bound. Compilation parses only the normalized proposal, while the raw provider response remains immutable transport evidence.

Advisory explanations are available only for an existing tenant-scoped execution under the separate exact `model:explain` grant. The platform loads the immutable execution, verifies a network-free replay `MATCH`, and only then constructs a sanitized proof envelope and resolves provider credentials. The provider receives execution/snapshot/policy/certificate commitments, not bearer tokens, grant sets, certificate signatures/private replay objectives, or unrelated tenant state.

Explanation output is strictly bounded JSON with `summary`, `keyFactors`, and `limitations`, persisted as a tenant-scoped tamper-evident record with `authority:"ADVISORY_ONLY"`. It cannot alter evidence, policy, AXIOM-IR, execution, certificate, signer state, or authorization. Completed identical retries replay the exact stored API outcome without another provider call.

Phase 2.4B still does not provide brokerage/action execution, arbitrary provider tools, user-supplied model endpoints, autonomous background agents, or explanation-as-evidence.


## Phase 2.5A fenced distributed execution

Phase 2.5A adds asynchronous execution only for already-`VALIDATED` model compilations. Dispatch performs exact `model:dispatch` authorization, revalidates the immutable compilation, derives the same execution request as synchronous `model:execute`, freezes the tenant world-state snapshot, and only then persists a claimable job.

The database is the canonical job authority. Each immutable job intent binds tenant, submitting principal, authorization decision hash, API request hash, compilation/profile/compiler/registry identities, exact prepared execution request, frozen snapshot ID/hash, and creation time. SQLite and PostgreSQL store a separately hash-bound mutable state with monotonic `leaseEpoch`, attempt count, lease owner/expiry, and terminal result/failure.

Workers receive no caller token and no provider/evidence/explanation capability. They can only claim persisted jobs, revalidate current trusted runtime identities, load the exact frozen snapshot, and call `ReasoningControlPlane.executeBound`. The job ID is also the stable execution-intent ID committed into the signed platform context.

Execution persistence and the intent mapping are atomic. If a worker persists the signed execution and crashes before terminal job completion, a later lease first discovers that exact durable execution and completes the job without issuing a second durable reasoning execution. This is an exactly-one-durable-AXIOM-execution property for the internal intent, not an exactly-once external-side-effect claim.

Expired leases are reclaimed with a strictly larger epoch. Heartbeat, retry release, success/denial completion, and terminal STALE/FAILED_INTEGRITY transitions require the exact current worker + epoch + unexpired lease. A stale holder cannot overwrite a newer lease or a terminal job.

Public job reads are separately authorized by `execution:job:read` and expose only job ID, status, snapshot ID, attempt count, creation/terminal time, bounded terminal result, and sanitized failure code. Worker identity, lease timing, prepared program, compilation internals, and authorization internals are not returned.

Distributed workers do not call model providers, evidence adapters, or explanation providers. Provider-call jobs, external action execution, broker-as-authority semantics, remote worker control/attestation, dead-letter/operator policy, quotas/fair scheduling, and HSM/KMS signing remain separate production increments.
