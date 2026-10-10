# Phase 2.4A Design — Proof-Carrying Model Compiler and Bounded Repair

**Status:** standing owner approval applies; implementation planning follows written-spec self-review  
**Date:** 2026-10-06  
**Base:** `3958b2c56e69474f0e103b318690dd265e1d1fec`  
**Issue:** #8  
**Parent roadmap:** #4

## 1. Objective

Phase 2.4A lets external models produce useful AXIOM programs without granting a model authority over any trusted runtime boundary.

A model is treated as an untrusted program-structure proposer. AXIOM owns:

- tenant scope;
- authorization;
- typed input contracts;
- evidence requirements and bindings;
- actual runtime values;
- the operation registry;
- compiler identity;
- model profile and provider configuration;
- repair limits;
- persistence;
- signing;
- execution;
- replay.

No model response is executable by itself.

The production chain becomes:

```text
authenticated caller
  -> exact model:compile tenant authorization
  -> idempotency claim
  -> server-owned compiler profile
  -> server-owned model adapter
  -> bounded captured model exchange
  -> strict untrusted proposal parser
  -> deterministic AXIOM program assembly with typed placeholders
  -> Phase-1 compileProgram against server-owned registry
  -> optional bounded repair using deterministic compiler diagnostics
  -> immutable model artifacts + compilation record
  -> later exact model:execute authorization
  -> load and verify immutable validated compilation
  -> reject compiler/registry/profile drift
  -> bind every input from fresh trusted world state
  -> unchanged ReasoningControlPlane
  -> Phase-1 compile/runtime/certificate
  -> stored deterministic replay
```

## 2. Alternatives considered

### 2.1 Direct model JSON -> execution

Rejected.

It is fast to prototype but gives a probabilistic component too much authority. It also creates ambiguity around input values, operation availability, repair, replay, and what exact model output was executed.

### 2.2 Provider-specific compiler inside the reasoning kernel

Rejected for the core.

A first-party provider integration can be added as an adapter later, but the AXIOM trust model must not depend on one provider's request/response schema, model naming, or lifecycle.

### 2.3 Provider-neutral proof-carrying compilation

Selected.

The model proposes only program structure. AXIOM captures the exact exchange, deterministically validates the proposal, persists the validated compilation identity, and later executes only that immutable record against trusted current evidence.

## 3. Non-goals

Phase 2.4A does **not** implement:

- direct execution of arbitrary model JSON;
- model-supplied tenant scope;
- model-supplied trusted evidence or runtime values;
- model-defined operations or executable code;
- arbitrary model tool calls;
- autonomous external side effects;
- brokerage/trading actions;
- dynamic provider installation by network callers;
- fine-tuning or model training;
- natural-language explanation as an authoritative artifact;
- a UI;
- distributed compilation workers;
- model selection based on caller-supplied URL/model/provider credentials.

Natural-language explanation is deferred to Phase 2.4B. Explanation will be advisory and derived from immutable compilations/executions; it will never authorize or alter execution.

## 4. Preserved trust invariants

All Phase-1 through Phase-2.3A invariants remain mandatory.

1. Network input never establishes `TenantScope`.
2. Model output never establishes `TenantScope`.
3. JWT claims never self-authorize.
4. Authentication and exact authorization occur before model profile resolution, secret resolution, provider I/O, model-artifact persistence, or tenant runtime access.
5. Model output never writes world-state facts.
6. Model output never changes evidence policy.
7. Model output never supplies trusted runtime input values.
8. Model output never changes the operation registry.
9. Model output never chooses signer keys or signs reasoning certificates.
10. Every executable input is bound from trusted world state immediately before execution.
11. Phase-1 `compileProgram` and runtime remain authoritative.
12. Existing signed platform-context, signer verification, persisted replay, and certificate integrity remain mandatory.
13. Completed idempotent retries perform no model refetch/re-execution.
14. Cross-tenant known identifiers confer no access.
15. Provider secrets never enter persisted artifacts, compilation records, audit rows, idempotency rows, API responses, world state, platform context, or certificates.
16. Stored reasoning replay never calls a model.

## 5. API actions and resources

Phase 2.4A adds two exact API actions:

```ts
"model:compile"
"model:execute"
```

and a new resource kind:

```ts
{ kind: "model_compilation"; id?: string }
```

Authorization target rules:

- `model:compile` requires `resource={kind:"model_compilation"}` with no ID.
- `model:execute` requires `resource={kind:"model_compilation",id:<compilationId>}`.

An `execution:create` grant does not authorize model compilation or model-compilation execution. A `model:compile` grant does not imply `model:execute`.

## 6. Compile API

```http
POST /v1/tenants/:tenantId/model/compilations
Authorization: Bearer <token>
Idempotency-Key: <opaque>
Content-Type: application/json
```

Request:

```json
{
  "profileId": "axiom-compiler:default-v1",
  "objective": "Approve only when observed risk remains within the configured limit",
  "inputContracts": [
    {
      "inputName": "observed_risk",
      "type": {"kind":"number","unit":"ratio"},
      "entity": "risk:alpha",
      "attribute": "current_vol",
      "requirementId": "current-risk",
      "maxAgeMs": 600000
    },
    {
      "inputName": "max_risk",
      "type": {"kind":"number","unit":"ratio"},
      "entity": "risk:alpha",
      "attribute": "max_vol",
      "requirementId": "risk-limit",
      "maxAgeMs": 600000
    }
  ]
}
```

The caller may choose only a registered `profileId` and provide objective plus typed world-state contracts.

The request does **not** accept:

- program inputs or values;
- operation allowlists;
- repair limits;
- provider/model URLs;
- provider credentials;
- model IDs;
- model prompts/templates;
- tenant IDs inside the body;
- signing configuration.

## 7. Input contracts

```ts
interface ModelInputContract {
  inputName: string;
  type: TypeRef;
  entity: string;
  attribute: string;
  requirementId: string;
  maxAgeMs: number;
}
```

Contracts are immutable compilation authority supplied through the authenticated AXIOM API, not by the model.

Validation requires:

- non-empty unique `inputName`;
- non-empty unique `requirementId`;
- valid Phase-1 `TypeRef`;
- non-empty entity and attribute;
- integer `maxAgeMs >= 0`;
- bounded total contract count;
- canonical ordering by `inputName` in persisted records.

The compilation record derives the future execution requirements/bindings directly from these contracts. The model cannot add, remove, rename, or retype an input.

## 8. Untrusted model proposal

The model may return only:

```ts
interface ModelProgramProposal {
  assumptions: string[];
  nodes: AxiomNode[];
  constraints: ConstraintSpec[];
  decisionNodeId: string;
}
```

The model does not return:

- `irVersion`;
- `objective`;
- `inputs`;
- tenant data;
- evidence requirements;
- bindings;
- platform context;
- signer configuration.

The parser is strict. Forbidden authority-bearing fields such as `inputs`, `tenantId`, `requirements`, `bindings`, or `signer` cause a proposal-schema issue rather than being silently ignored.

The proposal body must be valid JSON and bounded by the selected compiler profile.

## 9. Deterministic program assembly

AXIOM deterministically constructs a complete Phase-1 `AxiomProgram`:

- `irVersion = "0.1"`;
- `objective` comes from the authenticated compile request;
- `assumptions`, `nodes`, `constraints`, and `decisionNodeId` come from the parsed proposal;
- `inputs` are built exclusively from the immutable input contracts.

### 9.1 Placeholder values

Compilation needs syntactically valid typed values even though actual trusted values are intentionally unavailable until execution.

AXIOM creates deterministic placeholders:

- number -> `0`;
- decimal -> canonical zero string compatible with declared scale;
- boolean -> `false`;
- string -> `""`;
- series -> `[]`;
- record -> recursively constructed placeholder fields.

Each placeholder gets compile-only provenance:

```text
source = model-compile-contract:<contractHash>:<inputName>
contentHash = hashJson(placeholderValue)
```

Placeholder values are never treated as world evidence and are never allowed to survive into model-compilation execution.

## 10. Phase-1 compiler identity

Phase 2.4A adds a versioned Phase-1 compiler manifest:

```ts
interface CompilerManifest {
  id: "axiom.phase1-compiler";
  version: string;
  implementationHash: string;
}
```

The implementation hash fingerprints the actual compiler source.

A model compilation commits both:

- the compiler manifest;
- `hashJson(operationRegistry.manifest())`.

A stored compilation is executable only while both identities match the current runtime. Drift requires a new compilation; AXIOM never silently executes a historical model compilation under changed compiler/operation semantics.

Historical reasoning certificates remain governed by the existing replay rules and are not invalidated by this compilation-staleness rule.

## 11. Server-owned compiler profiles

Callers select a stable `profileId`; they do not configure provider behavior.

```ts
interface ModelCompilerProfile {
  profileId: string;
  version: string;
  adapterId: string;
  allowedOperationIds: string[];
  maxRepairAttempts: number;
  maxInputs: number;
  maxNodes: number;
  maxConstraints: number;
  maxAssumptions: number;
  maxObjectiveBytes: number;
  maxModelResponseBytes: number;
}
```

Profile validation requires:

- explicit allowed operations;
- every allowed operation exists in the current registry;
- no duplicate operation IDs;
- bounded positive limits;
- `maxRepairAttempts` between 0 and 2 inclusive.

The profile has no caller- or provider-supplied implementation hash. AXIOM computes `profileHash = hashJson(canonicalProfileFields)` over every profile field above (including sorted `allowedOperationIds`). The resulting profile hash is persisted in every compilation and is the authoritative profile identity used for staleness checks.

## 12. ModelAdapter contract

```ts
interface ModelAdapter {
  readonly manifest: ModelAdapterManifest;
  invoke(input: ModelAdapterInput): Promise<CapturedModelExchange>;
}
```

Manifest:

```ts
interface ModelAdapterManifest {
  adapterId: string;
  version: string;
  implementationHash: string;
  provider: string;
  modelId: string;
}
```

The adapter receives a server-generated request envelope and cannot mutate tenant/profile/compiler state.

The first concrete adapter is `HttpStructuredModelAdapter`, a provider-neutral fixed HTTPS JSON gateway. This permits a production model service or provider gateway without coupling the AXIOM kernel to a vendor-specific API schema.

## 13. HTTP structured model adapter

Each adapter instance is configured server-side with:

- fixed HTTPS origin;
- fixed compile path;
- optional fixed repair path;
- fixed model identifier;
- fixed headers;
- server-side secret-header references;
- timeout;
- maximum response bytes;
- accepted 2xx statuses;
- JSON media type.

Security rules match or exceed Phase-2.3A outbound JSON transport:

- caller cannot choose scheme/host/port/path;
- no redirects;
- no caller Authorization forwarding;
- no cookies;
- no arbitrary caller headers;
- no credentials in URL;
- literal loopback/link-local/metadata/unspecified/multicast origins rejected by ordinary configuration;
- streaming response bound enforced;
- invalid UTF-8/JSON rejected;
- exact resolved secret echo rejected;
- provider secret is header-only and excluded from captured exchange.

The gateway response contract is:

```json
{
  "proposal": {
    "assumptions": [],
    "nodes": [],
    "constraints": [],
    "decisionNodeId": "decision"
  }
}
```

Extra top-level gateway fields are rejected unless versioned into the adapter contract.

## 14. Captured model exchange

Every initial or repair attempt creates an immutable artifact:

```ts
interface ModelExchangeArtifact {
  artifactId: string;
  tenantId: string;
  adapterId: string;
  adapterVersion: string;
  adapterImplementationHash: string;
  provider: string;
  modelId: string;
  profileId: string;
  profileHash: string;
  compilationRequestHash: string;
  attempt: number;
  mode: "INITIAL" | "REPAIR";
  capturedAt: string;
  requestBody: string;
  requestBodyHash: string;
  responseBody: string;
  responseBodyHash: string;
  artifactHash: string;
}
```

`requestBody` is the exact sanitized outbound JSON body. Credentials must never be placed in the body.

The artifact hash commits every integrity-relevant field.

Reads revalidate request hash, response hash, and artifact hash.

## 15. Model request envelope

The initial model request contains only:

- objective;
- canonical input contracts;
- compiler profile constraints;
- allowed operation IDs and their manifest identities;
- AXIOM proposal schema version.

It does not contain current world-state values.

A repair request additionally contains:

- the previous bounded model response;
- deterministic normalized compilation issues;
- the remaining repair budget.

It cannot change objective, input contracts, allowed operations, compiler identity, or profile.

## 16. Strict pre-compilation validation

Before calling Phase-1 `compileProgram`, AXIOM rejects or diagnoses:

- invalid JSON;
- invalid gateway envelope;
- forbidden proposal fields;
- unknown/extra proposal root fields;
- node/constraint/assumption counts beyond profile limits;
- node operations outside the profile allowlist;
- reserved `AXIOM_PLATFORM_CONTEXT_SHA256:` assumptions;
- malformed node/constraint structures;
- model attempts to reference undeclared inputs;
- model attempts to define trusted values.

These become normalized deterministic compilation issues eligible for bounded repair.

## 17. Compiler diagnostics

Normalized issues are canonicalized and sorted by:

1. node ID (empty first);
2. issue code;
3. message.

Compiler issues include Phase-1 `ProgramValidationError.issues` plus model-boundary issues such as:

```text
MODEL_INVALID_JSON
MODEL_GATEWAY_SCHEMA
MODEL_PROPOSAL_SCHEMA
MODEL_FORBIDDEN_FIELD
MODEL_LIMIT_EXCEEDED
MODEL_OPERATION_FORBIDDEN
MODEL_RESERVED_ASSUMPTION
```

The repair loop gives the model these issues as data. The model does not decide whether an issue is resolved; only deterministic re-validation does.

## 18. Bounded repair

The initial proposal is attempt 0.

If parsing or compilation fails and the profile allows repair, AXIOM may perform at most `maxRepairAttempts` additional model calls.

Maximum allowed value in Phase 2.4A is 2, so no compilation can make more than 3 model calls.

For every attempt:

1. capture exact sanitized request/response;
2. parse strict proposal;
3. assemble deterministic full program;
4. enforce profile operation/size rules;
5. run Phase-1 `compileProgram`;
6. stop immediately on successful validation.

If the budget is exhausted, the compilation is terminally `REJECTED`.

No fallback executes the last invalid proposal.

## 19. Compilation record

```ts
interface ModelCompilationRecord {
  compilationId: string;
  tenantId: string;
  principalId: string;
  authorizationDecisionHash: string;
  compilationRequestHash: string;
  profileId: string;
  profileVersion: string;
  profileHash: string;
  adapterManifest: ModelAdapterManifest;
  compilerManifest: CompilerManifest;
  operationRegistryManifestHash: string;
  objective: string;
  inputContracts: ModelInputContract[];
  exchangeArtifactIds: string[];
  exchangeArtifactHashes: string[];
  finalIssues: ModelCompilationIssue[];
  status: "VALIDATED" | "REJECTED";
  compiledProgram?: AxiomProgram;
  compiledProgramHash?: string;
  createdAt: string;
  recordHash: string;
}
```

For `VALIDATED` records:

- `compiledProgram` is the exact deterministic assembled+compiled template;
- `compiledProgramHash = hashJson(compiledProgram)`;
- all program input keys exactly equal the contract input names;
- no reserved platform-context assumption is present.

For `REJECTED`, no executable program/hash is present.

The record hash commits the complete record excluding only `recordHash`.

## 20. Compilation identity

`compilationId` is deterministic from a canonical commitment including:

- tenant ID;
- principal ID;
- compilation request hash;
- profile hash;
- adapter implementation identity;
- compiler implementation identity;
- operation registry manifest hash;
- ordered model exchange artifact hashes;
- final status;
- compiled program hash or final issues hash.

This means a repaired compilation has a different identity from its initial invalid proposal.

## 21. Persistence and atomicity

Phase 2.4A adds tenant-scoped immutable repositories:

```ts
interface ModelCompilationRepository {
  commitCompilation(
    scope: TenantScope,
    artifacts: ModelExchangeArtifact[],
    record: ModelCompilationRecord
  ): Promise<void>;

  getCompilation(scope: TenantScope, compilationId: string): Promise<ModelCompilationRecord>;
  getModelArtifact(scope: TenantScope, artifactId: string): Promise<ModelExchangeArtifact>;
}
```

SQLite transaction:

```text
BEGIN IMMEDIATE
  insert every model artifact
  insert compilation record
COMMIT
```

PostgreSQL uses one database transaction.

All artifacts plus the terminal compilation record commit or none commit.

If an external model call occurred and persistence then fails, the API idempotency claim remains `IN_PROGRESS`; AXIOM does not automatically repeat the model call.

Cross-tenant known artifact/compilation IDs behave as not found inside the authorized tenant.

## 22. Compile idempotency

`model:compile` requires `Idempotency-Key`.

The existing API request hash commits:

- method;
- route template;
- requested tenant;
- profile ID;
- objective;
- canonical input contracts.

It excludes bearer credential, idempotency key, and provider credentials.

Semantics:

- identical completed retry returns exact stored response and performs zero model calls;
- changed request under same key -> 409, zero model calls;
- `IN_PROGRESS` -> 409, zero model calls;
- terminal validated compilation -> 201 and completed idempotency;
- terminal rejected compilation -> 422 and completed idempotency;
- 5xx/502/504 after a provider call or ambiguous persistence state leaves idempotency `IN_PROGRESS`.

## 23. Compile response semantics

### Validated

HTTP 201:

```json
{
  "status": "VALIDATED",
  "compilationId": "model-compilation:...",
  "compiledProgramHash": "...",
  "attemptCount": 2
}
```

No raw model response is returned.

### Rejected after repair budget

HTTP 422:

```json
{
  "status": "REJECTED",
  "compilationId": "model-compilation:...",
  "issues": [
    {"code":"UNKNOWN_OPERATION","nodeId":"n1","message":"Unknown operation: ..."}
  ],
  "attemptCount": 3
}
```

Issues are bounded and deterministic. Raw provider output remains tenant-scoped persisted evidence of the compilation process and is not returned by the public API.

## 24. Execute API

```http
POST /v1/tenants/:tenantId/model/compilations/:compilationId/executions
Authorization: Bearer <token>
Idempotency-Key: <opaque>
Content-Type: application/json
```

Request:

```json
{
  "asOf": "2026-10-06T10:00:00.000Z",
  "issuedAt": "2026-10-06T10:00:01.000Z"
}
```

The caller cannot supply a program, bindings, requirements, input values, or operation registry.

## 25. Model-compilation execution

After authentication, exact `model:execute` authorization, request validation, and idempotency claim:

1. load compilation by authorized tenant + compilation ID;
2. verify compilation record hash;
3. require `status="VALIDATED"`;
4. verify compiled program hash;
5. verify profile identity;
6. compare stored compiler manifest with current compiler manifest;
7. compare stored registry manifest hash with current `registry.manifest()`;
8. require program input names exactly equal the stored input-contract names;
9. derive `EvidenceRequirement[]` and `InputBinding[]` from stored contracts;
10. clone the immutable compiled template;
11. invoke the unchanged `ReasoningControlPlane.execute` with fresh `asOf` and `issuedAt`.

The existing control plane then:

- snapshots trusted world state;
- applies evidence policy;
- replaces every placeholder input with trusted world-state values;
- commits signed platform context;
- compiles again against the current registry;
- runs Phase-1;
- independently verifies the signer;
- persists the execution record/certificate.

The model is not called during execution.

## 26. Placeholder escape prevention

Before invoking the existing control plane, model execution verifies:

- the compiled template contains no undeclared input;
- every declared input has exactly one stored contract/binding;
- every program input is therefore overwritten by trusted world state;
- placeholder provenance source begins with the compile-only namespace;
- no program assumption uses the reserved platform-context prefix.

If any invariant fails, execution is rejected before world-state reasoning.

## 27. Compilation staleness

A validated compilation becomes non-executable if:

- compiler manifest changes;
- operation registry manifest changes;
- persisted profile identity/hash is not the current server profile;
- compilation record/program integrity fails.

The execution endpoint returns 409 `COMPILATION_STALE` for legitimate semantic drift.

It returns 422 or 500 for persisted integrity corruption according to whether the corruption is safely classifiable; internal details remain opaque.

The remedy is a new explicit model compilation, not automatic background repair.

## 28. Execute idempotency

`model:execute` is a mutation and requires an idempotency key.

Identical completed retry returns the exact stored execution response and does not:

- call the model;
- rerun the reasoning control plane;
- issue another certificate.

Conflict/in-progress return 409 without model/reasoning execution.

An unexpected 5xx leaves the claim in progress.

## 29. Audit

The existing tamper-evident audit records all security outcomes.

Stable model outcomes include:

```text
AUTHENTICATION_DENIED
AUTHORIZATION_DENIED
BAD_REQUEST
IDEMPOTENCY_REPLAY
IDEMPOTENCY_REJECTED
MODEL_PROFILE_FORBIDDEN
MODEL_UPSTREAM_FAILED
MODEL_COMPILATION_REJECTED
MODEL_COMPILATION_VALIDATED
MODEL_COMPILATION_STALE
MODEL_EXECUTION_COMPLETED
MODEL_EXECUTION_DENIED
INTERNAL_ERROR
```

Raw model responses, prompts, and provider secrets are not copied into the security audit stream.

## 30. Error semantics

Compile endpoint:

- 201 validated;
- 400 invalid API request/profile selection;
- 401 unauthenticated;
- 403 unauthorized/profile unavailable to tenant;
- 409 idempotency conflict/in-progress;
- 413 provider response exceeds bound;
- 415 provider media type unsupported;
- 422 repair exhausted / proposal cannot be validated;
- 502 provider/network/bad response failure;
- 504 provider timeout;
- 500 opaque internal/persistence failure.

Execution endpoint:

- 200 existing control-plane approved/denied result;
- 400 invalid execution timing body;
- 401 unauthenticated;
- 403 unauthorized;
- 404 authorized tenant compilation not found;
- 409 idempotency conflict/in-progress or legitimate compilation staleness;
- 422 compilation exists but is rejected/non-executable;
- 500 opaque integrity/internal failure.

## 31. Concrete model adapter secrecy

Provider credentials may only be resolved through server-owned secret references after:

- caller authentication;
- exact tenant/action authorization;
- idempotency claim;
- profile resolution;
- compile request validation.

Secrets are applied as outbound headers only.

The captured sanitized request body is scanned to ensure configured secret material is absent before artifact persistence.

The captured provider response is also rejected if it contains exact resolved secret material.

## 32. Concurrency

One compile idempotency key represents one external model workflow.

Different idempotency keys may intentionally invoke the same model profile independently.

The compilation repository does not rely on global deduplication for correctness.

Execution idempotency is independent from compilation idempotency.

## 33. Testing strategy

Implementation is test-first.

### 33.1 Phase-1 compiler identity

- compiler manifest is stable for identical source;
- implementation hash is lowercase SHA-256;
- existing compiler behavior remains unchanged.

### 33.2 Proposal boundary

- forbidden `inputs`, tenant, bindings, requirements, signer fields rejected;
- reserved platform-context assumption rejected;
- only allowed profile operations accepted;
- count/size limits fail closed;
- malformed JSON normalized into deterministic issues;
- proposal cannot add/remove/retype inputs.

### 33.3 Placeholder assembly

- every Phase-1 type receives deterministic valid placeholder value;
- placeholders have compile-only provenance and correct content hash;
- same request/proposal gives same assembled program/hash;
- no placeholder survives model execution.

### 33.4 Repair

- invalid initial proposal is captured;
- compiler issues are deterministic and sorted;
- repair request commits prior response + issues;
- successful repair yields validated record;
- repair budget is hard-bounded;
- exhaustion persists rejected record and never executes;
- objective/contracts/profile/registry identity cannot change between repair attempts.

### 33.5 Model adapter

- fixed HTTPS origin;
- no caller/provider URL injection;
- redirect rejection;
- streaming response bound;
- JSON/media/status validation;
- provider secret applied only from server resolver;
- secrets absent from captured exchange;
- exact secret echo rejected.

### 33.6 Persistence

SQLite and PostgreSQL both prove:

- all exchange artifacts + terminal record commit atomically;
- failed commit exposes no partial compilation;
- artifact request/response/body hash tampering detected;
- compilation record/program tampering detected;
- tenant isolation;
- cross-tenant known IDs hidden.

### 33.7 API security/idempotency

- auth denial -> zero profile/model/secret/network/runtime access;
- authz denial -> zero model access;
- missing idempotency audited after auth/authz;
- completed compile retry -> exact response, zero model calls;
- conflict/in-progress -> zero model calls;
- completed execute retry -> exact response, zero model and zero control-plane calls;
- cross-tenant compile ID denied before foreign repository access.

### 33.8 Execution

- only VALIDATED records execute;
- compiler/profile/registry drift rejects before world/control-plane execution;
- all program inputs are overwritten by fresh trusted world facts;
- evidence policy denial still prevents Phase-1 execution;
- successful execution still uses signed platform context + Phase-1 certificate;
- reasoning replay performs zero model calls.

## 34. Phase-2.4A acceptance gate

The gate uses:

- real ephemeral AXIOM HTTP server;
- real SQLite world/security/execution/model compilation persistence;
- real Ed25519 caller and reasoning keys;
- a concrete `HttpStructuredModelAdapter` with a controlled deterministic HTTP transport;
- actual Phase-1 compiler/runtime;
- controlled trusted world facts.

It must prove:

1. model compile auth/authz before provider access;
2. invalid initial proposal captured and deterministically rejected;
3. bounded repair produces a valid AXIOM template;
4. exact model exchanges are integrity-bound without credentials;
5. compiled template commits compiler/profile/registry identity;
6. compile retry performs zero provider refetch;
7. cross-tenant compile attempt performs zero provider access;
8. model-execute loads immutable compilation;
9. every placeholder is replaced by fresh trusted world state;
10. unchanged policy/control plane/Phase-1 runtime issues the reasoning certificate;
11. model-execute retry performs zero model/control-plane re-execution;
12. reasoning replay performs zero model access;
13. registry/compiler drift blocks model-compilation execution;
14. artifact/compilation tampering is detected;
15. Phase-1, Phase-2.1, Phase-2.2, Phase-2.3A, Phase-2.4A, and PostgreSQL gates all pass.

## 35. Compatibility

Existing direct `execution:create` remains available for trusted callers that already possess a complete AXIOM program.

Phase 2.4A adds a safer model-origin path; it does not reinterpret existing execution records.

Model compilations are versioned by:

- profile identity;
- model adapter identity;
- compiler identity;
- operation registry identity;
- exact captured exchanges;
- compiled program hash.

Compiler/registry changes do not mutate old records.

## 36. Deferred Phase 2.4B

Phase 2.4B may add:

- advisory explanation generated from immutable compilation/execution records;
- provider-specific first-party adapters;
- richer model-routing policies;
- model-quality/cost metrics;
- tenant-admin compiler-profile management;
- compile-time evaluation scoring.

None may alter the rule that model output is untrusted until deterministic AXIOM validation succeeds.

## 37. Acceptance definition

Phase 2.4A is complete only when:

- model output cannot directly execute;
- exact `model:compile` and `model:execute` authorization exists;
- caller/model cannot supply trusted runtime values;
- every executable model compilation is immutable and integrity-checked;
- compiler/profile/registry identities are committed;
- repair is deterministic-data-driven and hard-bounded;
- model exchange artifacts contain no provider credentials;
- compile and execute idempotency prove no duplicate external/model/reasoning work;
- execution binds all inputs from fresh trusted world state and still flows through the unchanged Phase-2 control plane + Phase-1 runtime;
- SQLite/PostgreSQL parity is proven;
- Phase-2.4A gate passes;
- all prior gates remain green;
- final bounded security review has no unresolved Critical or Important finding.
