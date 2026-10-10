# Phase 2.4B — First-Party Model Adapters and Proof-Bound Advisory Explanations

Date: 2026-10-07
Parent roadmap: #4
Implementation issue: #9
Baseline: `bbb9458b26a099560ea5d9ee3d79ba6459333ced`

## 1. Objective

Phase 2.4B turns the provider-neutral Phase-2.4A model boundary into a production-usable integration layer for two first-party providers while preserving the rule that model output never becomes authority.

The increment delivers:

1. a first-party OpenAI Responses API compiler adapter;
2. a first-party Anthropic Messages API compiler adapter;
3. exact transport capture plus separately hash-bound normalized proposal material;
4. proof-bound advisory explanation of already stored, replay-verified AXIOM executions;
5. tenant-scoped immutable explanation persistence, authorization, idempotency, audit, SQLite/PostgreSQL parity, and an end-to-end Phase-2.4B gate.

## 2. Approaches considered

### A. Provider SDKs inside the trust boundary
Use official Node SDKs and adapt SDK objects into the existing ModelAdapter interface.

Rejected for this increment. SDKs add dependency/version churn, can introduce hidden retries or request transformations, and make exact request-byte capture harder to prove.

### B. Provider-specific codecs over the existing bounded HTTPS transport
Keep transport explicit and dependency-free. Each adapter builds a fixed provider request, resolves credentials only into headers, performs one bounded HTTPS POST, stores exact request/response bodies, then deterministically extracts a normalized AXIOM gateway payload.

Selected. This preserves the strongest Phase-2.4A audit and replay properties while limiting provider-specific code to small codecs.

### C. A separate remote model gateway service
Send AXIOM's canonical request to an externally managed gateway that talks to providers.

Deferred. It can be useful operationally, but it moves trust and audit responsibility out of the repository and does not satisfy the goal of first-party provider integration.

## 3. Trust invariants

Phase 2.4B MUST preserve all Phase-1, Phase-2.1, Phase-2.2, Phase-2.3A, and Phase-2.4A invariants.

Additionally:

- Provider output is never evidence, policy, authorization, signer state, tenant identity, or executable authority.
- Provider credentials are server-owned references, resolved after authentication, exact authorization, request-shape checks, and idempotency claim.
- Provider credentials may appear only in transport headers and MUST NOT appear in persisted request bodies, response bodies, normalized proposal bodies, explanation prompts, explanation text, or audit records.
- Provider origins and paths are fixed by server-owned adapter configuration. Caller input cannot alter URL, model ID, API version, tools, or provider capabilities.
- No tools, function calling, web search, MCP, code execution, file access, arbitrary URL fetches, provider-managed conversations, or previous-response chaining are enabled.
- Provider request/response bodies are bounded and captured exactly as sent/received.
- Proposal normalization is deterministic and separately hash-bound. The compiler parses only the normalized proposal body.
- Bounded repair remains unchanged: at most `maxRepairAttempts + 1` provider calls.
- Advisory explanations are generated only for an existing tenant-scoped execution after network-free replay returns `MATCH`.
- Explanation generation can never invoke the reasoning control plane for a new execution, acquire evidence, mutate facts, compile a program, alter a certificate, or change an authorization decision.
- Explanation text is explicitly advisory and is not accepted as AXIOM evidence.
- Identical completed explanation retries replay the exact stored API outcome without another provider call.
- Stored explanation reads are network-free.
- Cross-tenant reads fail even when IDs are known.

## 4. Provider adapter architecture

### 4.1 Shared provider transport contract

Introduce a small bounded provider transport helper used by provider-specific codecs. It accepts only:

- fixed HTTPS origin;
- fixed absolute path;
- fixed timeout;
- fixed maximum response bytes;
- fixed success status set;
- fixed non-secret headers;
- server-side secret header references;
- a prebuilt canonical JSON body;
- an injected fetch implementation for tests.

It performs no redirects and returns the exact bounded JSON response body.

### 4.2 ModelAdapter result

Extend `CapturedModelExchange` with:

- `requestBody`: exact provider request body;
- `responseBody`: exact provider response body;
- `normalizedResponseBody`: canonical AXIOM gateway JSON containing exactly `{"proposal": ...}`.

The existing generic `HttpStructuredModelAdapter` sets `normalizedResponseBody === responseBody` after strict gateway validation.

`ModelExchangeArtifact` gains:

- `normalizedResponseBody`;
- `normalizedResponseBodyHash`.

Artifact identity commits all three bodies and their hashes. Verification remains backward-compatible with Phase-2.4A artifacts that do not have normalized fields; new Phase-2.4B compilation artifacts always contain them.

The compilation service uses `normalizedResponseBody` for proposal parsing and repair state. Exact provider response bytes remain immutable evidence of what the model service actually returned.

### 4.3 OpenAI Responses adapter

Server-owned configuration fixes:

- origin `https://api.openai.com` by default;
- path `/v1/responses`;
- model ID from the adapter manifest;
- Authorization bearer secret reference;
- response limit and timeout.

Request characteristics:

- `store: false`;
- no tools;
- no conversation ID;
- no previous-response ID;
- one user input containing the canonical AXIOM proposal envelope;
- structured JSON schema output for a single `proposal` object.

Response parsing is strict. The adapter accepts exactly one assistant output-text payload containing schema-conforming JSON, parses it, requires exactly one `proposal` field, canonicalizes that gateway payload, and rejects ambiguity or malformed provider shape.

### 4.4 Anthropic Messages adapter

Server-owned configuration fixes:

- origin `https://api.anthropic.com` by default;
- path `/v1/messages`;
- model ID from the adapter manifest;
- `x-api-key` secret reference;
- fixed `anthropic-version` header;
- server-owned `max_tokens`;
- response limit and timeout.

Request characteristics:

- one user message containing the canonical AXIOM proposal envelope;
- `output_config.format = {type:"json_schema", schema: ...}`;
- no tools;
- no container;
- no MCP;
- no memory;
- no external fetch capability.

Response parsing requires exactly one text content block containing a single JSON gateway object with exactly one `proposal` field.

## 5. Advisory explanation architecture

### 5.1 API

Add:

`POST /v1/tenants/:tenantId/executions/:executionId/explanations`

Body:

`{ "profileId": "<server-owned explanation profile>" }`

The route maps to exact action `model:explain` and resource `{kind:"execution", id: executionId}`.

The request is a mutation for idempotency purposes because it can call an external provider and persist a record.

### 5.2 Explanation profiles

A `ModelExplanationProfile` is server-owned and contains:

- `profileId`;
- `version`;
- `adapterId`;
- `maxPromptBytes`;
- `maxResponseBytes`.

A registry resolves profiles by tenant and hashes their canonical identity. Tenant eligibility is explicit; no wildcard provider selection is introduced.

### 5.3 Proof-bound prompt

Before provider access the explanation service:

1. verifies the authorized context is exact `model:explain` for the execution resource;
2. loads the tenant-scoped stored execution;
3. verifies execution-record integrity through the repository;
4. calls `replayStored(executionId)`;
5. requires `MATCH`;
6. constructs a sanitized explanation envelope from immutable stored proof material.

The explanation envelope includes:

- execution ID;
- snapshot ID/hash;
- policy decision status/checks;
- certificate ID;
- certificate issuedAt;
- certificate core;
- signer key ID;
- execution record hash.

It excludes bearer tokens, API credentials, raw authorization grants, provider secrets, and unrelated tenant state.

### 5.4 Explanation output contract

The provider returns schema-conforming JSON:

`{"summary":"...","keyFactors":["..."],"limitations":["..."]}`

Bounds:

- summary <= profile configured bytes;
- keyFactors count and item bytes are bounded by a fixed implementation constant;
- limitations count and item bytes are bounded;
- no arbitrary nested provider output is persisted as trusted data.

The API result includes an immutable explanation ID, the structured advisory content, provider/model identity, profile identity, execution record hash, and an explicit `authority:"ADVISORY_ONLY"`.

### 5.5 Immutable explanation record

Persist `ModelExplanationRecord` with:

- tenant ID;
- execution ID and execution record hash;
- requesting principal ID and authorization decision hash;
- explanation profile ID/version/hash;
- adapter manifest;
- capturedAt;
- exact provider request body/hash;
- exact provider response body/hash;
- normalized explanation body/hash;
- advisory content;
- record hash.

`explanationId = "model-explanation:" + hash(record identity without recordHash)`.

SQLite and PostgreSQL use tenant + explanation ID composite keys. Reads verify redundant hashes and record integrity.

## 6. Authorization, idempotency, and audit

Extend `ApiAction` with `model:explain`.

No existing grant implies `model:explain`. It must be granted independently.

Request ordering stays:

authentication -> exact authorization -> body shape -> tenant context -> idempotency claim -> execution/replay verification -> secret resolution -> provider access -> persistence -> audit -> idempotency completion.

Stable API outcomes:

- 201: `MODEL_EXPLANATION_CREATED`;
- 400: `BAD_REQUEST`;
- 403 profile ineligible: `MODEL_EXPLANATION_PROFILE_FORBIDDEN`;
- 404 execution not found: `NOT_FOUND`;
- 409 idempotency conflict/in-progress: `IDEMPOTENCY_REJECTED`;
- 422 replay mismatch / proof invalid: `MODEL_EXPLANATION_PROOF_REJECTED`;
- 413/415/502/504 provider failure: `MODEL_EXPLANATION_UPSTREAM_FAILED`;
- otherwise: `INTERNAL_ERROR`.

Provider/internal 5xx failures do not complete the idempotency record.

## 7. Persistence and compatibility

- Existing Phase-2.4A compilation tables remain valid.
- New normalized proposal fields live in artifact JSON and are redundantly stored only where needed for verification; old records remain readable.
- Add a separate explanation table in SQLite and PostgreSQL.
- PostgreSQL schema changes are additive.
- Cross-tenant access uses tenant criteria on every read/write.
- Explanation record creation is a single atomic insert after successful provider capture and normalization.

## 8. Testing strategy

TDD work is split into:

1. artifact backward compatibility and normalized-proposal integrity;
2. OpenAI adapter request/response/security behavior;
3. Anthropic adapter request/response/security behavior;
4. explanation profile registry and proof-bound prompt construction;
5. explanation persistence/tamper/tenant isolation;
6. API authorization, idempotency, stable error/audit outcomes;
7. PostgreSQL parity;
8. end-to-end Phase-2.4B gate.

Required adversarial cases include:

- caller attempts to set provider/model/origin/tools;
- secret leakage into body;
- redirects;
- oversized/non-JSON/wrong-media-type provider response;
- ambiguous provider text blocks;
- malformed or extra top-level normalized gateway fields;
- replay mismatch before provider access;
- cross-tenant execution ID;
- stale/ineligible explanation profile;
- changed request under same idempotency key;
- storage tampering;
- provider failure followed by explicit retry;
- exact stored outcome replay without provider refetch.

All existing tests and gates must remain green.

## 9. Acceptance gate

`gate:phase24b` must demonstrate:

1. compile the same bounded AXIOM proposal through mocked OpenAI and Anthropic first-party adapters;
2. exact provider transport bodies and normalized proposal are separately hash-bound;
3. execute a validated compilation through the unchanged control plane;
4. generate an advisory explanation only after stored replay MATCH;
5. prove explanation cannot mutate or substitute the execution/certificate;
6. prove idempotent replay performs no second provider call;
7. prove cross-tenant and replay-mismatch explanation attempts fail before provider access;
8. verify explanation persistence and tamper rejection.

Aggregate `npm run gate` and CI must include Phase-2.4B.

## 10. Non-goals

This increment does not add autonomous trading, brokerage/action execution, arbitrary HTTP/SQL, provider tools, provider-managed memory, user-supplied models/endpoints, explanation as evidence, UI, billing, login/session flows, HSM/KMS deployment, distributed workers, or background autonomous retries.

## 11. Security review exit criteria

No unresolved Critical or Important finding may remain before merge. In particular, review must confirm:

- auth/authz/idempotency precede secret resolution and provider I/O;
- exact request/response capture cannot contain resolved credentials;
- normalized provider output is hash-bound and independently validated;
- explanation requires replay MATCH before provider access;
- model:explain is independent from compile/execute grants;
- explanation persistence is tenant-isolated and tamper-evident;
- prior trust chains remain unchanged.
