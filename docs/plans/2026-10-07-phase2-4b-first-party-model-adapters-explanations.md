# Phase 2.4B First-Party Model Adapters and Proof-Bound Advisory Explanations Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-party OpenAI Responses and Anthropic Messages compiler adapters plus tenant-scoped, replay-verified, advisory model explanations without weakening any existing AXIOM trust boundary.

**Architecture:** Provider-specific codecs use an explicit bounded HTTPS transport and never expose tools, arbitrary URLs, provider-managed memory, or caller-selected models. Compilation persists exact provider transport bodies plus a separately hash-bound normalized proposal; explanations are generated only after stored execution replay returns `MATCH`, are persisted as immutable advisory records, and use their own exact authorization/idempotency surface.

**Tech Stack:** TypeScript on Node 24.12, Node fetch/crypto/sqlite, PostgreSQL 17 + node-postgres, Phase-1 AXIOM compiler/runtime/certificates, GitLab CI.

## Global Constraints

- Start from design head `290f9054bfd81bac1940c8590dfbd1ab0238e998`, itself based on verified main `bbb9458b26a099560ea5d9ee3d79ba6459333ced`.
- Preserve every Phase-1, Phase-2.1, Phase-2.2, Phase-2.3A, and Phase-2.4A trust invariant and gate.
- Provider credentials are server-owned secret references resolved only after authentication, exact authorization, request-shape validation, and idempotency claim.
- Credentials may exist only in request headers; persisted request/response/normalized bodies and audits must reject discovered secret material.
- Provider origin, path, model ID, API version, output schema, and capabilities are server-owned; caller input cannot set them.
- Provider tools, function calling, web search, MCP, code execution, arbitrary external fetch, conversation state, and previous-response chaining are disabled.
- Exact provider request and bounded provider response bodies are persisted and hash-bound; normalized proposal/explanation material is separately hash-bound.
- Compilation still uses the existing strict proposal parser, deterministic assembly, Phase-1 compiler, and bounded repair count.
- `model:explain` is independent from `model:compile`, `model:execute`, and `execution:read`.
- Explanation requires an existing tenant-scoped execution and network-free replay `MATCH` before secret resolution/provider access.
- Explanation is always `ADVISORY_ONLY` and can never alter facts, snapshots, policy, AXIOM-IR, execution, certificates, or authorization.
- Completed idempotent retries return exact stored outcomes without provider refetch; provider/internal 5xx outcomes do not complete the idempotency claim.
- SQLite and PostgreSQL semantics must match.
- No unresolved Critical or Important review finding may remain before merge.
- Source branches are retained and merge commits are not squashed.

---

### Task 1: Hash-bind normalized model output without losing exact provider transport

**Files:**
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/model_adapter.ts`
- Modify: `reasoning/phase2/src/model_compilation_service.ts`
- Modify: `reasoning/phase2/src/model_store.ts`
- Modify: `reasoning/phase2/src/model_postgres.ts`
- Test: `reasoning/phase2/tests/model_adapter.test.ts`
- Test: `reasoning/phase2/tests/model_compilation_service.test.ts`
- Test: `reasoning/phase2/tests/model_persistence.test.ts`

**Interfaces:**
- Consumes: existing `ModelAdapter.invoke(input): Promise<CapturedModelExchange>`, `ModelExchangeArtifact`, `ModelCompilationService`.
- Produces:
  - `CapturedModelExchange { capturedAt, requestBody, responseBody, normalizedResponseBody }`
  - `ModelExchangeArtifact.normalizedResponseBody?: string`
  - `ModelExchangeArtifact.normalizedResponseBodyHash?: string`
  - `createModelExchangeArtifact(...)` commits the normalized body when present.
  - Compilation proposal parsing and repair state use `normalizedResponseBody`, not raw provider response.

- [ ] **Step 1: Add the focused failing tests**

Require:
- a new artifact to hash exact request, exact raw response, and normalized response independently;
- mutation of normalized response or its hash to fail artifact verification;
- `HttpStructuredModelAdapter` to set normalized response equal to its already validated gateway body;
- compilation to accept a raw provider response that is not gateway-shaped when its separately supplied normalized response is valid;
- repair requests to receive the prior normalized response, not the raw provider envelope;
- a synthetic Phase-2.4A artifact without normalized fields to remain readable and verifiable.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/model_adapter.test.ts tests/model_compilation_service.test.ts tests/model_persistence.test.ts`

Expected: new assertions fail because `CapturedModelExchange` has no normalized body and compilation parses `responseBody` directly.

- [ ] **Step 3: Implement the minimum behavior**

Extend types and artifact hashing with optional normalized fields. For new adapter output, require both normalized body and its SHA-256 hash to agree. Keep backward verification logic for old artifacts by omitting normalized fields from the hash core when both are absent; reject one-without-the-other states.

Change `ModelCompilationService` so:
- `previousResponseBody` stores prior normalized gateway body;
- `gatewayProposal(...)` receives `captured.normalizedResponseBody`;
- persisted artifact still stores exact raw provider response independently.

Do not alter the Phase-1 compiler, proposal parser, repair budget, or compilation record identity beyond the changed artifact hashes.

- [ ] **Step 4: Verify the focused pass**

Run: same focused command.

Expected: all focused tests pass, including backward compatibility.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance && npm run gate:phase24a`

Expected: existing Phase-2 conformance and Phase-2.4A gate remain green.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): bind normalized model exchange output`

---

### Task 2: First-party OpenAI Responses compiler adapter

**Files:**
- Create: `reasoning/phase2/src/model_provider_transport.ts`
- Create: `reasoning/phase2/src/openai_model_adapter.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/openai_model_adapter.test.ts`

**Interfaces:**
- Consumes: `ModelAdapter`, `ModelAdapterInput`, `CapturedModelExchange`, `SecretResolver`, injected fetch.
- Produces:
  - bounded shared provider POST helper that takes fixed URL configuration and canonical JSON body;
  - `OpenAiResponsesModelAdapter implements ModelAdapter`.

- [ ] **Step 1: Add the focused failing test**

Require the OpenAI adapter to:
- POST only to configured fixed HTTPS origin + `/v1/responses`;
- use server-owned manifest model ID;
- send `store:false`, one user input containing the canonical AXIOM request, and a strict JSON-schema output format for the gateway proposal;
- send no tools, conversation, previous-response ID, user-controlled URL, or caller-selected model;
- resolve Authorization bearer credentials into headers only;
- persist exact request body without the credential;
- parse exactly one assistant `output_text` block containing exactly one top-level `proposal`;
- return exact raw provider response plus canonical normalized gateway body;
- reject redirects, non-2xx, wrong media type, oversized body, invalid JSON, zero/multiple output-text blocks, extra gateway top-level keys, secret echo, timeout, and network failure.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/openai_model_adapter.test.ts`

Expected: module missing.

- [ ] **Step 3: Implement the minimum behavior**

Build a provider transport helper using the same redirect/manual, abort timeout, bounded body, allowed media type/status, and secret-leak principles as the existing HTTP evidence/model path.

OpenAI adapter defaults:
- origin `https://api.openai.com`;
- path `/v1/responses`;
- `Authorization: Bearer <resolved secret>`;
- JSON request with server-owned `model`, `store:false`, one user input, no tools/conversation chaining, and strict gateway proposal JSON schema.

Normalize only after exact response capture. Reject ambiguous response shapes rather than concatenating multiple text blocks.

- [ ] **Step 4: Verify the focused pass**

Run: focused OpenAI test.

Expected: all OpenAI adapter cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance && npm run gate:phase24a`

Expected: all prior model compilation behavior remains green.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): add OpenAI Responses compiler adapter`

---

### Task 3: First-party Anthropic Messages compiler adapter

**Files:**
- Create: `reasoning/phase2/src/anthropic_model_adapter.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/anthropic_model_adapter.test.ts`

**Interfaces:**
- Consumes: shared provider transport, `ModelAdapter`, `SecretResolver`.
- Produces: `AnthropicMessagesModelAdapter implements ModelAdapter`.

- [ ] **Step 1: Add the focused failing test**

Require the Anthropic adapter to:
- POST only to fixed HTTPS origin + `/v1/messages`;
- use server-owned manifest model ID, fixed `anthropic-version`, server-owned `max_tokens`, and header-only `x-api-key`;
- send one user message containing the canonical AXIOM request;
- use `output_config.format.type="json_schema"` with the gateway proposal schema;
- omit tools, MCP, containers, memory, and arbitrary external capabilities;
- require exactly one text content block with a gateway object containing exactly one `proposal`;
- return exact raw transport response plus canonical normalized body;
- reject redirect/status/media/bounds/JSON/ambiguity/secret-leak/timeout/network failures identically to the OpenAI adapter.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/anthropic_model_adapter.test.ts`

Expected: module missing.

- [ ] **Step 3: Implement the minimum behavior**

Build the fixed Messages API request and deterministic response extractor. Keep provider-version/max-token configuration server-owned and constructor validated. Use the shared bounded transport; do not add provider SDK dependencies.

- [ ] **Step 4: Verify the focused pass**

Run: focused Anthropic test.

Expected: all Anthropic adapter cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance && npm run gate:phase24a`

Expected: prior gates pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): add Anthropic Messages compiler adapter`

---

### Task 4: Proof-bound advisory explanation service

**Files:**
- Create: `reasoning/phase2/src/model_explanation.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/repositories.ts`
- Test: `reasoning/phase2/tests/model_explanation.test.ts`

**Interfaces:**
- Consumes:
  - `ExecutionRepository.get(scope,id)`
  - `plane.replayStored(id): Promise<ReplayResult>`
  - provider adapter manifest + bounded provider invocation
  - authorized context with exact action/resource.
- Produces:
  - `ModelExplanationProfile`
  - `ModelExplanationRegistry.resolve(scope,profileId)`
  - `ModelExplanationContent {summary,keyFactors,limitations}`
  - `ModelExplanationRecord`
  - `ModelExplainRequest {profileId}`
  - `ModelExplainResult {status:"CREATED", explanationId, authority:"ADVISORY_ONLY", content, provider, modelId}`
  - `ModelExplanationRepository.put/get`
  - `ModelExplanationService.explain(context,executionId,request,requestHash)`.

- [ ] **Step 1: Add the focused failing tests**

Require:
- exact `model:explain` authorization for exact execution resource;
- profile tenant eligibility and profile hash;
- execution loaded tenant-scoped before provider use;
- `replayStored(executionId)` must return `MATCH` before secret resolution/provider invocation;
- sanitized proof prompt contains execution/snapshot/policy/certificate/record commitments and no bearer token, credential, grant set, or unrelated world-state data;
- explanation JSON must contain exactly summary/keyFactors/limitations with bounded counts/item sizes;
- output is tagged `ADVISORY_ONLY`;
- provider invocation cannot mutate the loaded execution object;
- replay mismatch, missing record, invalid provider JSON, secret echo, and profile ineligibility fail closed.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/model_explanation.test.ts`

Expected: module/types missing.

- [ ] **Step 3: Implement the minimum behavior**

Implement a server-owned explanation profile registry with deterministic profile hash and tenant allowlist.

Implement explanation request construction from a structured clone of the verified stored execution. Call replay before adapter invocation. Use an explanation-specific provider invocation contract that captures exact request/response and normalized explanation JSON; it may reuse the bounded provider transport but must not reuse compiler proposal semantics.

Create the record hash and deterministic explanation ID from tenant, execution record hash, principal/auth decision, profile/adapter identity, transport hashes, normalized explanation hash, and captured time. Mark authority literally `ADVISORY_ONLY`.

- [ ] **Step 4: Verify the focused pass**

Run: focused explanation test.

Expected: all proof/order/bounds cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance`

Expected: all Phase-2 unit tests pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): add proof-bound advisory explanation service`

---

### Task 5: Tenant-scoped immutable explanation persistence with PostgreSQL parity

**Files:**
- Create: `reasoning/phase2/src/model_explanation_store.ts`
- Create: `reasoning/phase2/src/model_explanation_postgres.ts`
- Modify: `reasoning/phase2/sql/postgres.sql`
- Modify: `reasoning/phase2/tests/postgres.integration.ts`
- Test: `reasoning/phase2/tests/model_explanation_persistence.test.ts`

**Interfaces:**
- Consumes: `ModelExplanationRecord`, `ModelExplanationRepository`, `TenantScope`.
- Produces:
  - SQLite `ModelExplanationStore`;
  - PostgreSQL `PostgresModelExplanationRepository`;
  - `verifyModelExplanationRecord(scope,record)`.

- [ ] **Step 1: Add the focused failing tests**

Require SQLite and PostgreSQL to:
- persist/get explanation under composite tenant + explanation ID;
- reject cross-tenant known-ID reads;
- reject tenant mismatch on write;
- reject tampered record hash, request body/hash, response body/hash, normalized body/hash, advisory content, execution record hash, profile identity, or adapter identity;
- preserve exact request/response/normalized bytes;
- roll back on failed insert and never return partial explanation state.

- [ ] **Step 2: Verify the relevant failure**

Run SQLite focused test and the PostgreSQL CI integration test on the feature branch.

Expected: explanation repository/schema missing.

- [ ] **Step 3: Implement the minimum behavior**

Add a single tenant-scoped explanation table in SQLite and PostgreSQL with redundant columns for record hash and all body hashes/bodies plus JSON record. Every read includes `tenant_id`. Verify row redundancy before returning the parsed record.

- [ ] **Step 4: Verify the focused pass**

Run: `cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/model_explanation_persistence.test.ts`

Expected: SQLite cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: feature-branch GitLab pipeline PostgreSQL job.

Expected: PostgreSQL explanation parity assertions pass with all prior PostgreSQL tests.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): persist advisory model explanations`

---

### Task 6: Expose exact model:explain API authorization, idempotency, and audit semantics

**Files:**
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/authorization.ts`
- Modify: `reasoning/phase2/src/api_service.ts`
- Modify: `reasoning/phase2/src/http_server.ts`
- Modify: `reasoning/phase2/tests/authorization.test.ts`
- Modify: `reasoning/phase2/tests/api_service.test.ts`
- Modify: `reasoning/phase2/tests/http.integration.test.ts`

**Interfaces:**
- Consumes: `ModelExplanationService.explain(...)`, existing auth/idempotency/audit pipeline.
- Produces:
  - `ApiAction += "model:explain"`;
  - route `POST /v1/tenants/:tenantId/executions/:executionId/explanations`;
  - exact `ApiResource {kind:"execution",id}`;
  - tenant runtime `modelExplainer.explain(...)`.

- [ ] **Step 1: Add the focused failing tests**

Require:
- `model:compile`, `model:execute`, and `execution:read` grants do not imply `model:explain`;
- auth -> authz -> shape -> tenant context -> idempotency claim happens before runtime/provider access;
- missing idempotency key returns 400 before runtime creation;
- same key + same request replays exact stored 201 outcome with zero extra provider calls;
- same key + changed request returns 409;
- profile forbidden maps to 403 and audit `MODEL_EXPLANATION_PROFILE_FORBIDDEN`;
- execution missing maps to 404;
- replay mismatch/proof rejection maps to 422 and audit `MODEL_EXPLANATION_PROOF_REJECTED`;
- provider 413/415/502/504 maps to stable provider error responses and audit `MODEL_EXPLANATION_UPSTREAM_FAILED`;
- provider/internal 5xx does not complete idempotency;
- successful create maps to 201 and audit `MODEL_EXPLANATION_CREATED`.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/authorization.test.ts tests/api_service.test.ts tests/http.integration.test.ts`

Expected: new action/route/runtime surface is missing.

- [ ] **Step 3: Implement the minimum behavior**

Add action/resource routing and body shape `{profileId}` with no caller provider/model/origin fields. Include `model:explain` in mutation/idempotency handling. Add stable error mapping and audit outcomes without changing existing action mappings.

- [ ] **Step 4: Verify the focused pass**

Run: same focused API tests.

Expected: all new and prior cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance && npm run gate:phase22 && npm run gate:phase24a`

Expected: auth/API and Phase-2.4A invariants remain green.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): expose proof-bound model explanation API`

---

### Task 7: Phase-2.4B acceptance gate, documentation, CI, and bounded security review

**Files:**
- Create: `reasoning/phase2/scripts/phase2-4b-gate.ts`
- Create: `reasoning/phase2/phase2_4b_progress.md`
- Modify: `reasoning/phase2/package.json`
- Modify: `.gitlab-ci.yml`
- Modify: `reasoning/phase2/README.md`
- Modify: `reasoning/phase2/ARCHITECTURE.md`
- Modify: `reasoning/phase2/SECURITY.md`
- Modify: `reasoning/phase2/CONFORMANCE.md`
- Modify: `progress.md`

**Interfaces:**
- Consumes: provider adapters, normalized compilation artifacts, explanation service/persistence/API, all existing gates.
- Produces: `npm run gate:phase24b`; aggregate gate includes Phase-2.4B.

- [ ] **Step 1: Add the failing end-to-end gate**

Gate must:
- compile a valid bounded proposal through a mocked OpenAI adapter and a mocked Anthropic adapter;
- assert exact raw provider transport bodies and normalized proposal hashes are distinct commitments;
- execute a validated compilation using fresh trusted world state through the unchanged control plane;
- generate an explanation only after replay `MATCH`;
- assert explanation authority is `ADVISORY_ONLY`;
- assert stored execution/certificate hashes are unchanged before/after explanation;
- replay the identical explain request without a second provider call;
- prove cross-tenant execution and forced replay mismatch fail before provider invocation;
- tamper with persisted explanation material and prove read rejection.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && npm run gate:phase24b`

Expected: script missing or gate fails until full composition is present.

- [ ] **Step 3: Implement composition and documentation**

Add `gate:phase24b` and include it in aggregate `gate` and GitLab Phase-2 conformance job.

Document:
- exact first-party provider boundaries;
- server-owned model/origin capability rules;
- exact/normalized transport commitments;
- advisory explanation semantics;
- replay-before-provider ordering;
- independent `model:explain` grant;
- remaining boundaries, especially no provider tools, no arbitrary endpoints, no distributed workers, no HSM/KMS deployment, and no action/brokerage execution.

Update `progress.md` to mark Tasks 1–7 complete only after the final fresh feature-branch pipeline is green.

- [ ] **Step 4: Verify the focused pass**

Run:
`cd reasoning/phase2 && npm run conformance && npm run gate && npm run test:postgres`

Expected locally where PostgreSQL is available: all tests/gates pass.

- [ ] **Step 5: Run final branch verification and bounded security review**

Create a fresh GitLab pipeline at exact feature HEAD and require:
- Phase-1 conformance + Phase-1 gate PASS;
- Phase-2 conformance PASS;
- Phase-2.1/2.2/2.3A/2.4A/2.4B gates PASS;
- PostgreSQL integration PASS.

Review the full delta from `bbb9458b26a099560ea5d9ee3d79ba6459333ced` for:
- secret-resolution ordering;
- authorization separation;
- exact provider request/response capture and leak checks;
- normalized-output integrity;
- replay-before-provider explanation ordering;
- tenant isolation;
- idempotency behavior;
- no model/explanation path mutating trusted execution state.

Resolve every Critical/Important finding with a red-green test before MR.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `docs(phase2): package Phase-2.4B provider and explanation gate`

## Unresolved externally observable decisions

None. The approved design fixes provider targets, route shape, advisory authority, authorization semantics, persistence behavior, error classes, idempotency behavior, and non-goals for this increment.
