# Phase 2.4A Proof-Carrying Model Compiler Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral model-to-AXIOM compiler boundary where model output is captured as untrusted data, deterministically compiled/repaired into an immutable validated AXIOM template, and executed later only against fresh trusted world state through the existing Phase-2 control plane and Phase-1 runtime.

**Architecture:** Add versioned Phase-1 compiler identity, exact `model:compile` / `model:execute` API actions, a server-owned compiler-profile/model-adapter registry, strict proposal parsing and deterministic placeholder assembly, bounded repair using Phase-1 compiler diagnostics, immutable exchange/compilation persistence in SQLite/PostgreSQL, and execution by stored compilation ID. Model provider calls happen only during compilation; execution and replay never call the model.

**Tech Stack:** TypeScript on Node.js 24.12, Node `http`/`fetch`/`crypto`/`sqlite`, PostgreSQL 17 via `pg`, existing AXIOM Phase-1 compiler/runtime/canonicalization, existing Phase-2 auth/authz/idempotency/audit/control-plane patterns, GitLab CI.

## Global Constraints

- Model output never executes directly.
- Network or model output never establishes `TenantScope`.
- Authentication and exact authorization precede tenant runtime/model profile/secret/provider access.
- JWT tenant/role/scope claims remain non-authoritative.
- Model output never supplies trusted runtime input values, evidence, evidence policy, operation registry, signer identity, tenant scope, or platform context.
- Caller compile requests may provide only registered `profileId`, objective, and typed input contracts.
- Input contracts deterministically derive all later evidence requirements/bindings.
- Every compiled-program input must correspond exactly to one stored input contract and must be overwritten from fresh trusted world state before execution.
- Model proposals may contain only assumptions, nodes, constraints, and decisionNodeId.
- Reserved `AXIOM_PLATFORM_CONTEXT_SHA256:` assumptions are forbidden at model-compilation time.
- Server-owned compiler profiles define adapter ID, allowed operations, limits, and hard-bounded repair count.
- `maxRepairAttempts` is 0..2; at most three model calls can occur per compilation.
- Phase-1 `compileProgram` remains authoritative and gains a versioned source-fingerprinted compiler manifest.
- Every validated compilation commits compiler manifest, operation-registry manifest hash, profile hash, model-adapter identity, exact exchange artifact hashes, and compiled-program hash.
- Compiler/operation-registry/profile drift makes a compilation non-executable until explicitly recompiled.
- Exact model exchange artifacts persist sanitized outbound JSON request + raw bounded JSON response, with request/response/artifact hashes; provider secrets must not appear in either body.
- Compile idempotency replays exact completed 201/422 outcomes without model refetch; conflict/in-progress cause zero model calls; ambiguous 5xx remains in progress.
- Execute idempotency replays exact completed response without model or control-plane re-execution.
- Model execution loads only an immutable `VALIDATED` record and invokes the existing `ReasoningControlPlane`; no direct Phase-1 runtime bypass is added.
- Stored reasoning replay remains network/model-free.
- SQLite/PostgreSQL semantics must remain equivalent.
- Phase-1, Phase-2.1, Phase-2.2, and Phase-2.3A tests/gates remain green.
- No unresolved Critical or Important security finding may remain before merge.

---

### Task 1: Add Phase-1 compiler identity and exact model API authorization/routing surface

**Files:**
- Modify: `reasoning/phase1/src/compiler.ts`
- Modify: `reasoning/phase1/src/types.ts`
- Test: `reasoning/phase1/tests/compiler.test.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/authorization.ts`
- Modify: `reasoning/phase2/src/security_store.ts`
- Modify: `reasoning/phase2/src/security_postgres.ts`
- Modify: `reasoning/phase2/src/http_server.ts`
- Test: `reasoning/phase2/tests/authorization.test.ts`
- Test: `reasoning/phase2/tests/http.integration.test.ts`
- Test: `reasoning/phase2/tests/security_persistence.test.ts`

**Interfaces:**
- Produces `CompilerManifest` and `compilerManifest(): CompilerManifest`.
- Extends `ApiAction` with `"model:compile" | "model:execute"`.
- Extends `ApiResource` with `kind:"model_compilation"`.
- Adds compile route `POST /v1/tenants/:tenantId/model/compilations`.
- Adds execute route `POST /v1/tenants/:tenantId/model/compilations/:compilationId/executions`.
- Adds Phase-2 model compilation request/result/record types required by later tasks.

- [ ] **Step 1: Add focused failing tests**
  - Phase-1 compiler exports manifest ID `axiom.phase1-compiler`, semantic version, and lowercase SHA-256 implementation hash.
  - Calling `compileProgram` remains behaviorally identical.
  - Exact `model:compile` grant authorizes only resource `{kind:"model_compilation"}`.
  - Exact `model:execute` grant authorizes only `{kind:"model_compilation",id:<non-empty>}`.
  - `execution:create` cannot authorize model compile/execute and model compile cannot authorize execute.
  - Invalid model resource target is denied before grant repository access.
  - HTTP transport maps the two routes exactly and forwards idempotency key; request ID remains server-generated.
  - SQLite durable grant storage accepts both new actions.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase1
node --disable-warning=ExperimentalWarning --test tests/compiler.test.ts
cd ../phase2
node --disable-warning=ExperimentalWarning --test tests/authorization.test.ts tests/http.integration.test.ts tests/security_persistence.test.ts
```

Expected: only new compiler-manifest/model action/resource/route assertions fail for missing behavior.

- [ ] **Step 3: Implement the minimum surface**
  - Source-fingerprint `compiler.ts` exactly as Phase-1 registry/Phase-2 policy code fingerprints implementation.
  - Export compiler manifest without changing compile semantics.
  - Add model types from the approved spec: `ModelInputContract`, `ModelProgramProposal`, `ModelCompilationIssue`, `ModelCompilerProfile`, `ModelAdapterManifest`, `ModelExchangeArtifact`, `ModelCompilationRecord`, compile/execute request/result types.
  - Extend exact authorization action/resource validators in authorizer and both security repositories.
  - Add both HTTP routes. Missing idempotency on recognized mutations must still reach the application service so authenticated audit handling can occur.

- [ ] **Step 4: Verify the focused pass**

Run the commands above. Expected: focused suites pass.

- [ ] **Step 5: Run affected integration checks**

Run:
```sh
cd reasoning/phase1 && npm run conformance && npm run gate
cd ../phase2 && npm run conformance && npm run gate
```

Expected: all existing Phase-1 and Phase-2 tests/gates pass unchanged.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): add model compilation authorization surface [green]`

---

### Task 2: Add server-owned compiler profiles, strict proposal parser, deterministic placeholders, and compilation identity helpers

**Files:**
- Create: `reasoning/phase2/src/model_compiler.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/model_compiler.test.ts`

**Interfaces:**
- Produces `ModelCompilerRegistry`.
- Produces `parseModelProposal(raw: unknown, profile): ModelProgramProposal`.
- Produces `assembleModelProgram(request, proposal): AxiomProgram`.
- Produces canonical profile/contract/registry/program hash helpers.
- Consumes Phase-1 `TypeRef`, `AxiomProgram`, `compileProgram`, `compilerManifest`, and `OperationRegistry.manifest()`.

- [ ] **Step 1: Add focused failing tests**
  - Profile registry rejects duplicate profile IDs, duplicate allowed operations, unknown allowed operations, invalid limits, or repair attempts outside 0..2.
  - Profile hash is deterministic across construction order and changes whenever any effective profile field changes.
  - Profile resolution is tenant-eligible and server-owned.
  - Strict proposal parser accepts only `assumptions/nodes/constraints/decisionNodeId`.
  - Proposal rejects forbidden `inputs`, `tenantId`, `requirements`, `bindings`, `signer`, `profileId`, and unknown root fields.
  - Proposal rejects reserved platform-context assumption.
  - Proposal enforces profile count limits and allowed operation IDs.
  - Deterministic placeholders cover number, decimal, boolean, string, series, nested record.
  - Placeholder provenance is `model-compile-contract:<contractHash>:<inputName>` with correct `contentHash`.
  - Assembled input keys exactly equal canonical contract input names.
  - Same request+proposal gives identical assembled program/hash; contract or proposal change changes hash.
  - Duplicate inputName/requirementId, invalid maxAgeMs, malformed TypeRef fail closed.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/model_compiler.test.ts
```

Expected: missing model compiler module/interfaces.

- [ ] **Step 3: Implement the minimum deterministic kernel**
  - Canonicalize profile `allowedOperationIds` and input contracts.
  - Compute `profileHash=hashJson(canonicalProfileFields)`.
  - Use recursive deterministic placeholder generation.
  - Validate TypeRef structurally; do not accept executable/custom type behavior.
  - Strictly clone validated proposal data.
  - Enforce operation allowlist before Phase-1 compilation.
  - Normalize boundary issues using stable model issue codes.
  - Provide helper converting stored contracts into exact `EvidenceRequirement[]` and `InputBinding[]`.

- [ ] **Step 4: Verify the focused pass**

Run the focused test. Expected: all model-compiler kernel tests pass.

- [ ] **Step 5: Run affected integration check**

Run `npm run conformance` in `reasoning/phase2`. Expected: all tests pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): add deterministic model compiler kernel [green]`

---

### Task 3: Add provider-neutral fixed-HTTPS structured model adapter and immutable exchange artifacts

**Files:**
- Create: `reasoning/phase2/src/model_adapter.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/model_adapter.test.ts`

**Interfaces:**
- Produces `ModelAdapter`, `ModelAdapterInput`, `CapturedModelExchange`, `ModelAdapterError`, `HttpStructuredModelAdapter`.
- Produces `createModelExchangeArtifact` / `verifyModelExchangeArtifact`.
- Consumes existing server-side `SecretResolver`.
- Reuses the already-tested Phase-2.3A HTTPS-origin and bounded-JSON security semantics without changing evidence-adapter behavior.

- [ ] **Step 1: Add focused failing tests**
  - Adapter configuration uses fixed HTTPS origin/path/model ID only.
  - Caller/model input cannot replace origin/path/model ID/provider headers.
  - Literal loopback/link-local/metadata/unspecified/multicast origins rejected.
  - Redirect, disallowed status/media type, invalid UTF-8/JSON, and streaming overflow fail closed.
  - Provider secret resolves only after invocation and is header-only.
  - Sanitized outbound request body contains no configured secret.
  - Response containing exact resolved secret material is rejected.
  - Adapter returns exact sanitized outbound JSON request body and exact raw response body.
  - Initial and repair request envelopes are deterministic for identical inputs.
  - Repair request contains prior bounded response + canonical sorted issues + remaining budget, but cannot alter objective/contracts/profile/allowed operations.
  - Exchange artifact binds tenant, adapter/provider/model/profile, compilation request hash, attempt/mode, timestamp, request body hash, response body hash, and artifact hash.
  - Request/response/metadata tampering is detected on verification.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/model_adapter.test.ts
```

Expected: model adapter/artifact module absent.

- [ ] **Step 3: Implement adapter and artifact primitives**
  - Fixed server-owned `ModelAdapterManifest`.
  - Strict compile/repair JSON request envelope.
  - Production `fetch` default plus injected fetch/clock seams for deterministic tests.
  - No redirects; bounded response streaming; valid JSON required.
  - Gateway response root must contain exactly `proposal`.
  - Create/verify immutable exchange artifacts; secret headers never enter artifact.
  - Model adapter errors carry stable codes and safe HTTP class (413/415/502/504) without raw upstream details.

- [ ] **Step 4: Verify focused pass**

Run focused model-adapter tests. Expected: all pass.

- [ ] **Step 5: Run affected integration check**

Run `npm run conformance`. Expected: all Phase-2 tests pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): add structured model adapter and exchange artifacts [green]`

---

### Task 4: Persist model exchanges and terminal compilations atomically in SQLite and PostgreSQL

**Files:**
- Modify: `reasoning/phase2/src/repositories.ts`
- Create: `reasoning/phase2/src/model_store.ts`
- Create: `reasoning/phase2/src/model_postgres.ts`
- Modify: `reasoning/phase2/sql/postgres.sql`
- Modify: `reasoning/phase2/src/index.ts`
- Create: `reasoning/phase2/tests/model_persistence.test.ts`
- Modify: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Produces `ModelCompilationRepository`.
- SQLite: `ModelCompilationStore`.
- PostgreSQL: `PostgresModelCompilationRepository`.
- Methods:
  - `commitCompilation(scope, artifacts, record): Promise<void>`
  - `getCompilation(scope, compilationId): Promise<ModelCompilationRecord>`
  - `getModelArtifact(scope, artifactId): Promise<ModelExchangeArtifact>`

- [ ] **Step 1: Add focused failing tests**
  - SQLite atomically commits all exchange artifacts + terminal compilation record.
  - Failed artifact/record insert rolls back all new model state.
  - Reads revalidate request/response/artifact hashes.
  - Compilation read revalidates record hash and compiled-program hash for VALIDATED records.
  - REJECTED record cannot contain compiled program/hash; VALIDATED must contain both.
  - Record exchange ID/hash arrays exactly match supplied artifacts and order.
  - Cross-tenant known artifact/compilation IDs return not found.
  - Direct DB request/response/artifact/program/record tampering is detected.
  - Serialized DB rows contain no configured provider secret fixture.
  - PostgreSQL reproduces commit, rollback, integrity, status-shape, and tenant-isolation behavior.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/model_persistence.test.ts
```

Expected: repository/store modules absent.

- [ ] **Step 3: Implement atomic persistence**
  - Add tenant-scoped SQLite `model_exchange_artifacts` and `model_compilations`.
  - Add PostgreSQL `axiom_model_exchange_artifacts` and `axiom_model_compilations`.
  - Store redundant request/response/artifact/record/program hashes needed for tamper detection.
  - Validate all artifacts and record relationships before transaction.
  - SQLite uses one `BEGIN IMMEDIATE`; PostgreSQL uses one transaction.
  - No partial terminal compilation state is visible.

- [ ] **Step 4: Verify focused pass**

Run model persistence tests. Expected: all pass.

- [ ] **Step 5: Run live PostgreSQL parity**

Run:
```sh
cd reasoning/phase2
npm run conformance
npm run test:postgres
```

Expected: conformance and PostgreSQL suites pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): persist model compilations atomically [green]`

---

### Task 5: Implement proof-carrying compilation and hard-bounded deterministic repair

**Files:**
- Create: `reasoning/phase2/src/model_compilation_service.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/model_compilation_service.test.ts`

**Interfaces:**
- Produces `ModelCompilationService.compile(context, request, compilationRequestHash): Promise<ModelCompileResult>`.
- Consumes `ModelCompilerRegistry`, `ModelCompilationRepository`, Phase-1 `compileProgram`, compiler manifest, current `OperationRegistry`, and model adapter.
- Returns terminal `VALIDATED` or `REJECTED`; provider/persistence failures throw safe typed errors.

- [ ] **Step 1: Add focused failing tests**
  - Unauthorized/wrong-action context rejected before profile/model call.
  - Initial valid proposal -> one model call, one artifact, `VALIDATED` record.
  - Invalid unknown operation/type/graph proposal -> deterministic normalized issues.
  - Initial invalid + repaired valid -> two calls, two ordered artifacts, VALIDATED.
  - Two failed repairs -> exactly three total calls, REJECTED record, no executable program.
  - Repair request receives sorted deterministic issues and previous raw bounded response.
  - Model cannot change objective/contracts/profile/allowed operations between repairs.
  - Forbidden inputs/tenant/bindings/signer/reserved-context proposal fields never reach Phase-1 execution.
  - Every final program input derives from stored contract placeholders.
  - Record commits compiler manifest, current registry manifest hash, profile hash, adapter manifest, artifacts, final issues, compiled program/hash.
  - Same validated proposal/contracts under changed compiler/registry/profile identity yields a different compilation commitment.
  - Provider failure before terminal compilation causes no repository commit.
  - Persistence failure after provider call is propagated as internal failure; caller-layer idempotency can remain IN_PROGRESS.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/model_compilation_service.test.ts
```

Expected: compilation service absent.

- [ ] **Step 3: Implement bounded compile/repair**
  - Verify `AuthorizedTenantContext` exactly matches `model:compile`.
  - Resolve tenant-eligible server profile.
  - Validate/canonicalize request and contracts before model call.
  - Invoke initial model adapter.
  - Capture exchange artifact.
  - Strict-parse proposal, assemble full program, enforce profile, call `compileProgram`.
  - Normalize/sort model/Phase-1 issues.
  - Repair only while budget remains.
  - Commit all artifacts + terminal record once.
  - Never execute a compiled program in this service.

- [ ] **Step 4: Verify focused pass**

Run focused compilation-service tests. Expected: all pass.

- [ ] **Step 5: Run affected integration check**

Run `npm run conformance`. Expected: all tests pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): compile and repair model proposals deterministically [green]`

---

### Task 6: Execute immutable model compilations through fresh world state and expose compile/execute API idempotently

**Files:**
- Create: `reasoning/phase2/src/model_execution_service.ts`
- Modify: `reasoning/phase2/src/api_service.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/model_execution_service.test.ts`
- Modify: `reasoning/phase2/tests/api_service.test.ts`
- Modify: `reasoning/phase2/tests/http.integration.test.ts`

**Interfaces:**
- Produces `ModelExecutionService.execute(context, compilationId, timing): Promise<ControlPlaneResult>`.
- Extends `TenantRuntime` with model compiler/executor services.
- Adds both model actions to mutation idempotency.
- Compile success HTTP 201; terminal rejected compilation HTTP 422.
- Model execute success/controlled policy denial HTTP 200 using existing `ControlPlaneResult`.

- [ ] **Step 1: Add focused failing tests**
  - Compile auth denial -> zero runtime/profile/model/secret/network calls.
  - Compile authz denial -> zero model access.
  - Missing compile idempotency key is audited after auth/authz and performs zero model call.
  - First compile invokes model and returns 201 VALIDATED; exact retry returns exact bytes and zero refetch.
  - REJECTED terminal compilation returns 422 and exact retry returns same 422 body with zero refetch.
  - Changed compile request same key -> 409 and zero model calls.
  - Compile IN_PROGRESS -> 409 and zero model calls.
  - Provider 502/504 or internal 500 does not complete idempotency.
  - Execute auth/action is independent from `execution:create`.
  - Authorized execute loads tenant-scoped compilation and rejects REJECTED record before control-plane access.
  - Compiler manifest drift, registry manifest drift, or profile hash drift -> 409 `COMPILATION_STALE`, zero control-plane calls.
  - Corrupt record/program hash -> opaque 500, zero control-plane calls.
  - Input-contract keys must equal compiled template inputs exactly.
  - Execute derives exact requirements/bindings from contracts and passes only stored compiled template + caller timing to `ReasoningControlPlane.execute`.
  - Fresh world-state values overwrite every compile placeholder; test through a real control plane and assert certificate replay program contains world-state provenance, never compile-placeholder provenance.
  - Execute completed retry performs zero model and zero control-plane re-execution.
  - Cross-tenant known compilation ID is inaccessible after exact authorization boundary.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/model_execution_service.test.ts tests/api_service.test.ts tests/http.integration.test.ts
```

Expected: model services/API behavior missing.

- [ ] **Step 3: Implement execution/API integration**
  - `ModelExecutionService` verifies exact `model:execute` context.
  - Read and integrity-check compilation.
  - Require VALIDATED.
  - Resolve current profile without model invocation and compare canonical profile hash.
  - Compare current compiler manifest and registry manifest hash.
  - Verify exact program input/contract set and compile-only placeholder namespace.
  - Derive requirements/bindings from contracts.
  - Clone stored program and call existing `ReasoningControlPlane.execute`.
  - Extend application-service body validation, typed error mapping, audit outcomes, and mutation idempotency.
  - Do not expose raw model artifacts/provider responses through the public API.

- [ ] **Step 4: Verify focused pass**

Run focused tests. Expected: all pass.

- [ ] **Step 5: Run affected integration checks**

Run:
```sh
cd reasoning/phase1 && npm run conformance && npm run gate
cd ../phase2 && npm run conformance && npm run gate
```

Expected: all prior behavior plus new model API tests pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): execute immutable model compilations through control plane [green]`

---

### Task 7: Add Phase-2.4A acceptance gate, PostgreSQL parity, documentation, CI, and final adversarial review

**Files:**
- Create: `reasoning/phase2/scripts/phase2-4a-gate.ts`
- Modify: `reasoning/phase2/package.json`
- Modify: `.gitlab-ci.yml`
- Modify: `reasoning/phase2/ARCHITECTURE.md`
- Modify: `reasoning/phase2/SECURITY.md`
- Modify: `reasoning/phase2/CONFORMANCE.md`
- Modify: `reasoning/phase2/README.md`
- Create: `reasoning/phase2/phase2_4a_progress.md`
- Modify: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Adds `npm run gate:phase24a`.
- Aggregate `npm run gate` runs Phase-2.1, 2.2, 2.3A, 2.4A.
- Phase-2 GitLab CI explicitly runs every Phase-2 gate.
- No new product behavior except security fixes exposed by final adversarial review.

- [ ] **Step 1: Add the real end-to-end gate**
  - Real ephemeral AXIOM HTTP server.
  - Real SQLite world/security/execution/model-compilation persistence.
  - Real Ed25519 API/source/reasoning key identities.
  - Concrete `HttpStructuredModelAdapter` with controlled deterministic provider transport.
  - Initial invalid proposal (for example forbidden/unknown operation) followed by one valid repair.
  - Compile via authenticated HTTP API.
  - Verify exact captured exchange artifacts/hashes and provider-secret exclusion.
  - Exact compile retry returns byte-identical result with provider call count unchanged.
  - Cross-tenant compile attempt denied before provider call/runtime creation.
  - Execute stored validated compilation via authenticated HTTP API.
  - World state supplies values newer/different from placeholders; certificate replay program proves every input came from world state.
  - Existing evidence policy still controls execution.
  - Exact execute retry returns byte-identical result with control-plane execution count unchanged.
  - Stored reasoning replay causes zero model provider calls.
  - Deliberately changed compiler/profile/registry test fixture rejects stored compilation before execution.
  - Direct DB artifact/compilation tampering is detected.
  - REJECTED compilation path makes no reasoning execution.
  - Live PostgreSQL model artifact/compilation atomicity/tamper/isolation parity.

- [ ] **Step 2: Verify missing final integration fails only where expected**

Run:
```sh
cd reasoning/phase2
npm run conformance
node --disable-warning=ExperimentalWarning scripts/phase2-4a-gate.ts
npm run test:postgres
```

Expected before final wiring: the new gate or missing script integration fails; existing unrelated tests must remain green.

- [ ] **Step 3: Wire gate/docs/CI**
  - Add `gate:phase24a` and append it to aggregate `gate`.
  - Add explicit Phase-2.4A gate invocation to CI.
  - Document model output as untrusted proposal, compile-only placeholders, profile/compiler/registry identity, bounded repair, exchange artifacts, idempotency/no-refetch, immutable execution, and explanation deferral.
  - Record exact TDD/acceptance evidence in `phase2_4a_progress.md`.

- [ ] **Step 4: Run full fresh verification**

Run:
```sh
cd reasoning/phase1
npm run conformance
npm run gate

cd ../phase2
npm ci --ignore-scripts --no-audit --no-fund
npm run conformance
npm run gate
npm run test:postgres
```

Expected:
- Phase 1 tests all pass + P1 gate PASS.
- Phase 2 tests all pass.
- Phase-2.1 gate PASS.
- Phase-2.2 gate PASS.
- Phase-2.3A gate PASS.
- Phase-2.4A gate PASS.
- PostgreSQL integration all passes.

- [ ] **Step 5: Perform bounded security review against Phase-2.3A base**
  - Review every changed file against `3958b2c56e69474f0e103b318690dd265e1d1fec`.
  - Treat any of the following as Critical/Important:
    - model output directly executable;
    - model/caller can inject trusted values, tenant, policy, binding, signer, registry, or reserved platform context;
    - auth/authz/idempotency occurs after provider access;
    - completed retries refetch/re-execute;
    - provider secrets persist or return;
    - repair is unbounded or can change authority-bearing compile request fields;
    - invalid/rejected/stale/corrupt compilation can execute;
    - compiler/registry/profile drift is ignored;
    - placeholders survive execution;
    - cross-tenant compilation access;
    - model artifacts/records lack integrity binding;
    - model execution bypasses existing control plane or Phase-1.
  - Fix every Critical/Important finding test-first and rerun full verification.

- [ ] **Step 6: Commit final package**

Commit message:
`docs(phase2): package proof-carrying model compiler gate`

## Unresolved Product Decisions

None. The approved Phase-2.4A specification fixes the externally observable behavior for this increment. Provider-specific first-party adapters and advisory natural-language explanation are explicitly deferred to Phase 2.4B.
