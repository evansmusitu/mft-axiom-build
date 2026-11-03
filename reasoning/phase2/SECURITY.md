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

Phase 2.5A does not guarantee trading profit, investment returns, model correctness, upstream factual truth, or commercial outcomes. It also does not provide remote worker attestation/control, broker-as-authority semantics, external action execution, quotas/fair scheduling, vendor-specific HSM/KMS deployment, or distributed provider-call ambiguity protocols.


### Phase 2.5A security-review hardening

The worker requires a trusted server clock and resamples it before claim and before every lease-mutating transition. It never reuses the claim timestamp after reasoning work. If the lease has expired or been reclaimed, terminalization/retry release fails fencing and the worker reports `LEASE_LOST` without changing job state.

A terminal `DENIED` job has two valid proof shapes: pre-execution policy DENY has no certificate/execution record, while a Phase-1 runtime DENIED after policy ALLOW carries a paired certificate and execution record. Partial or contradictory proof references fail closed.


Existing distributed execution intents are never trusted solely because their database record hashes verify. Recovery runs the exact stored record through network-free policy/context/certificate replay before returning its outcome. A recomputed unkeyed storage hash cannot bypass the signed platform-context and certificate checks.


## Phase 2.5B external signer containment

External signing is Ed25519-only in this increment. AXIOM pins the active public key/key ID and historical public-key keyring. A remote signer response cannot introduce or rotate a trusted public key.

The signing provider prepares the exact Phase-1 certificate payload locally, derives an identity-bound signing intent, sends the canonical payload through a bounded backend, and verifies the returned 64-byte Ed25519 signature locally before certificate finalization. Protocol, key ID, algorithm, signing intent, and payload hash must echo exactly.

The HTTP backend is fixed-origin/fixed-path HTTPS, redirect-denying, JSON-only, request/response bounded, and strict-schema. Credentials are resolved server-side into configured headers and are never placed in the request body, persisted certificate, execution record, or API result. Responses echoing resolved secret material fail closed.

New signed platform context version 2 commits the exact signer identity. The persisted signing-intent ID is recomputed from the actual signed certificate payload during replay. The control plane validates signer identity against the pinned active public key before execution and validates the resulting signing intent against the actual certificate before persistence.

Replay remains signer-network-free. Historical public keys are configuration, not discovered from the remote signer. Unknown keys, key-hash mismatch, signing-intent mismatch, certificate mismatch, or forged provider output fail closed.

Distributed signing inherits Phase-2.5A fencing. A lost signer response is an infrastructure retry, never an APPROVED/DENIED reasoning result. A retry repeats the same Ed25519 key/message/signing-intent request. Lease completion still resamples trusted time and requires the current unexpired worker+epoch.

### Phase 2.5B security-review hardening

Two Important proof-integrity findings were fixed before merge eligibility:

1. **Signer metadata self-consistency before persistence.** A custom or mutable signer provider could previously return a certificate valid under the trusted key while declaring a mismatched signer identity or signing-intent value, allowing a permanently unreplayable execution record to be persisted. Issuance now validates signer protocol/mode/algorithm/key/hash against the pinned active key and recomputes the signing intent from the actual certificate before any record is stored. Built-in signer identities are frozen.
2. **Replay-program integrity at certificate finalization.** The new Phase-1 finalizer originally verified the signed `{core, issuedAt}` payload but did not recheck that `replay.program` still matched the signed `core.programHash`. Finalization now fails if that replay program was mutated after preparation.

The execution record uses the already validated signer identity/key ID rather than rereading mutable provider metadata at persistence time.

No Critical or Important finding remains unresolved in the bounded Phase-2.5B source diff after these fixes. Vendor SDK security, HSM provisioning, operator key rotation, mTLS, DNS/network perimeter policy, and hardware attestation are deployment/future-increment concerns, not properties claimed here.


## Phase 2.5C authenticated worker boundary

**Independent key classes.** Worker Ed25519 proof keys authenticate registered worker identities only. They cannot act as API callers, fact-source attesters, model providers, reasoning certificate signers or lease-capability signers. Worker trust status, pool, action grants and maximum lease duration are server-configured. Unknown, revoked, wrong-key, malformed, stale, future or noncanonical worker proofs fail closed.

**Signed scope and replay.** Each post-claim request signs the exact capability ID plus operation parameters and job target. The server-signed capability binds worker key, pool, tenant, job, intent hash, epoch, lease expiry, allowed mutations and lease-signer key ID. Stale-epoch, expired, rotated, cross-worker and cross-job capabilities cannot mutate a lease. Completed request IDs have durable receipts retained without garbage collection. An exact signed request can replay its persisted outcome without repeating a transition; conflicting request IDs fail.

**Proof against DB hash forgery.** Worker operation receipts carry a separate domain-separated Ed25519 signature over the committed receipt hash. The immutable signed lease response is captured in the receipt and verified against the configured historical lease-signing public key. Mutating a receipt and recomputing unkeyed record hashes does not create signer authority. Job-state integrity and receipt signature checks are independent.

**Startup and migration.** The authenticated SQLite repository creates its receipt schema and disables raw worker mutation on that database. PostgreSQL must be initialized via the async `createAuthenticatedPostgresDistributedExecutionStore` factory before worker transport exposure, which commits secure mode before any claim. Existing pending jobs remain claimable and old leased jobs can only be reclaimed after expiry at a higher epoch. Legacy terminal jobs remain readable. Historical P2.5A tests retain a legacy repository path in databases without secure-worker activation; this path is not production worker authorization.

**Trust assumptions.** Server time and tenant runtime factory are trusted service-side injections; a future HTTP/gRPC adapter MUST NOT forward an untrusted worker timestamp to these repository operations. Worker private keys do not sign reasoning certificates, and independently verified Phase-1 execution replay remains authoritative. Revocation relies on the currently configured ACTIVE/REVOKED trust-store record. Transport authentication, enrollment/rotation administration, vendor HSM/KMS for lease keys, workload attestation, cloud network policy, broker authority, quotas, external side effects and profit guarantees are not provided.

## Phase 2.6 evaluation/security boundary

The compatibility matrix makes version drift observable; it does not replace signer verification, policy evaluation, tenant authentication, immutable facts, capability checks, model-provider credential isolation or network-free replay. All component fingerprints are computed server-side from static source and actual manifests; untrusted callers/model outputs cannot select expected versions. Unknown/extra/missing component fields and changed implementation hashes produce INCOMPATIBLE diagnostics.

Offline evaluation uses the same authoritative Phase-1 runtime, evidence policy and strict model proposal parser. The adversarial corpus includes stale/conflicting/future/missing/superseded provenance, authority injection, constraint denial and repair overflow. Results are sorted and committed with the current compatibility matrix hash; an unexpected outcome records a failing case and fails CI. Resource units are bounded integers with checked arithmetic and are not claims about external provider cost or market results. This test-only evaluator does not access network, credentials or tenant repositories.

Deferred operational capabilities such as vendor KMS provisioning, mTLS worker transport, quotas, billing, external execution and commercial guarantees remain out of scope and must have separate trusted implementations.


## Phase 2.7A quota admission containment

A tenant's authorized dispatch action does not override operator-installed outstanding-job capacity. Quota mode must be initialized before production dispatch; missing tenant policy denies and exact request replay does not consume another slot. SQLite and PostgreSQL enforce admission in one transaction and avoid cross-tenant counts. Operator-controlled SQL and bootstrap credentials remain trusted; policy hashes alone are not adversarial database-admin protection. Not covered: fair scheduling, rate limiting, provider spending caps, broker-side controls, deployment secrets or profit guarantees. See `phase2_7a_security_review.md`.


## Phase 2.7B scheduling trust boundary

The operator activates durable fair tenant selection; no worker/caller/model-supplied field controls tenant ordering. All authenticated claim proof checks, signed capabilities and receipts remain in place. Rotation advances only with the lease within a transaction. PostgreSQL fair claim service is serialized and intentionally sacrifices parallel dequeue throughput. The SQL administrator is trusted. This is not weighted fairness, isolation of resource consumption or performance assurance. See `phase2_7b_security_review.md`.


## Phase 2.8A file evidence boundary

Only operator-configured roots and flat basenames are allowed. Caller-supplied parameters cannot change the file selection. Group/world-writable roots, final-component symlinks, nonregular sources, invalid JSON or UTF-8, oversized sources and changed file metadata fail closed. Native file errors are redacted to prevent disclosure of absolute paths. Tenant eligibility is enforced by the adapter registry; source content never becomes authorization or proof by itself. File roots and parents must be controlled by the operator and not mutable by an adversary; this does not provide a malicious-local-user filesystem sandbox, cross-process openat2 path guarantees, remote object storage, credential enrollment or verified upstream truth. See `phase2_8a_security_review.md`.


## Phase 2.8B SQL view acquisition trust boundary

The adapter cannot execute client-provided SQL. Server-owned schema/view/column bindings are strict and quoted; the authorized tenant identity becomes the only parameter of a mandatory tenant-column predicate. PostgreSQL executes in `BEGIN READ ONLY` with statement and lock timeout, and a bounded select/JSON aggregate limits exposed rows and bytes. Native query/connection/release errors are redacted so pool secrets or SQL diagnostics do not enter API outcomes. This protects against user-supplied SQL injection but not hostile operator-controlled views, privileged SQL functions, SQL database administrator compromise, query-plan resource exhaustion, unsafe source-role grants, or objective source-data falsity. A SELECT-only database role, audited deterministic view, and trusted network/TLS connection are deployment requirements. See `phase2_8b_security_review.md`.


## Phase 2.8C object-store authority and deployment assumptions

The object identity is entirely operator-defined and cannot be influenced by a caller/model/worker or request body: acquisition parameters are exactly empty. The returned object must exactly match both the configured immutable version and SHA-256 raw bytes, with strict JSON/UTF-8 and size enforcement before provenance mapping. The object store is not trusted to authorize a tenant or sign facts. Server-owned mapping and Ed25519 ingress are independently checked.

The injected object-storage reader and its credentials require a **read-only IAM role**, endpoint/network allowlisting, transport TLS and SDK streaming/maxBytes controls in deployment. The adapter checks returned Uint8Array bytes after the reader resolves; a client that ignores abort or preloads unbounded bytes requires separate controls. Hash agreement is not external source truth, data freshness, valuation, or any trading-profit guarantee. Object-store writes, object listing, IAM administration, broker execution and remote worker control are not implemented here.


## Phase 2.8D — MCP tool trust and containment

The operator owns the allowed tool name, fixed HTTPS origin, exact registered manifest, tenant allowlist, permitted argument name, response/time budgets and optional server-side credential reference. Caller/model/worker cannot select MCP tools, methods, discovery, arbitrary URLs, headers, tenants or additional arguments. Dynamic tools/list and resource/prompt access are not exposed. A static side-effect naming denylist rejects obvious mutating operations, **but a tool with a benign name may still have side effects**. Operator verification of actual remote behavior and read-only remote credentials remains mandatory. Therefore this is a read-only **contract**, not a remote side-effect guarantee.

Response authority is checked independently: canonical request-ID echo, JSON-RPC version, single non-error text output, exact schemas, JSON media type and UTF-8, bounded bytes, manual redirect refusal, upstream secret-echo rejection, full-stream deadline/abort. Raw tool output cannot become AXIOM policy, certificate or trusted tenant authorization. Existing mapper/attestor/source provenance are still required.

Deployment must enforce outbound endpoint allowlisting, DNS/network controls, TLS trust, MCP server configuration, remote rate budgets, credential scoping and audit. Origin validation alone does not defend DNS rebinding, internal routing or malicious registered servers. This does not establish model factual truth, broker authority, automated trades, operator key management, production SLA or guaranteed financial returns.


## Phase 2.9A — worker-control ingress security

Do not mount the worker-control listener as a public bearer-token endpoint. Construct it only with a trusted `trustedIngress(req)` implementation that verifies the actual connection or trusted gateway context, ideally mTLS with independently validated client identity and a private listener. A caller-supplied `X-Forwarded-*` header is **never** proof of trusted transport; `()=>true` must be used only for loopback tests, never production. Absence of the predicate prevents constructing the server, and failure denies the request before body processing/repository access.

The only exposed actions are signed claim, heartbeat and retry release. Exact top-level request keys, body cap, media type, server-owned time and route target are enforced before delegation. The database continues to verify active Ed25519 worker identity and grants, independent server-signed lease capabilities, monotonic epochs, replay receipts and operation-specific payload commitments. HTTP errors return only generic codes, not stored job/certificate/key/tenant details. No remote terminal success/denial or arbitrary failure is permitted.

Production TLS termination, private routing/firewalls, proxy request timeouts, rate limiting, security log retention, worker key provisioning/revocation and operational certificate rotation are deployment obligations. The trusted ingress callback is an explicit high-trust seam, not a substitute for an mTLS server. This is not a remote execution-result verifier or a guarantee of platform safety, uptime or trading outcomes.


## Phase 2.9B — verified remote result boundary

Authentication (ACTIVE worker, Ed25519 request signature, exact COMPETE body and target) is **before** reading any tenant job or platform execution record. Independently signed lease capability, worker/key/pool, tenant, job, epoch, expiration, state and intent commitment must match. Terminal retry is allowed only if the already terminal persisted result hash and signed worker operation receipt match; the worker cannot force a fresh terminal mutation on a terminal job.

Server-owned execution lookup must return a hash-verified immutable record for the exact tenant+intent, exact executionRequestHash and frozen snapshot. A certificate must be present. Server constructs the expected outcome from that record rather than allowing worker-chosen status/certificate/policy fields. Only an operator-provided trusted `ReasoningControlPlane.replayStored` result with zero diagnostics and status MATCH is accepted before the underlying store verifies and commits again. The included real control-plane acceptance test issues a Phase-1 certificate and replays it on the frozen world-state snapshot.

**Do not supply a mock/fake replay factory in production.** Inject the actual server-side plane with historical signer trust keyring, pinned registry and trusted world/execution stores. This is a service-level gate only, not a remote terminal endpoint or claim about mTLS deployment. Policy-only denial without certificate, forged results, failed replays and record drift fail closed.


## Phase 2.9C — remote verified terminal HTTP security

The new terminal route is **disabled by default**. An operator must provide both an actual production `VerifiedRemoteCompletionService` and a genuine connection-validated `trustedIngress` function; setting `()=>true` or using untrusted forwarding headers on a public listener is unsafe. Before any terminal mutation, the verifier reauthenticates Ed25519 worker identity, checks server-signed lease capability and epoch, compares the exact stored tenant execution proof, and invokes network-free signed replay of the frozen snapshot and certificate. A signed but fabricated worker success or denial fails closed.

Exact request shape, fixed route job ID, body-byte budget, server-owned clock and generic error codes remain enforced at ingress. A stale/forged result returns the opaque `WORKER_COMPLETION_UNVERIFIED` error rather than leaking certificate or tenant details. Remote `FAIL_TERMINAL` remains unimplemented; server must not allow an untrusted worker to label platform corruption.

Remote worker network TLS/mTLS, client certificate issuance, infrastructure audit trails, credential provisioning, rate limiting, connection timeouts and production signer custody remain operator deployment obligations. This transport is not a permission to trade or a guarantee of profitable outcomes.
