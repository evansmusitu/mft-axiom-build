# Phase 2.5A — Fenced Distributed Model Execution Jobs

Date: 2026-10-08  
Issue: #10  
Baseline: `52e8742c78c556469731dcde264345469144e134`

## 1. Purpose

Phase 2.5A adds the first distributed-execution trust kernel above the verified Phase-2.4B platform. It allows an already-validated model compilation to be submitted as an asynchronous, durable job and executed by any trusted AXIOM worker process without allowing the worker to establish tenant scope, caller authority, model intent, evidence, runtime timing, or program contents.

The primary invariant is:

> Distribution changes where deterministic reasoning runs, not what is authoritative.

The signed Phase-1 certificate, the stored world-state snapshot, the policy decision, and network-free replay remain the proof boundary.

## 2. Scope

Phase 2.5A provides:

1. An exact independent `model:dispatch` authorization action.
2. A `POST /v1/tenants/:tenantId/model/compilations/:compilationId/execution-jobs` submission route.
3. A `GET /v1/tenants/:tenantId/execution-jobs/:jobId` status route protected by `execution:job:read`.
4. Submission-time validation of the immutable model compilation and current server-owned profile/compiler/operation-registry identities.
5. Submission-time freezing of the tenant world-state snapshot for the requested `asOf`.
6. A tamper-evident immutable execution-job intent.
7. SQLite and PostgreSQL job repositories with FIFO claim ordering, monotonic lease epochs, lease expiry, heartbeat, retry release, and fenced terminal completion.
8. A trusted in-process worker service that claims only persisted jobs and cannot replace any authority-bearing field.
9. A stable execution-intent ID, equal to the job ID, bound into the signed platform context.
10. Atomic execution-intent-to-execution mapping so a retry after a worker crash can recover an already-persisted execution instead of creating a second durable execution.
11. Terminal job outcomes for `SUCCEEDED`, `DENIED`, `STALE`, and `FAILED_INTEGRITY`.
12. Phase-2.5A acceptance gate, CI coverage, documentation, and bounded security review.

## 3. Non-goals

This increment does not distribute:

- model compilation or repair provider calls;
- external evidence acquisition;
- advisory explanation provider calls;
- arbitrary action/brokerage execution;
- user-installed code;
- arbitrary remote worker control APIs.

It also does not add Kafka, Redis, SQS, NATS, or another broker as an authority-bearing dependency; exactly-once external side effects; HSM/KMS deployment; authorization administration; quotas/billing; or UI.

A future broker may transport wake-up notifications, but the database job record remains canonical.

## 4. Alternatives considered

### A. Database-backed lease/fence protocol — selected

The existing SQLite/PostgreSQL trust boundary stores the immutable intent and mutable lease state. Workers race only through repository compare-and-set operations. PostgreSQL uses row locking / `SKIP LOCKED`; SQLite uses `BEGIN IMMEDIATE`.

Advantages:
- one canonical persistence authority;
- straightforward tenant scoping and conformance;
- no new message-delivery system can become authoritative;
- crash recovery is inspectable and replayable.

Cost:
- database polling is less throughput-efficient than a mature broker at very high scale.

### B. External queue as source of truth

Kafka/Redis/SQS would provide mature delivery primitives, but queue messages could diverge from database state, require a second trust model, and complicate deterministic crash recovery. Rejected for the first trust kernel.

### C. Elected dispatcher forwarding directly to workers

A leader could assign jobs without durable leasing. This reduces persistence work but makes leader failover and in-flight ambiguity harder to prove. Rejected.

## 5. Authority model

Two new exact API actions are introduced:

- `model:dispatch`: authority to enqueue one execution of the exact model compilation resource after submission-time validation.
- `execution:job:read`: authority to read one exact execution-job resource.

Neither action implies `model:execute`, `execution:create`, `execution:read`, or any model/evidence administration action.

A worker is infrastructure, not an API principal. It does not receive caller bearer tokens or authorization grants. Its only authority-bearing input is a repository-returned, integrity-verified persisted job intent created after successful caller authorization.

The job intent commits the original principal ID and authorization decision hash so worker execution remains attributable to the authorization that created the job.

## 6. Prepared model execution

`ModelExecutionService` is refactored around a reusable preparation boundary.

A prepared model execution contains:

- `compilationId`;
- immutable `compilationRecordHash`;
- `profileId`, `profileVersion`, and `profileHash`;
- exact Phase-1 compiler manifest;
- exact full operation-registry manifest hash;
- exact derived `ExecutionRequest`.

Preparation performs the same checks as current synchronous `model:execute`:

- tenant-scoped compilation load and integrity verification;
- `VALIDATED` status;
- current profile availability and identity match;
- current Phase-1 compiler identity match;
- current operation-registry identity match;
- compiled program hash/objective integrity;
- reserved platform-context namespace exclusion;
- exact input-contract/program/placeholder integrity;
- deterministic requirement/binding derivation.

Synchronous `model:execute` continues to use this preparation and then calls the normal synchronous control plane.

Dispatch validates an exact `model:dispatch` context before invoking preparation. The worker later revalidates the prepared identity against current server-owned runtime identities before first execution. If legitimate profile/compiler/registry drift occurred after enqueue and no execution has already been committed for this job, the job terminates `STALE`; it is never silently upgraded to new semantics.

## 7. Snapshot freezing

The current synchronous control plane snapshots world state at execution time. That is safe for a single attempt, but unsafe as a distributed retry identity because late-arriving facts with historical validity can change a later snapshot for the same `asOf`.

Therefore dispatch:

1. validates the model compilation;
2. derives the exact execution request;
3. calls `world.snapshot(tenant, asOf)`;
4. persists the returned `snapshotId` and `snapshotHash` in the immutable job intent;
5. only then makes the job claimable.

Workers must execute against `world.getSnapshot(tenant, snapshotId)`, never call `snapshot(asOf)` for an existing job.

The bound snapshot must have:
- the same tenant;
- the same `asOf`;
- the same hash as the job intent.

Any mismatch is `FAILED_INTEGRITY`.

## 8. Stable execution intent

The job ID is also the distributed execution-intent ID.

`ReasoningControlPlane` gains a bound execution seam that accepts:
- the exact `ExecutionRequest`;
- the exact stored `snapshotId`;
- the exact `executionIntentId`.

The execution-intent ID is included in the platform-context commitment for distributed jobs and stored in the `PlatformExecutionRecord`. Synchronous executions omit it, preserving existing record semantics.

The execution repository gains an atomic execution-intent mapping:

- `getByIntent(scope, executionIntentId)`;
- `putForIntent(scope, executionIntentId, record)`.

The mapping and execution record commit atomically. A repeated `putForIntent` returns the already committed exact execution when the intent is already bound. A conflicting mapping fails closed.

The bound control-plane path checks `getByIntent` before signing. If a prior worker already committed the execution, the control plane reconstructs the existing `ControlPlaneResult` from that immutable record rather than issuing another durable execution.

This handles the key crash window:

```text
worker executes + persists execution
        ↓
worker crashes before job terminal update
        ↓
lease expires
        ↓
new worker claims same job
        ↓
execution intent lookup finds stored execution
        ↓
job completes from existing execution
```

Exactly-once external side effects are not claimed. The guarantee is one durable AXIOM execution record per distributed execution intent.

## 9. Immutable job intent

The immutable job intent contains:

- `jobId`;
- tenant ID;
- submitting principal ID;
- authorization decision hash;
- API request hash;
- compilation ID and compilation record hash;
- profile/compiler/registry identities;
- exact prepared execution request;
- frozen snapshot ID/hash;
- creation time;
- `intentHash`.

`jobId` is derived deterministically from the canonical immutable intent core. The intent hash is recomputed on every read/claim.

The worker cannot supply or replace any of these fields.

## 10. Mutable job state and fencing

The mutable state contains:

- status;
- `leaseEpoch`;
- `attemptCount`;
- optional lease owner;
- optional lease expiry;
- optional terminal time;
- optional terminal result and result hash;
- optional terminal failure code;
- `stateHash` that commits the immutable intent hash plus the mutable state.

Statuses:

- `PENDING`: claimable.
- `LEASED`: owned by one current worker lease.
- `SUCCEEDED`: approved execution committed.
- `DENIED`: policy denied against the frozen snapshot.
- `STALE`: prepared runtime identity became legitimately stale before execution.
- `FAILED_INTEGRITY`: persisted job/snapshot/compilation integrity failed.

Terminal states never return to `PENDING`.

### Claim

`claimNext(workerId, now, leaseMs)` selects the oldest:
- `PENDING` job, or
- `LEASED` job whose lease expiry is less than or equal to `now`.

Claim increments `leaseEpoch` and `attemptCount`, assigns the worker, and sets a new expiry.

PostgreSQL uses a transaction plus `FOR UPDATE SKIP LOCKED`. SQLite serializes claim selection/update with `BEGIN IMMEDIATE`.

### Heartbeat

A heartbeat succeeds only when tenant/job/worker/leaseEpoch all match the current non-expired lease. It extends expiry from the supplied trusted server time.

### Retry release

Unexpected internal failures are not converted into a permanent false result. The current worker may release its current lease back to `PENDING`. Because the execution intent is stable, the next worker first recovers any already-persisted execution before computing again.

No automatic max-attempt terminal cutoff is introduced in 2.5A. Turning a transient infrastructure failure into an irreversible reasoning result is deferred to an explicit operator policy increment.

### Terminal completion

Completion requires exact match on:
- tenant ID;
- job ID;
- worker ID;
- lease epoch;
- current `LEASED` state;
- unexpired lease.

A stale lease holder receives a deterministic stale-lease error and cannot overwrite a newer lease or terminal state.

## 11. Worker behavior

`DistributedModelExecutionWorker` is constructed with a trusted server clock and `runOnce(workerId)`:

1. claims one job;
2. if none exists, returns `IDLE`;
3. creates the tenant runtime only from the persisted job tenant;
4. checks whether the execution intent already maps to a durable execution;
5. if already committed, validates job/execution snapshot identity and completes the job from the stored execution;
6. otherwise revalidates the prepared model execution against current trusted identities;
7. loads and verifies the exact frozen snapshot;
8. executes through the bound control-plane path;
9. completes the current lease with `SUCCEEDED` or `DENIED`;
10. converts legitimate pre-execution runtime drift to `STALE`;
11. converts persistent integrity failures to `FAILED_INTEGRITY`;
12. releases unexpected internal failures for retry;
13. samples the trusted clock separately for claim and every lease-mutating transition, so elapsed work cannot reuse a stale claim timestamp;
14. returns `LEASE_LOST` without mutating state when its lease expires or is reclaimed before a transition.

The worker never calls model providers or external evidence sources. A signed runtime `DENIED` execution (policy ALLOW followed by Phase-1 decision DENIED) remains a valid terminal proof and retains its certificate/execution references; a pre-execution policy DENY has no such references.

## 12. Public API

### Submit

`POST /v1/tenants/:tenantId/model/compilations/:compilationId/execution-jobs`

Action: `model:dispatch`  
Resource: exact `model_compilation` ID  
Mutation: yes; `Idempotency-Key` required  
Body: exactly the same timing shape as synchronous model execution:

```json
{"asOf":"...","issuedAt":"..."}
```

Success: HTTP 202 with a bounded status object:

```json
{
  "status":"QUEUED",
  "jobId":"execution-job:<hash>",
  "snapshotId":"snapshot:<hash>"
}
```

Submission validates compilation identity before queuing. Stale/rejected/missing compilations map to the existing bounded model-execution error vocabulary where applicable.

Completed identical API retries replay the exact stored 202 outcome without creating another job or snapshot.

### Read

`GET /v1/tenants/:tenantId/execution-jobs/:jobId`

Action: `execution:job:read`  
Resource: exact `execution_job` ID

The response exposes:
- job ID;
- status;
- snapshot ID;
- attempt count;
- created time;
- terminal result for `SUCCEEDED`/`DENIED`;
- sanitized terminal failure code for `STALE`/`FAILED_INTEGRITY`.

It does not expose the stored program, compilation objective, lease owner, lease expiry, authorization internals, or worker control metadata.

Known cross-tenant job IDs return the same not-found behavior as unknown IDs after exact authorization.

## 13. Persistence

### SQLite

New tables:
- distributed execution jobs;
- execution-intent mapping.

All record reads recompute intent/state/result hashes. Claim, heartbeat, release, and terminal transitions are transactionally fenced.

### PostgreSQL

New tables:
- `axiom_distributed_execution_jobs`;
- `axiom_execution_intents`.

Claim uses row locking and `SKIP LOCKED`. Execution record + intent mapping commit in one transaction.

PostgreSQL integration tests must prove:
- two workers cannot acquire the same current lease;
- expired leases can be reclaimed with a higher epoch;
- stale epochs cannot complete;
- terminal state is immutable;
- exact tenant isolation;
- execution-intent mapping survives worker retry.

## 14. Error semantics

Public dispatch errors:
- 400 invalid timing/body;
- 403 dispatch authorization denied;
- 404 compilation not found;
- 409 compilation stale or idempotency conflict/in-progress;
- 422 rejected compilation;
- 500 internal persistence/integrity failure.

Public job-read errors:
- 403 authorization denied;
- 404 job not found for the authorized tenant;
- 500 integrity failure.

Worker errors are not exposed verbatim through the public job resource.

## 15. Security invariants

1. A worker cannot invent tenant scope.
2. A worker cannot broaden caller authorization.
3. A worker cannot replace the compilation or execution request.
4. A worker cannot resnapshot the world for a retry.
5. A worker cannot execute after trusted runtime identity drift unless an execution for that exact intent was already durably committed.
6. A stale lease cannot complete or mutate terminal state.
7. One distributed execution intent maps to at most one durable execution record.
8. Job terminal success is not proof by itself; the signed reasoning certificate and replay chain remain authoritative.
9. No provider/network access occurs during worker execution.
10. Cross-tenant job IDs are not capabilities.

## 16. TDD and acceptance

Implementation is split into independently red/green cycles:

1. bound snapshot execution and atomic execution-intent mapping;
2. SQLite distributed job repository and fencing;
3. PostgreSQL equivalent;
4. model dispatch preparation and worker service;
5. API/authorization/HTTP routes and public job status;
6. Phase-2.5A gate, docs, CI, and final security review.

The Phase-2.5A gate must demonstrate:

- dispatch freezes a snapshot;
- two logical workers contend safely;
- an expired lease is reclaimed with a larger epoch;
- stale lease completion is rejected;
- worker execution uses the exact frozen snapshot;
- a simulated crash after execution persistence is recovered through the same execution-intent mapping;
- no second durable execution is created;
- terminal job status is immutable;
- network-free replay of the resulting execution is `MATCH`;
- cross-tenant job reads fail closed.

## 17. Deferred follow-ons

Potential later increments:
- broker-assisted wake-up while the database remains canonical;
- remote worker authentication/attestation;
- distributed direct-program execution;
- provider-call jobs with explicit external-effect ambiguity protocols;
- operator pause/dead-letter policies;
- quotas/fair scheduling;
- HSM/KMS idempotent signing;
- distributed evaluation workloads.
