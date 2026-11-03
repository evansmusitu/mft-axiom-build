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
npm run gate:phase25b
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

Distributed workers do not call model providers, evidence adapters, or explanation providers. Provider-call jobs, external action execution, broker-as-authority semantics, remote worker control/attestation, dead-letter/operator policy, and quotas/fair scheduling remain separate production increments. Phase 2.5B adds the generic external signing boundary; vendor-specific HSM/KMS drivers, provisioning, rotation administration, and deployment policy remain separate.


## Phase 2.5B out-of-process deterministic certificate signing

Phase 2.5B removes the production requirement that the reasoning private key live inside the AXIOM Node.js process. Phase-1 certificate construction is split into deterministic preparation and finalization primitives while preserving the existing certificate format and local signer API.

Phase 2 signer providers are asynchronous and expose an explicit, server-owned signer identity: protocol version, provider ID, LOCAL/EXTERNAL mode, key ID, Ed25519 algorithm, and SHA-256 of canonical SPKI public-key DER. The active and historical public keys remain pinned in AXIOM configuration. External signer responses never supply trusted key material.

For each exact certificate payload, AXIOM derives a stable signing-intent ID from the signed payload hash plus the committed signer identity. The external Ed25519 provider sends only the exact canonical signing payload and that identity-bound intent through a bounded backend, independently verifies the returned signature under the pinned public key, and only then finalizes/persists the certificate.

`HttpEd25519SigningBackend` uses a fixed HTTPS origin/path, manual redirect handling, bounded request/response sizes, strict JSON schema, exact key/algorithm/intent/payload echoes, header-only resolved credentials, and secret-echo rejection. The backend is suitable for a narrowly scoped HSM/KMS gateway but is not itself a vendor-specific HSM/KMS driver.

New executions use signed platform-context version 2. The context commits the exact signer identity before Phase-1 execution; the persisted record also stores the stable signing intent. Issuance validates that declared signer identity matches the pinned active public key and that the stored signing intent matches the actual certificate before persistence. Replay revalidates those commitments without contacting the external signer.

Legacy pre-2.5B platform-context records remain replayable through the exact v1 context formula. Historical key rotation remains keyring-based and network-free.

Because Ed25519 is deterministic for a fixed key/message, an ambiguous lost signing response can be retried with the identical request. The existing Phase-2.5A lease fencing and stable execution-intent mapping still guarantee at most one durable AXIOM execution record for one distributed intent. This is not an exactly-once external-side-effect claim.

Vendor-specific AWS/GCP/Azure KMS integration, PKCS#11, hardware provisioning, key-rotation administration, mTLS/network deployment policy, external signing audit notarization, and non-Ed25519 algorithms remain deferred.


## Phase 2.5C — Authenticated Worker Control

A worker proof-of-possession boundary now sits above Phase-2.5A distributed execution jobs. Registered Ed25519 worker keys authenticate exact action/body/target/request identity; server-side trust records select the worker pool, allowed operations and maximum lease length. A separate lease-signing key attests lease capability scope and each durable operation receipt. The authenticated SQLite and PostgreSQL paths persist request receipts atomically with each job transition, including exact lost-response replay. Use `AuthenticatedDistributedExecutionStore` for SQLite or await `createAuthenticatedPostgresDistributedExecutionStore(...)` before accepting PostgreSQL worker requests. Do not expose the legacy raw-worker API once secure-mode repositories are initialized. The authenticated worker runtime receives only a worker credential, server clock and trusted bound runtime factory, never tenant bearer grants or provider authority.

Run `npm run conformance && npm run gate && npm run test:postgres` from `reasoning/phase2`. The acceptance matrix includes `gate:phase25c`.

## Phase 2.6 — Deterministic Evaluation and Compatibility

The platform now exposes `compatibilityMatrix()` and fail-closed `verifyCompatibility(expected,observed)`, plus `evaluateCorpus(cases)` for bounded, network-free conformance. The matrix source-fingerprints Phase-1 IR/runtime/compiler/operation registry, Phase-2 evidence policy, fixed evidence/model adapters, model provider transport, reasoning signer/certificate, worker protocols and receipt persistence. Its canonical hash is embedded in every evaluation report.

The evaluation suite contains fixed evidence freshness/conflict/supersession cases, Phase-1 hard-constraint approval/denial, strict proposal authority-injection rejection, bounded repair counts, and deterministic resource consumption units. Resource units are explicit fixture weights—not market prices, realized spend, performance forecasts or profit. Run `npm run gate:phase26`, included in aggregate `npm run gate` and GitLab CI.


## Phase 2.7A tenant admission quotas

Operator provisioned `installTenantAdmissionQuotas([{tenantId,maxOutstandingJobs}])` on the SQLite or PostgreSQL distributed execution repository before exposing dispatch. Once quota mode is enabled, every job creation rejects unknown tenants and new requests exceeding that tenant's outstanding PENDING+LEASED budget. Existing exact jobs replay without consuming another slot. Verification: `npm run gate:phase27a`, `npm run conformance`, and `npm run test:postgres`. This is an admission cap, not weighted-fair scheduling, cost metering or production deployment hardening.


## Phase 2.7B tenant-fair claims

Operator activation: `await distributedJobs.enableTenantFairScheduling()`. An explicitly enabled repository persists a monotonic tenant service cursor, selecting the oldest eligible job from the least-recently-served tenant. Both legacy and Ed25519-authenticated SQLite/PostgreSQL worker claim paths share the same durable order. Gate: `npm run gate:phase27b`. No activation retains legacy FIFO order. No SLA, weighted fairness or profit guarantee.


## Phase 2.8A local JSON file evidence

Use `FileJsonEvidenceAdapter` to bind a registered READ-only evidence operation to one operator-selected flat `.json` filename in a trusted root. The caller cannot supply a path or select a different file. The root must be controlled by the operator and non-group/world-writable. Acquisition reads bounded bytes, rejects final symlinks and invalid UTF-8/JSON, and feeds the existing authorized adapter registry, mapper and signed provenance pipeline. Set `maxResponseBytes` conservatively, and expose no arbitrary local path lookup to clients. Gate: `npm run gate:phase28a`. This is not a general object-storage, SQL or MCP adapter.


## Phase 2.8B tenant-bound PostgreSQL view evidence

`PostgresViewEvidenceAdapter` binds an operator provisioned connection pool, schema/view, selected columns, mandatory tenant-id column, stable order column, and a row count cap to one registered `READ` evidence operation. Callers cannot submit SQL, source identifiers, filters or result limits. The connector uses an explicit `BEGIN READ ONLY` transaction, local statement/lock timeouts, mandatory parameterized tenant predicate, an SQL-side bounded JSON response, `ROLLBACK`, and pool release. Configure a least-privilege SELECT-only database user and vetted views with a unique stable ordering key. Gate: `npm run gate:phase28b`; real PostgreSQL integration is part of `npm run test:postgres`. This is not arbitrary SQL execution, credential provisioning or proven data truth.


## Phase 2.8C immutable JSON object evidence

Register `VersionPinnedObjectEvidenceAdapter` under an ordinary `AdapterRegistry` evidence source. Each operation binds a fixed `bucket`, relative `key`, immutable `versionId`, expected lower-case `expectedSha256`, permitted `tenantIds`, and JSON size/deadline policy. Requests must provide `parameters: {}`; arbitrary object paths or versions are not supported. Supply an operator-controlled `ImmutableObjectReader` using read-only object-storage credentials and SDK/network limits. The adapter checks the returned version and hash and captures exact JSON bytes for the existing authorized acquisition, mapper, attestor and persisted replay path.

Verify with `npm run gate:phase28c`, `npm run conformance`, and `npm run test:postgres`. Vendor SDK/IAM provisioning and source-truth validation remain outside this portable reader contract; no guaranteed returns.


## Phase 2.8D — fixed MCP read-only evidence

Register `FixedMcpEvidenceAdapter` with `AdapterRegistry`. Supply a server-owned HTTPS `origin`, one vetted read-only `toolName`, `parameterName`, `tenantIds`, exact operation manifest, and `secretRef` resolved server-side. The only caller-controlled argument is one bounded string value matching the predeclared parameter name. The adapter sends one stateless JSON-RPC `tools/call` to the fixed `/mcp` path, denies redirects and unexpected/multiple/error results, and captures only bounded JSON text as untrusted evidence.

Keep MCP credentials in the secret resolver, not the request body, evidence record or provider output. Provision a remote read-only MCP tool account and inspect the registered tool's actual behavior; name validation alone cannot prove it is non-mutating. Full MCP negotiation, tool discovery, remote worker transport, production egress controls and SDK credentials are not implemented here. Verify with `npm run gate:phase28d`, `npm run conformance` and `npm run test:postgres`. No return/profit guarantees.


## Phase 2.9A — remote signed worker-control listener

Construct `createAxiomWorkerControlHttpServer({jobs,clock,trustedIngress})` with an already activated `AuthenticatedDistributedExecutionStore` or `createAuthenticatedPostgresDistributedExecutionStore`. `clock` must be server-controlled. The required `trustedIngress(req)` callback must check real private TLS/mTLS gateway authentication, **not** user-provided headers. Only three JSON POST routes are supported:

- `/v1/worker/claims`: `{proof,leaseMs}` → `{status:"IDLE"}` or `{status:"LEASED",lease}`.
- `/v1/worker/jobs/:jobId/heartbeat`: `{proof,capability,leaseMs}` → renewed signed `{status:"LEASED",lease}`.
- `/v1/worker/jobs/:jobId/release`: `{proof,capability}` → `{status:"RELEASED",jobStatus:"PENDING"}`.

Signed proof binds exact route action, target job, body hash, registered worker key, request ID and issue time. Signed leases are independently issued and validated by the existing repository; exact retries replay signed durable receipts. Raw worker IDs cannot control jobs.

No remote completion or terminal-failure endpoint exists because worker-supplied outcomes must not be accepted without additional server-side persisted-proof verification. Bind the listener to private networking and supply a genuine validated ingress predicate before deployment; this package does not configure TLS, cert issuance or worker credentials. Acceptance: `npm run gate:phase29a`, `npm run conformance`, `npm run test:postgres`.


## Phase 2.9B — trusted remote completion gate

Use `VerifiedRemoteCompletionService({jobs,auth,leaseSigner,jobReader,executions,replayFactory})` within the trusted server, not a remote client. `jobs` is the authenticated receipt-backed SQLite/PostgreSQL store; `auth` is ACTIVE Ed25519 worker verification; `leaseSigner` is the server public-key ring for independent lease capabilities; `jobReader.get` is tenant-scoped durable jobs; `executions.getByIntent` is the immutable verified execution repository; `replayFactory.create(scope)` must return the real trusted reasoning control plane.

Call `.complete(proof,capability,result,serverNow)` only after an execution record was independently persisted with the bound job ID. The service rejects any worker-invented result, untrusted certificate reference, wrong snapshot/intent/request, missing or invalid record, failed replay or stale lease, before `jobs.complete`. Exact recorded signed receipt retries work after terminal state. No public COMPLETE endpoint is exposed, and no remote result can claim guaranteed returns. Gate: `npm run gate:phase29b`, full conformance and PostgreSQL matrix.


## Phase 2.9C — enable remote verified terminalization

`createAxiomWorkerControlHttpServer({jobs,clock,trustedIngress,verifiedCompletion})` supports an optional `verifiedCompletion` object implementing the trusted `VerifiedRemoteCompletionService.complete` method. Without it, `POST /v1/worker/jobs/:jobId/complete` returns 404. With it, send `{proof,capability,result}` where proof is the registered worker Ed25519 request signed for action COMPLETE, exact job ID and `hashJson({capabilityId,result})`. The server independently looks up the already committed execution, replays the certificate under trusted server keys, compares the result and delegates to its existing signed receipt/fenced terminal repository.

Success returns `{status:"COMPLETED",jobId,jobStatus:"SUCCEEDED"|"DENIED"}`. Exact retries replay the durable signed outcome. Incorrect certificates, tenant/snapshot/intent drift, unknown keys, stale leases or forged result claims fail. No remote `FAIL_TERMINAL` route exists. Configure true mTLS/private network enforcement and the actual trusted replay plane before external deployment. Run `npm run gate:phase29c`, full conformance and PostgreSQL tests. No profit guarantee.
