# Phase-2 Architecture

## Core invariants

1. Network input never establishes trusted tenant scope.
2. JWT claims authenticate a caller but never self-authorize tenant/action access.
3. Exact server-side authorization occurs before tenant runtime, repository, secret, network, model, or reasoning access.
4. API callers, fact sources, adapter attestations, model providers, and reasoning signers have distinct authority.
5. Phase-1 remains authoritative for AXIOM-IR compilation, execution, and certificate verification.
6. External evidence reaches trusted world state only through captured artifact → deterministic mapping → adapter attestation → authenticated ingestion.
7. Model output is never trusted evidence and is never directly executable.
8. Every mutation is fail-closed under retry ambiguity.
9. Every tenant-owned record is tenant-scoped and known IDs are not capabilities across tenants.
10. Stored artifacts, snapshots, model compilations, distributed job intents/states, platform executions, and audit chains are tamper-evident.
11. A distributed worker is an execution mechanism, never an authority source.
12. One distributed execution intent maps to at most one durable AXIOM execution record.

## Phase-2.4A model compilation flow

```text
HTTP POST model/compilations
    ↓
Ed25519 JWT authentication
    ↓
exact model:compile authorization
    ↓
idempotency claim
    ↓
server-owned ModelCompilerProfile
    ↓
fixed HTTPS HttpStructuredModelAdapter
    ↓
bounded exact JSON exchange artifact
    ↓
strict proposal parser
    ↓
deterministic typed placeholder assembly
    ↓
Phase-1 compileProgram
    ├─ valid → terminal VALIDATED record
    └─ invalid → deterministic issue set → bounded repair (max 2)
```

The model request contains only objective, immutable typed input contracts, bounded profile data, allowed operation identities, and deterministic repair context. Tenant authority, secrets, trusted runtime values, evidence policy, signing keys, and executable registry configuration are excluded.

The proposal schema excludes authority-bearing fields. Operation IDs must be in the profile allowlist. The reserved `AXIOM_PLATFORM_CONTEXT_SHA256:` namespace is forbidden. Phase-1 compilation is the final validation authority.

## Compilation identity and persistence

`ModelExchangeArtifact` binds:

- tenant and adapter/model implementation identity;
- profile and compilation-request hashes;
- attempt and INITIAL/REPAIR mode;
- capture time;
- exact sanitized request/response bodies and their SHA-256 hashes;
- artifact hash.

`ModelCompilationRecord` binds:

- tenant and compiler principal;
- authorization decision and canonical request hashes;
- profile, adapter, Phase-1 compiler, and full registry identities;
- objective and immutable input contracts;
- ordered exchange artifact IDs/hashes;
- deterministic final issues;
- VALIDATED or REJECTED status;
- exact compiled template/program hash only for VALIDATED;
- terminal record hash.

SQLite and PostgreSQL commit all new exchange artifacts plus the terminal record in one transaction. Reads revalidate redundant body/program/record hashes.

## Immutable execution flow

```text
HTTP POST model/compilations/:id/executions
    ↓
Ed25519 JWT authentication
    ↓
exact model:execute authorization for tenant + compilation ID
    ↓
idempotency claim
    ↓
tenant-scoped immutable compilation read + integrity verification
    ↓
require VALIDATED
    ↓
current profile/compiler/registry identity checks
    ↓
exact contract ↔ program-input/placeholder checks
    ↓
derive requirements + bindings from stored contracts
    ↓
existing ReasoningControlPlane.execute
    ↓
fresh tenant snapshot + evidence policy
    ↓
overwrite every placeholder from trusted world state
    ↓
signed platform context
    ↓
Phase-1 compile/runtime + independent signer verification
    ↓
tenant-scoped execution certificate
```

No model call occurs on this path. The caller cannot supply a program, requirement, binding, operation registry, or input value.

A model compilation can be executed by a different principal than the compiler when that principal independently holds the exact `model:execute` grant. Compiler identity remains committed in the immutable compilation record; it is not an execution authorization rule.

## Staleness versus corruption

Current profile hash/version, Phase-1 compiler manifest, and full operation-registry manifest hash must match the stored compilation. Legitimate semantic drift returns `COMPILATION_STALE` and requires a new explicit compilation.

Record/program/artifact integrity corruption fails closed and remains opaque at the API boundary. Rejected compilations contain no executable program.

## Idempotency ordering

For model mutations, ordering is:

```text
authenticate → authorize → validate request → create trusted context
→ idempotency claim → runtime/model/reasoning operation → audit
→ persist exact non-5xx outcome
```

Therefore:

- denied requests cannot resolve model profiles/secrets or reach providers;
- completed compile retries never refetch;
- completed execute retries never rerun reasoning;
- changed requests conflict;
- unresolved `IN_PROGRESS` claims never auto-reexecute;
- 5xx provider/internal failures leave the claim unfinished.

## Existing trust domains

Phase 2.3A evidence adapters remain READ/COMPUTE only. Fact-source and adapter-attestation signatures remain separate from API-caller and reasoning-certificate keys. Reasoning replay remains snapshot-based and network-free.

## Deferred boundaries

Phase 2.4B may add provider-specific model adapters and advisory explanation. Dynamic JWKS, authorization administration, human sessions, rate limits, TLS termination, external audit notarization, RLS, HSM/KMS, billing, arbitrary SQL/MCP/file connectors, external action execution, distributed workers, and UI remain separate increments.


## Phase 2.4B — provider codecs and advisory explanation

Provider-specific codecs sit outside AXIOM authority. They transform a canonical server-owned model request into a fixed provider request and transform one unambiguous structured provider response into canonical normalized proposal/advisory JSON. Exact transport bytes and normalized bytes are committed independently.

The explanation path starts from a persisted execution rather than a model prompt. The control plane first proves the stored execution by network-free replay. Only a compact proof envelope derived from immutable commitments can cross the provider boundary. The returned explanation is stored separately as `ADVISORY_ONLY`; no edge exists from explanation storage back into evidence, policy, compilation, runtime, certificate issuance, or authorization.


## Phase 2.5A — fenced distributed execution

```text
POST .../model/compilations/:id/execution-jobs
    ↓
authenticate → exact model:dispatch authorization → idempotency
    ↓
validate immutable compilation/profile/compiler/registry
    ↓
derive exact ExecutionRequest
    ↓
freeze tenant WorldSnapshot
    ↓
persist immutable execution-job intent
    ↓
database claim: PENDING/expired LEASED → higher leaseEpoch
    ↓
trusted worker revalidates server-owned identities
    ↓
ReasoningControlPlane.executeBound(exact request, exact snapshot, jobId)
    ↓
atomic execution record + execution-intent mapping
    ↓
fenced terminal job completion
```

The database record, not a broker message, is canonical. PostgreSQL claims use `FOR UPDATE SKIP LOCKED`; SQLite serializes claim transitions with `BEGIN IMMEDIATE`. Lease expiry permits reclamation only by incrementing the epoch. Every heartbeat/release/terminal transition is fenced by tenant + job + worker + epoch and rejects expired/stale holders.

Dispatch freezes the world snapshot before enqueue. A retry never re-snapshots `asOf`, so later-arriving historical facts cannot change the job result. The immutable intent binds the prepared execution request and the exact snapshot hash.

The job ID is the stable execution-intent ID. `executeBound` commits that intent into the signed platform context. Execution repositories atomically map one intent to one execution record. On a retry after a crash, the control plane returns the already committed exact execution when the intent/request/snapshot match; conflicting reuse fails closed.

Workers have no model-provider, evidence-acquisition, explanation-provider, caller-token, or arbitrary network seam. Legitimate profile/compiler/registry drift before first execution terminalizes the job as `STALE`; persisted integrity failure terminalizes as `FAILED_INTEGRITY`; unexpected infrastructure failure releases the current lease for retry.

The public API exposes exact `model:dispatch` and `execution:job:read` actions. Job reads are a bounded projection and do not expose worker/lease metadata or prepared program/authorization internals.

## Remaining distributed boundaries

Phase 2.5A does not make Kafka/Redis/SQS/NATS authoritative, does not expose remote worker control APIs, and does not distribute model/evidence/explanation provider calls or external action execution. Broker-assisted wakeups, worker attestation, quotas/fair scheduling, dead-letter/operator policies, vendor-specific HSM/KMS deployment/provisioning, and distributed evaluation remain separate increments.


### Worker clock and denial proof semantics

Worker claim time is not reused as completion time. Each claim, completion, terminal failure, and retry release samples the trusted worker clock independently. An expired/reclaimed worker returns `LEASE_LOST` and cannot mutate the job.

A `DENIED` terminal job may represent either evidence-policy denial before Phase-1 execution or a signed Phase-1 runtime denial. The former has no execution certificate; the latter preserves paired certificate/execution-record references and remains replayable proof.


## Phase 2.5B — external deterministic signing boundary

```text
ReasoningControlPlane
    ↓
validate server-owned signer identity against pinned active public key
    ↓
commit signer identity into platform-context v2
    ↓
Phase-1 compile/runtime
    ↓
prepareReasoningCertificate(exact program + execution + issuedAt)
    ↓
derive signingIntentId(identity + exact signingPayloadHash)
    ↓
ExternalEd25519SigningBackend
    ↓
fixed HTTPS HSM/KMS gateway request
    ↓
signature-only response with exact echoed key/algorithm/intent/payload hash
    ↓
verify Ed25519 signature under pinned AXIOM public key
    ↓
finalize unchanged Phase-1 certificate
    ↓
verify certificate + signing intent again at control-plane boundary
    ↓
persist v2 execution record
```

The external signer is a cryptographic actuator, not an authority source. It cannot choose tenant, evidence, policy, program, operation registry, issued time, key ID, algorithm, trusted public key, or signing intent. The only trusted signer inputs are server-owned configuration and the deterministic certificate payload produced after authoritative Phase-1 execution.

The external provider contains no private key. The active key and historical replay keyring are public keys only. Provider output is independently verified before certificate finalization and again before execution persistence.

The stable signing intent is domain-separated as `AXIOM_REASONING_CERTIFICATE_SIGNING_INTENT_V1` and commits the exact signer identity plus SHA-256 of the canonical `{core, issuedAt}` certificate payload. New platform context version 2 commits that same signer identity inside the certificate-bound `AXIOM_PLATFORM_CONTEXT_SHA256:` assumption.

Replay never invokes a signing backend. A v2 replay recomputes signer identity/key hash, signing intent, platform context, policy, provenance, certificate signature, and Phase-1 execution. A record without a platform-context version follows the pre-2.5B v1 formula for backward compatibility.

The Phase-1 finalizer rechecks that the embedded replay program hashes to the program hash already committed by the signed certificate core. This prevents a signature-valid certificate from being finalized with an unrelated replay program.
