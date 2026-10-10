# Phase-2 Security Model

## Authority separation

Phase 2 separates five authority classes:

1. **API caller keys** authenticate identity only.
2. **Fact-source keys** authenticate tenant-bound source envelopes.
3. **Adapter-attestation keys** authenticate AXIOM-generated fact envelopes derived from captured evidence.
4. **Model providers** have proposal authority only. They cannot establish tenant scope, trusted values, policy, registry, signing authority, or executable state.
5. **Reasoning signer keys** authenticate Phase-1 reasoning certificates.

Possession or compromise of one authority does not grant another.

## Authentication and authorization

Compact Ed25519 JWTs are restricted to EdDSA/at+jwt with configured issuer/key trust, audience, NumericDate, age/lifetime, and skew checks. `principalId` is collision-safe across issuers. JWT tenant/role/scope claims are ignored for authorization.

Exact durable server-side grants authorize principal + tenant + action. `model:compile`, `model:execute`, `model:dispatch`, `execution:job:read`, and `model:explain` are independent actions. Authentication/authorization denial occurs before tenant runtime construction, model profile resolution, secret resolution, provider access, repositories, or reasoning execution.

## Model-provider containment

`HttpStructuredModelAdapter` is configured only by the server:

- HTTPS origin and compile/repair paths are fixed;
- unsafe loopback/link-local/metadata-style destinations are rejected;
- redirects are rejected;
- caller-controlled Authorization/Host/transport headers are not accepted;
- secrets are resolved server-side into headers only;
- request/response bodies are bounded JSON;
- disallowed status/media/malformed gateway schema fails closed;
- exact resolved secret material in request or response capture is rejected.

Persisted model artifacts contain exact sanitized request/response bodies and hashes but never provider credentials.

## Proposal containment

Model responses must contain exactly one `proposal` root. The strict parser rejects unknown/authority-bearing fields, forbidden operations, undeclared inputs, malformed types, reserved platform-context assumptions, and profile-limit overflow.

Deterministic placeholders are compile-only typed values. They are not trusted observations and cannot survive execution. Phase-1 `compileProgram` validates the assembled template before it can become VALIDATED.

Repair is bounded by the server-owned profile to at most two repair attempts. Repair carries the exact prior bounded response, deterministic sorted issues, unchanged objective/contracts/allowed operation identities, and remaining budget. It cannot expand authority.

## Immutable compilation integrity

A terminal compilation is immutable and tenant-scoped. VALIDATED records contain the exact compiled template and program hash. REJECTED records contain no executable program. Compilation identity commits all security-relevant implementation/profile/exchange commitments.

SQLite/PostgreSQL reads verify exact request/response hashes, artifact hash, compiled-program hash, and terminal record hash. Atomic transactions prevent partially persisted artifact/record sets.

## Execution containment

The execute API accepts only `asOf` and `issuedAt`; callers cannot submit program, input values, requirements, bindings, policy, or registry.

Before reasoning, `ModelExecutionService`:

- verifies exact authorized tenant + compilation resource;
- revalidates record/program integrity;
- requires VALIDATED;
- compares current profile, compiler, and registry identities;
- requires program input names/types to match stored contracts exactly;
- requires compile-only placeholder provenance;
- rejects reserved platform context;
- derives requirements/bindings only from stored contracts.

The unchanged control plane then selects fresh world-state evidence and overwrites every input before Phase-1 execution. Signed certificates commit the real world-state values/provenance and platform context.

## Idempotency and retry ambiguity

Idempotency binds principal + tenant + action + SHA-256(idempotency key) to a canonical request hash that includes the route template, exact resource identity, and body. Raw keys and bearer tokens are not persisted.

Completed non-5xx model compile/execute outcomes replay byte-for-byte. Completed compile retries never refetch the provider; completed execute retries never rerun reasoning. Changed requests conflict. `IN_PROGRESS` never auto-reexecutes.

Provider/network/internal 5xx responses do not complete the claim. This intentionally chooses operator recovery over a potentially duplicated model call or reasoning side effect after an ambiguous failure.

## API status boundary

- `401`: caller authentication failure
- `403`: exact tenant/action/profile authorization failure
- `404`: authorized tenant-scoped resource absent
- `409`: idempotency conflict/in-progress or `COMPILATION_STALE`
- `413`: bounded caller/model/evidence response exceeded
- `415`: unsupported caller/upstream media type
- `422`: rejected signed evidence or terminal rejected model compilation
- `502`: configured external/model upstream failure
- `504`: configured external/model upstream timeout
- `200` with `status: DENIED`: deterministic evidence-policy denial
- `500`: opaque unexpected/internal integrity failure

Internal provider, SQL, trust-store, integrity, and signer diagnostics are not returned in opaque failures.

## Existing evidence/security invariants

Tenant IDs domain-separate snapshots and signed platform context. Known object IDs do not cross tenant boundaries. Authenticated ingestion uses tenant/key-bound Ed25519 signatures, freshness windows, canonical payload checks, and durable nonce replay prevention. Artifact/acquisition/nonce/fact commits remain atomic. Missing/stale/future/conflicting evidence denies reasoning. Reasoning signer output is independently verified before persistence. Audit streams remain tenant-separated tamper-evident hash chains.

## Fail-closed conditions

Credential failure, authorization denial, tenant mismatch, source-signature/freshness/nonce failure, unsafe external/model destination, provider redirect/status/media/size failure, secret echo, invalid proposal, exhausted repair, artifact/record corruption, rejected or stale compilation, placeholder escape, registry/compiler/profile drift, idempotency ambiguity, evidence-policy denial, invalid signer output, audit mismatch, reserved-context injection, and cross-tenant access all fail closed before the next trust boundary.

## Non-properties

Phase 2.4A does not guarantee trading profit, investment returns, model correctness, upstream factual truth, or commercial outcomes. It does not provide brokerage/action execution, arbitrary outbound HTTP/SQL/MCP, user-installed code, autonomous background repair, provider-specific first-party model adapters, explanation authority, rate limits, human sessions, authorization admin, TLS termination, encryption-at-rest policy, RLS, HSM/KMS, external notarization, billing, distributed consensus, or UI.


## Phase 2.4B provider and explanation containment

First-party OpenAI Responses and Anthropic Messages codecs reuse the bounded HTTPS transport but keep provider-specific request/response parsing small and explicit. Provider origin/path/model/API-version/output-schema are server-owned. Redirects, disallowed media/status, oversized responses, malformed/ambiguous text blocks, secret echo, and caller-controlled provider capabilities fail closed.

Provider-native response bytes are preserved exactly. First-party adapters also require the provider-returned model identity to match the server-owned manifest. A separately canonicalized normalized proposal is independently hash-bound and is the only material passed into the existing strict proposal parser. This prevents provider envelope structure from becoming execution authority.

`model:explain` requires an exact grant on the execution resource. Explanation ordering is authentication → exact authorization → body validation → tenant context → idempotency claim → tenant-scoped execution load → network-free replay `MATCH` → sanitized proof construction → credential resolution/provider I/O → immutable explanation persistence → audit → idempotency completion.

Explanation is a non-authoritative derived artifact. The provider never receives certificate signatures/public keys, caller bearer material, grant sets, or unrelated tenant state. Explanation records are tenant-scoped and redundantly bind exact provider request/response, normalized advisory JSON, execution record hash, profile/adapter identity, principal/authorization decision, and record identity. Tampering fails closed.

Completed explanation retries do not refetch. Provider/internal 5xx outcomes leave the idempotency claim in progress, preserving the existing ambiguity-safe retry policy.


## Phase 2.5A distributed-worker containment

A distributed worker is not an API principal and receives no bearer token or grant set. Its only authority-bearing input is an integrity-verified persisted job created after exact `model:dispatch` authorization.

Dispatch freezes the exact world snapshot before making the job claimable. The immutable intent commits tenant, submitting principal, authorization decision, canonical API request, compilation/profile/compiler/registry identities, exact execution request, and snapshot identity. Retry never re-snapshots.

Lease state is separately hash-bound. Claims increment a monotonic epoch; expired leases may be reclaimed only under a higher epoch. Heartbeat, retry release, success/denial completion, and STALE/FAILED_INTEGRITY terminalization require exact tenant/job/worker/epoch and a current unexpired lease. Stale holders cannot mutate newer or terminal state.

The job ID is also the execution-intent ID committed into the signed platform context. Execution record plus intent mapping are atomic. A retry after execution persistence recovers the exact existing execution when request/snapshot/intent match; conflicting reuse fails closed. This prevents two durable AXIOM execution records for one distributed intent, but makes no exactly-once claim for external side effects.

Worker runtimes expose only prepared-model revalidation, execution-intent lookup, and bound reasoning execution. Model provider, evidence acquisition, explanation provider, arbitrary outbound network, and external action capabilities are absent from the worker contract.

Public `execution:job:read` responses are projections: they omit lease owner/expiry, prepared program, profile/compiler details, submitting principal, authorization decision, and internal integrity hashes. Known job IDs do not bypass tenant authorization.

Phase 2.5A does not guarantee trading profit, investment returns, model correctness, upstream factual truth, or commercial outcomes. It also does not provide remote worker attestation/control, broker-as-authority semantics, external action execution, quotas/fair scheduling, HSM/KMS deployment, or distributed provider-call ambiguity protocols.


### Phase 2.5A security-review hardening

The worker requires a trusted server clock and resamples it before claim and before every lease-mutating transition. It never reuses the claim timestamp after reasoning work. If the lease has expired or been reclaimed, terminalization/retry release fails fencing and the worker reports `LEASE_LOST` without changing job state.

A terminal `DENIED` job has two valid proof shapes: pre-execution policy DENY has no certificate/execution record, while a Phase-1 runtime DENIED after policy ALLOW carries a paired certificate and execution record. Partial or contradictory proof references fail closed.


Existing distributed execution intents are never trusted solely because their database record hashes verify. Recovery runs the exact stored record through network-free policy/context/certificate replay before returning its outcome. A recomputed unkeyed storage hash cannot bypass the signed platform-context and certificate checks.
