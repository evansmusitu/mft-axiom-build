# Phase 2.5C Design — Authenticated Workers and Lease-Scoped Capabilities

Date: 2026-10-09
Issue: #12
Base: `main` at `1d1bbbdcada5faaa2d706f7572c17263464402b4`

## 1. Problem

Phase 2.5A makes distributed execution durable and lease-fenced, but the worker identity participating in that fence is currently only a caller-supplied `workerId` string. The database correctly rejects stale lease epochs, yet it cannot distinguish the legitimate holder of a worker identity from an impersonator that can invoke the repository methods.

This is sufficient for the current in-process worker boundary but not for a production worker fleet. AXIOM needs an application-layer worker identity that remains independent from:

- API caller credentials and tenant grants;
- fact-source and adapter-attestation identities;
- model-provider credentials;
- reasoning-certificate signer keys;
- broker delivery identity;
- database credentials.

The goal of Phase 2.5C is to make worker identity and lease mutation cryptographically explicit without changing Phase-1 reasoning semantics or treating workers as tenant/API authorities.

## 2. Alternatives

### A. Direct database credentials plus workerId

Keep the Phase 2.5A API and rely on network/database ACLs to protect worker access.

**Advantages:** minimal implementation change.

**Rejected because:** a holder of the repository credential can choose another `workerId`, claim work outside its intended worker identity, and attempt lifecycle mutations. Database/network ACLs remain valuable defense-in-depth, but they are too coarse to be the AXIOM worker identity boundary.

### B. Worker proof-of-possession plus server-signed lease capability — selected

Register worker Ed25519 public keys server-side. Every worker operation carries an exact signed request envelope. Successful claims mint a separate server-signed lease capability bound to the worker key, exact job intent, lease epoch, expiry, and currently permitted lifecycle operations. Repository state commits the active capability hash.

**Advantages:** deployment-neutral, deterministic, testable without external infrastructure, cryptographically binds worker identity to the existing lease fence, and allows future HTTP/broker transports to reuse the same semantics.

**Trade-off:** introduces a worker trust store, capability signer, request authentication, and additional persisted lease metadata.

### C. mTLS/SPIFFE identity only

Use service-mesh identity as the worker identity.

**Advantages:** strong infrastructure identity and mature operational tooling.

**Rejected as the primary AXIOM boundary because:** it couples correctness to deployment infrastructure and does not itself bind identity to `tenant + job + intentHash + leaseEpoch`. mTLS/SPIFFE may later authenticate the transport in addition to the application-layer capability.

## 3. Security invariants

1. A raw worker ID is never sufficient to claim or mutate a distributed execution job.
2. Worker keys authenticate worker identity only; they do not authorize tenant API actions, reasoning signing, evidence ingestion, model access, or arbitrary database operations.
3. Worker trust is server-owned. Worker-supplied tenant, pool, action, or key authority is never trusted.
4. Every worker mutation is bound to an authenticated worker key and a canonical request hash.
5. Every post-claim mutation requires the exact current server-signed lease capability.
6. A lease capability is bound to `workerId + workerKeyId + poolId + tenantId + jobId + intentHash + leaseEpoch + leaseExpiresAt + signerKeyId`.
7. Heartbeat rotates the active capability commitment. The previous capability becomes stale even when its embedded expiry has not elapsed.
8. A stale/reclaimed lease epoch invalidates every capability minted for the prior epoch.
9. Revoked or disabled worker keys cannot claim, heartbeat, release, complete, or terminalize jobs.
10. Broker messages, network addresses, process names, hostnames, and database credentials are not worker identity.
11. Phase-1 certificate verification and Phase-2 execution-intent replay remain authoritative for reasoning correctness.
12. Phase 2.5C does not accept an arbitrary remote worker result as trusted reasoning output.

## 4. Worker identity

Introduce a distinct worker trust domain.

```ts
interface WorkerIdentity {
  protocolVersion: "axiom.worker/v1";
  workerId: string;
  keyId: string;
  poolId: string;
  algorithm: "Ed25519";
  publicKeySha256: string;
}

interface WorkerTrustRecord {
  identity: WorkerIdentity;
  publicKeyPem: string;
  status: "ACTIVE" | "REVOKED";
  maxLeaseMs: number;
  allowedActions: WorkerAction[];
  recordHash: string;
}
```

`workerId` is stable logical identity. `keyId` supports rotation. `poolId` is server-owned scheduling policy metadata, not a tenant grant. Phase 2.5C may use an in-memory/static trust store plus deterministic test fixtures; dynamic worker administration is deferred.

The public-key hash is SHA-256 over canonical Ed25519 SPKI DER, matching the style used for other key identities.

## 5. Worker request proof

Every worker operation is signed by the registered worker key.

```ts
interface WorkerRequestProof {
  protocolVersion: "axiom.worker-request/v1";
  workerId: string;
  keyId: string;
  requestId: string;
  action: WorkerAction;
  targetJobId?: string;
  bodyHash: string;
  issuedAt: string;
  signatureBase64: string;
}
```

The signing payload is canonical JSON over every field except `signatureBase64`, domain-separated with `AXIOM_WORKER_REQUEST_V1`.

Verification requires:

- exact protocol and Ed25519 algorithm;
- active server-owned trust record;
- `workerId` and `keyId` exact match;
- canonical Base64 and 64-byte Ed25519 signature;
- exact body hash;
- issued-at bounded by configured worker-request age and future skew;
- action allowed by server-owned worker policy;
- exact route/action/job binding.

`requestId` is an idempotency identity, not merely a nonce. Worker identity/signature and current ACTIVE key status are checked before receipt replay. If an exact receipt already exists, the stored logical outcome may be replayed even when the original request freshness window has elapsed, because no new lease mutation occurs. A revoked key cannot retrieve or mutate through this path.

## 6. Worker operation idempotency

A future remote transport can lose a response after a successful claim or heartbeat. Repeating that operation must not silently claim another job or extend the same lease twice.

Persist a worker operation receipt keyed by `workerId + requestId`:

```ts
interface WorkerOperationReceipt {
  workerId: string;
  workerKeyId: string;
  requestId: string;
  action: WorkerAction;
  requestHash: string;
  outcomeHash: string;
  createdAt: string;
  receiptHash: string;
}
```

Rules:

- the same `workerId + requestId + requestHash` replays the exact logical outcome;
- reuse with a different request hash conflicts;
- receipt creation and the corresponding job-state transition are one repository transaction;
- raw signatures and private material are not persisted;
- receipts are integrity checked on read;
- Phase 2.5C does not garbage-collect worker operation receipts. Retention/compaction is a later operational feature and must not permit a previously consumed requestId to become claimable again.

The repository may store only enough canonical outcome material to deterministically reconstruct the response; it need not persist transport headers.

## 7. Lease capability

A successful claim returns a server-signed capability. This key is a new authority class, independent of the reasoning signer and worker keys.

```ts
interface WorkerLeaseCapabilityCore {
  protocolVersion: "axiom.worker-lease/v1";
  workerId: string;
  workerKeyId: string;
  poolId: string;
  tenantId: string;
  jobId: string;
  intentHash: string;
  leaseEpoch: number;
  leaseExpiresAt: string;
  allowedActions: ("HEARTBEAT"|"RELEASE"|"COMPLETE"|"FAIL_TERMINAL")[];
  signerKeyId: string;
}

interface WorkerLeaseCapability {
  core: WorkerLeaseCapabilityCore;
  capabilityId: string;
  signatureBase64: string;
}
```

`capabilityId` is the SHA-256 identity of the domain-separated canonical capability core. The core includes the active lease-signing `signerKeyId`; the signature attests that exact core. The lease-capability signer has an injected interface and trusted public-key ring. Phase 2.5C requires Ed25519 and deterministic verification; vendor-specific HSM/KMS integration for this key is deferred.

A capability is valid only when:

- its signature verifies under the configured lease-signing key;
- every core field is canonical and complete;
- tenant/job/intentHash match the persisted job;
- workerId/keyId match the authenticated worker request;
- leaseEpoch matches the current job state;
- lease expiry matches the current persisted lease expiry;
- the persisted `leaseCapabilityCoreHash` matches the domain-separated canonical capability core hash, including the exact lease-signing key ID;
- the requested operation is listed in `allowedActions`;
- the worker key remains ACTIVE.

Possession of a capability without the corresponding worker private key is insufficient because every operation also requires a valid worker request proof.

## 8. Persisted distributed state changes

Extend leased state with:

- `leaseWorkerKeyId`
- `leasePoolId`
- `leaseCapabilityCoreHash`

These fields are part of the existing state hash. The persisted value commits only the canonical capability core, not the signature bytes, so signing never has to occur inside a database transaction.

For `PENDING` and terminal states they are absent. On claim they are created. On heartbeat, expiry and capability hash rotate atomically. On retry release or terminal transition they are cleared with the rest of lease ownership metadata.

The immutable execution intent does not acquire worker identity because scheduling workers are execution mechanisms, not part of the user-authorized execution intent.

## 9. Claim eligibility

A worker can claim only when its trust record is ACTIVE and includes `CLAIM`.

Phase 2.5C introduces a server-owned `poolId` on worker trust records. Initial scheduling remains a single logical queue, but the claim path commits the worker pool to lease state so future queue partitioning can be introduced without changing the identity model.

No tenant allowlist is introduced in this increment. If tenant-specific worker placement is later required, it must be server-owned scheduling policy and not a worker claim.

## 10. Repository boundary

Replace raw public mutation methods with authenticated operations. The low-level repository must never accept a bare `workerId` as sufficient authority.

Conceptually:

```ts
claimNext(authenticatedWorker, operation, serverNow, leaseMs)
heartbeat(authenticatedWorker, capability, operation, serverNow, leaseMs)
releaseForRetry(authenticatedWorker, capability, operation, serverNow)
complete(authenticatedWorker, capability, operation, serverNow, result)
failTerminal(authenticatedWorker, capability, operation, serverNow, code)
```

The worker authentication service verifies request proof before repository access. The repository then transactionally verifies the worker/capability fields against persisted state and records the operation receipt.

The repository still uses server time. Worker-supplied timestamps are only freshness evidence for request authentication and never determine lease expiry or transition time.

## 11. Worker runtime

`DistributedModelExecutionWorker.runOnce` receives a `WorkerCredential` or signing callback rather than a raw string ID.

Flow:

```text
worker private key
   ↓ signed CLAIM request
worker authenticator + server-owned trust record
   ↓ authenticated worker context
transactional claim
   ↓ lease state + signed lease capability
worker creates tenant runtime
   ↓ existing validatePrepared / executeBound
signed COMPLETE or FAIL/RELEASE request
   ↓ exact current lease capability
transactional terminal/retry mutation
```

The reasoning execution path remains unchanged. The worker never signs reasoning certificates with its worker key. Existing P2.5A execution-intent recovery remains the protection against duplicate durable execution.

## 12. Failure semantics

- Invalid/unknown/revoked worker proof: `WORKER_UNAUTHENTICATED`.
- Authenticated worker lacks action: `WORKER_FORBIDDEN`.
- Reused requestId with different request hash: `WORKER_REQUEST_CONFLICT`.
- Invalid capability signature/shape: `INVALID_LEASE_CAPABILITY`.
- Capability does not match current persisted state: `LEASE_LOST`.
- Expired current lease: `LEASE_LOST`.
- Legitimate compilation drift: existing `STALE`.
- Persisted job/integrity mismatch: existing `FAILED_INTEGRITY`.
- Unexpected infrastructure failure: existing retry release, but only with a valid current capability.

Internal trust-store and signature diagnostics remain opaque outside the worker-control boundary.

## 13. Rotation and revocation

Worker key rotation is represented by a new `keyId` and trust record. An active lease remains bound to the key that claimed it.

Default Phase 2.5C rule: revocation is immediate. A revoked key cannot mutate even an unexpired lease. That lease must expire and be reclaimed at a higher epoch by an active worker. This favors containment over availability.

Lease-signing key rotation uses a trusted public-key ring so capabilities minted under a still-trusted historical key can verify until their short lease expiry. Administrative rotation APIs are deferred.

## 14. Storage

SQLite and PostgreSQL add:

- worker operation receipt storage;
- new lease identity/capability columns on distributed jobs.

Both implementations must provide the same atomic semantics:

- claim/heartbeat/release/complete/fail transition and operation receipt are one transaction;
- receipt conflict detection occurs before a second state mutation;
- job state hash covers the new lease fields;
- PostgreSQL retains `FOR UPDATE SKIP LOCKED` for claim selection.

No worker private key is stored in these tables.

## 15. Conformance and adversarial tests

Required tests include:

1. raw workerId alone cannot claim;
2. valid Ed25519 worker proof claims successfully;
3. wrong key for known worker fails;
4. unknown/revoked key fails;
5. body/action/job tamper after signing fails;
6. stale worker-request timestamp fails;
7. identical claim requestId replays the same lease rather than claiming a second job;
8. requestId reuse with changed request conflicts;
9. capability verifies only under lease-signing trust ring;
10. capability cannot be used by another worker/key;
11. capability cannot be moved to another tenant/job/intent;
12. old epoch capability fails after lease reclamation;
13. pre-heartbeat capability fails after heartbeat rotation;
14. revoked worker cannot mutate an active lease;
15. expired lease fails even with valid signatures;
16. lost completion response retry cannot create a second durable AXIOM execution;
17. state/receipt/capability-hash tamper fails closed in SQLite;
18. equivalent PostgreSQL adversarial cases pass;
19. every pre-existing Phase-1/Phase-2 conformance test remains green.

A new `gate:phase25c` must exercise end-to-end authentication, claim idempotency, capability fencing, revocation, and network-free execution replay.

## 16. Compatibility and migration

This is an intentional breaking change to internal worker repository interfaces, not to tenant-facing public APIs.

Existing persisted P2.5A jobs have no worker-key/capability fields. Migration rules:

- `PENDING` jobs remain claimable under the new authenticated claim flow;
- legacy `LEASED` rows must not be accepted as authenticated active leases;
- on upgrade, a legacy lease can only become claimable after its existing expiry and then receives a higher epoch plus authenticated capability;
- terminal legacy jobs remain readable and verifiable.

The database migration must not rewrite immutable intent hashes.

## 17. Interaction with Phase 2.5B

This design is intentionally based on current canonical `main` and does not depend on the unmerged Phase 2.5B implementation.

When Phase 2.5B is integrated, Phase 2.5C implementation should reuse its proven prepare/finalize external-signing patterns where useful, but the worker lease-signing authority must remain a separate key class from the reasoning-certificate signer.

No Phase 2.5C implementation branch may be merged ahead of the required exact-head and post-merge verification for Phase 2.5B.

## 18. Deferred work

- remote HTTP/gRPC worker transport;
- mTLS/SPIFFE/service-mesh binding;
- hardware attestation/TEE claims;
- dynamic worker enrollment/admin UI;
- tenant-specific scheduling placement;
- quotas/fair scheduling/billing;
- broker-assisted wakeups and dead-letter policy;
- accepting untrusted remote-compute artifacts;
- worker software supply-chain attestation;
- vendor-specific KMS/HSM for lease-capability signing;
- exactly-once external side effects.

## 19. Non-properties

Phase 2.5C does not guarantee trading profit, investment returns, model correctness, upstream factual truth, company valuation, or commercial success.
