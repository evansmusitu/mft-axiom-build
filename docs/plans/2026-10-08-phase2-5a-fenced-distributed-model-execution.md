# Phase 2.5A Fenced Distributed Model Execution Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, fenced, retry-safe distributed execution path for already-validated model compilations while preserving exact tenant authorization, frozen world-state replay, and one durable AXIOM execution per distributed execution intent.

**Architecture:** Submission prepares and validates a model execution, freezes the tenant world-state snapshot, and persists an immutable job intent. Internal workers claim jobs through database-backed monotonic lease epochs, revalidate current trusted runtime identities, and execute only against the frozen snapshot through a bound control-plane seam whose stable execution-intent ID is atomically mapped to at most one durable execution record.

**Tech Stack:** TypeScript on Node 24.12+, node:test, SQLite `DatabaseSync`, PostgreSQL 17 via `pg`, GitLab CI.

## Global Constraints

- Preserve every Phase-1 through Phase-2.4B trust invariant.
- Distributed execution is limited to already-`VALIDATED` model compilations.
- Add exact independent `model:dispatch` and `execution:job:read` authorization actions; neither implies existing execute/read grants.
- Freeze the exact tenant world-state snapshot before a job becomes claimable.
- Workers may execute only persisted job intent; they cannot inject tenant, compilation, timing, program, evidence, model provider, or authority.
- Job retries must use the exact persisted snapshot and stable job/execution-intent ID.
- One distributed execution intent may map to at most one durable AXIOM execution record.
- A stale lease holder must never mutate or complete a newer lease or terminal job.
- Model providers, evidence adapters, and explanation providers are never called by the worker path.
- PostgreSQL and SQLite must implement equivalent fencing and integrity semantics.
- No broker, remote worker HTTP API, arbitrary action execution, HSM/KMS deployment, quotas/billing, or UI in this increment.
- Do not claim exactly-once external side effects, guaranteed profit/returns, model truth, valuation, or commercial success.

---

### Task 1: Bound snapshots and stable execution-intent persistence

**Files:**
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/repositories.ts`
- Modify: `reasoning/phase2/src/execution_store.ts`
- Modify: `reasoning/phase2/src/postgres.ts`
- Modify: `reasoning/phase2/src/control_plane.ts`
- Test: `reasoning/phase2/tests/control_plane.test.ts`
- Test: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Consumes: existing `ExecutionRequest`, `WorldStateRepository.getSnapshot`, `PlatformExecutionRecord`, Phase-1 signer/replay.
- Produces:
  - optional `PlatformExecutionRecord.executionIntentId`;
  - `ExecutionRepository.getByIntent(scope,intentId): Promise<PlatformExecutionRecord|undefined>`;
  - `ExecutionRepository.putForIntent(scope,intentId,record): Promise<PlatformExecutionRecord>`;
  - `ReasoningControlPlane.executeBound(request,snapshotId,executionIntentId): Promise<ControlPlaneResult>`.

- [ ] **Step 1: Add focused failing tests**

Add tests proving:
1. `executeBound` uses the exact stored snapshot even when a later fact valid at the same `asOf` is ingested after that snapshot was frozen.
2. The distributed `executionIntentId` is committed into the platform context / stored record.
3. Repeating the same intent returns the already committed execution without creating another execution row.
4. Reusing one intent for a different snapshot/request fails closed.
5. PostgreSQL `putForIntent` has the same exact-idempotent/conflict behavior.

- [ ] **Step 2: Verify the relevant failure**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/control_plane.test.ts`

Expected: new tests fail because `executeBound`, intent lookup, and intent mapping do not exist.

Run PostgreSQL focused integration through the existing suite after adding the Postgres assertion:
`cd reasoning/phase2 && npm run test:postgres`

Expected in CI/PostgreSQL environment: the new intent-mapping assertion fails while existing assertions stay green.

- [ ] **Step 3: Implement the minimum behavior**

- Extend `PlatformExecutionRecord` with optional `executionIntentId`.
- Add execution-intent mapping tables:
  - SQLite `execution_intents(tenant_id,intent_id,execution_id,record_hash)`.
  - PostgreSQL `axiom_execution_intents(tenant_id,intent_id,execution_id,record_hash)`.
- Implement atomic `putForIntent`:
  - validate tenant, record hash, and `record.executionIntentId===intentId`;
  - if exact mapping already exists, load/verify and return it;
  - if intent maps to a different record, fail closed;
  - otherwise commit execution record + mapping atomically.
- Implement `getByIntent` with tenant-scoped integrity checks.
- Refactor control-plane execution into an internal exact-snapshot path.
- Keep `execute(request)` behavior unchanged: it creates a snapshot then invokes the common execution path without an intent.
- Add `executeBound`:
  - validate IDs;
  - return existing intent-mapped execution if present and consistent with request/snapshot identity;
  - load `getSnapshot`, require tenant/asOf/hash integrity;
  - include `executionIntentId` in the platform-context commitment and execution record;
  - persist through `putForIntent`;
  - if another worker wins the race, return the repository's already committed record result.
- Reconstruct `ControlPlaneResult` from stored record without issuing another certificate.

- [ ] **Step 4: Verify the focused pass**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/control_plane.test.ts`

Expected: all control-plane tests pass.

- [ ] **Step 5: Run affected integration checks**

Run:
`cd reasoning/phase2 && npm run conformance`

Expected: all Phase-2 unit/conformance tests pass.

Run in PostgreSQL CI environment:
`cd reasoning/phase2 && npm run test:postgres`

Expected: all PostgreSQL tests pass including execution-intent mapping.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): bind distributed execution intents to frozen snapshots`

---

### Task 2: SQLite fenced distributed-job repository

**Files:**
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/repositories.ts`
- Create: `reasoning/phase2/src/distributed_execution_store.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Create: `reasoning/phase2/tests/distributed_execution_store.test.ts`

**Interfaces:**
- Produces:
  - `DistributedExecutionIntent`;
  - `DistributedExecutionState`;
  - `DistributedExecutionJob`;
  - `DistributedExecutionLease`;
  - `DistributedExecutionRepository.create/get/claimNext/heartbeat/releaseForRetry/complete/failTerminal`.
- Terminal statuses: `SUCCEEDED | DENIED | STALE | FAILED_INTEGRITY`.

- [ ] **Step 1: Add focused failing tests**

Cover:
1. create/get recomputes and verifies intent/state hashes;
2. earliest `PENDING` job is claimed;
3. claim increments epoch and attempt count;
4. non-expired lease cannot be claimed by a second worker;
5. expired lease is reclaimed with a strictly greater epoch;
6. stale worker/epoch heartbeat, release, completion, and terminal failure all reject;
7. heartbeat extends only the current non-expired lease;
8. retry release returns only the current lease to `PENDING`;
9. terminal completion validates result/snapshot shape and is immutable;
10. tenant-scoped get cannot read another tenant's known job ID;
11. persisted intent/state tampering fails closed.

- [ ] **Step 2: Verify the relevant failure**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/distributed_execution_store.test.ts`

Expected: module/interface missing failure proving the repository does not exist.

- [ ] **Step 3: Implement the minimum behavior**

- Use `DatabaseSync` and WAL.
- Persist immutable intent JSON/hash separately from mutable indexed state fields.
- Derive `jobId` from canonical immutable intent core; recompute on reads.
- State hash commits `intentHash` plus every mutable field.
- `claimNext` runs under `BEGIN IMMEDIATE`, selects oldest claimable job ordered by `createdAt,jobId`, and updates epoch/attempt/lease atomically.
- Lease expiry comparison uses trusted supplied `now`; equality is expired/reclaimable.
- Heartbeat, release, completion, and terminal failure require exact worker + epoch + unexpired current lease.
- `complete` accepts only `APPROVED` or `DENIED` control-plane results whose snapshot matches the immutable intent.
- Public repository get returns verified structured clones.

- [ ] **Step 4: Verify the focused pass**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/distributed_execution_store.test.ts`

Expected: all new SQLite fencing tests pass.

- [ ] **Step 5: Run affected integration check**

Run:
`cd reasoning/phase2 && npm run conformance`

Expected: full Phase-2 conformance passes.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): add fenced distributed execution store`

---

### Task 3: PostgreSQL fenced job parity

**Files:**
- Create: `reasoning/phase2/src/distributed_execution_postgres.ts`
- Modify: `reasoning/phase2/sql/postgres.sql`
- Modify: `reasoning/phase2/src/index.ts`
- Modify: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Implements the exact `DistributedExecutionRepository` contract from Task 2.
- Uses `FOR UPDATE SKIP LOCKED` for claim selection.

- [ ] **Step 1: Add focused failing PostgreSQL assertions**

Extend the PostgreSQL integration suite to prove:
1. create/get parity;
2. concurrent logical claimers cannot both own one current lease;
3. expired lease reclaims with higher epoch;
4. stale epoch completion fails;
5. retry release and re-claim work;
6. terminal completion is immutable;
7. cross-tenant lookup fails closed;
8. tampered intent/state hash is rejected.

- [ ] **Step 2: Verify the relevant failure**

Run in PostgreSQL CI environment:
`cd reasoning/phase2 && npm run test:postgres`

Expected: new distributed-job assertions fail because the Postgres repository/table do not exist.

- [ ] **Step 3: Implement the minimum behavior**

- Add `axiom_distributed_execution_jobs` schema and claim indexes.
- Implement creation/read validation equivalent to SQLite.
- Claim inside a transaction using `SELECT ... FOR UPDATE SKIP LOCKED` across pending or expired leased rows, FIFO by creation time/job ID.
- Implement fenced heartbeat/release/terminal transitions with exact row predicates and affected-row count checks.
- Recompute state hash in application code for every transition.
- Never trust caller-provided tenant during global worker claim; tenant comes only from the selected persisted intent.

- [ ] **Step 4: Verify the focused pass**

Run in PostgreSQL CI environment:
`cd reasoning/phase2 && npm run test:postgres`

Expected: PostgreSQL integration suite passes.

- [ ] **Step 5: Run affected integration check**

Run:
`cd reasoning/phase2 && npm run conformance`

Expected: Phase-2 conformance passes.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): add PostgreSQL distributed execution fencing`

---

### Task 4: Model dispatch preparation and trusted worker

**Files:**
- Modify: `reasoning/phase2/src/model_execution_service.ts`
- Create: `reasoning/phase2/src/distributed_model_execution.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Create: `reasoning/phase2/tests/distributed_model_execution.test.ts`

**Interfaces:**
- Produces `PreparedModelExecution`.
- Adds `ModelExecutionService.prepareDispatch(context,compilationId,timing)`.
- Adds `ModelExecutionService.validatePrepared(scope,prepared)`.
- Adds `ModelDispatchService.dispatch(context,compilationId,timing,requestHash,now)`.
- Adds `DistributedModelExecutionWorker` with a required trusted clock and `runOnce(workerId)`.

- [ ] **Step 1: Add focused failing tests**

Cover:
1. dispatch requires exact `model:dispatch` context and rejects `model:execute` context;
2. dispatch validates compilation before snapshot/job persistence;
3. dispatch freezes snapshot and persists immutable prepared identities;
4. worker creates runtime only from persisted tenant and executes exact frozen snapshot;
5. worker never calls model provider/evidence/explanation boundaries;
6. worker completes `SUCCEEDED` and `DENIED` correctly;
7. legitimate profile/compiler/registry drift before first execution becomes terminal `STALE`;
8. persisted snapshot/compilation/job corruption becomes `FAILED_INTEGRITY`;
9. unexpected internal failure releases the current lease for retry;
10. simulated crash after execution persistence but before job completion is recovered by the next lease through the same execution-intent mapping, with one durable execution;
11. stale worker completion after lease reclamation is rejected.

- [ ] **Step 2: Verify the relevant failure**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/distributed_model_execution.test.ts`

Expected: missing dispatch/worker interfaces.

- [ ] **Step 3: Implement the minimum behavior**

- Extract the existing model execution validation/derivation into reusable preparation logic without weakening synchronous `model:execute`.
- `prepareDispatch` requires authorization status ALLOW, exact tenant/principal, action `model:dispatch`, resource kind `model_compilation`, and exact compilation ID.
- `validatePrepared` reloads compilation and compares all stored profile/compiler/registry/program/contract identities; it does not perform authorization because only the persisted job path may call it.
- `ModelDispatchService` freezes the snapshot before repository create and stores the exact prepared request + snapshot identity in the immutable intent.
- `DistributedModelExecutionWorker`:
  - claims one job;
  - uses persisted tenant;
  - attempts existing-intent recovery before new execution;
  - validates prepared identities;
  - calls `executeBound`;
  - terminalizes approved/denied results;
  - maps explicit staleness to `STALE`;
  - maps integrity mismatch to `FAILED_INTEGRITY`;
  - releases unexpected internal errors for retry;
  - samples the trusted clock independently before claim and before every lease transition;
  - returns `LEASE_LOST` without mutation if the lease is expired/reclaimed;
  - accepts both pre-execution policy DENY (no execution proof) and signed runtime DENIED (paired certificate + execution record) as valid terminal denial shapes.

- [ ] **Step 4: Verify the focused pass**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/distributed_model_execution.test.ts`

Expected: all distributed model-execution tests pass.

- [ ] **Step 5: Run affected integration checks**

Run:
`cd reasoning/phase2 && npm run conformance`

Expected: all Phase-2 tests pass.

Run:
`cd reasoning/phase2 && npm run gate:phase24b`

Expected: existing Phase-2.4B gate remains PASS.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): dispatch frozen model executions to fenced workers`

---

### Task 5: Authorization, API, HTTP routes, and bounded job status

**Files:**
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/security_store.ts`
- Modify: `reasoning/phase2/src/security_postgres.ts`
- Modify: `reasoning/phase2/src/authorization.ts`
- Modify: `reasoning/phase2/src/api_service.ts`
- Modify: `reasoning/phase2/src/http_server.ts`
- Modify: `reasoning/phase2/tests/authorization.test.ts`
- Modify: `reasoning/phase2/tests/api_service.test.ts`
- Modify: `reasoning/phase2/tests/http.integration.test.ts`

**Interfaces:**
- New actions: `model:dispatch`, `execution:job:read`.
- New resource kind: `execution_job`.
- Submit route: `POST /v1/tenants/:tenantId/model/compilations/:compilationId/execution-jobs`.
- Read route: `GET /v1/tenants/:tenantId/execution-jobs/:jobId`.

- [ ] **Step 1: Add focused failing tests**

Prove:
1. `model:execute` grant does not authorize `model:dispatch`;
2. `model:dispatch` grant does not authorize synchronous `model:execute`;
3. submit requires idempotency and completed identical retry returns exact stored 202 without another dispatch;
4. same idempotency key with different compilation/timing conflicts;
5. denied auth does not create runtime/snapshot/job;
6. stale/rejected/missing compilation maps to bounded 409/422/404;
7. job read requires exact `execution:job:read`;
8. known cross-tenant job ID is not readable;
9. public job response omits lease owner/expiry, prepared program, authorization internals, and raw failure detail;
10. HTTP routing maps both new routes exactly.

- [ ] **Step 2: Verify the relevant failure**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/authorization.test.ts tests/api_service.test.ts tests/http.integration.test.ts`

Expected: new action/route/runtime tests fail while pre-existing cases remain green.

- [ ] **Step 3: Implement the minimum behavior**

- Extend action validation in SQLite/Postgres security repositories.
- Extend authorization/resource unions.
- Add `model:dispatch` to API mutations.
- Reuse model timing validation for dispatch.
- Add runtime seams:
  - `modelDispatcher.dispatch(...)`;
  - `executionJobs.getPublicStatus(scope,jobId)` or equivalent bounded repository/service method.
- Submit returns HTTP 202.
- Read returns bounded job status only.
- Domain mapping:
  - 400 invalid request;
  - 404 missing compilation/job;
  - 409 stale compilation/idempotency conflict;
  - 422 rejected compilation;
  - 500 internal integrity/persistence.
- Add exact HTTP route patterns before more general model/execution patterns.

- [ ] **Step 4: Verify the focused pass**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/authorization.test.ts tests/api_service.test.ts tests/http.integration.test.ts`

Expected: focused tests pass.

- [ ] **Step 5: Run affected integration checks**

Run:
`cd reasoning/phase2 && npm run conformance`

Expected: all Phase-2 conformance tests pass.

Run:
`cd reasoning/phase2 && npm run gate`

Expected: all existing Phase-2 gates remain PASS.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): expose authorized distributed execution jobs`

---

### Task 6: Phase-2.5A acceptance gate, docs, CI, and security review

**Files:**
- Create: `reasoning/phase2/scripts/phase2-5a-gate.ts`
- Modify: `reasoning/phase2/package.json`
- Modify: `.gitlab-ci.yml`
- Modify: `reasoning/phase2/README.md`
- Modify: `reasoning/phase2/ARCHITECTURE.md`
- Modify: `reasoning/phase2/SECURITY.md`
- Modify: `reasoning/phase2/CONFORMANCE.md`
- Create: `reasoning/phase2/phase2_5a_progress.md`
- Modify if needed: `reasoning/phase2/progress.md`

**Interfaces:**
- New script: `npm run gate:phase25a`.
- Aggregate `npm run gate` includes Phase 2.5A.
- CI explicitly runs Phase-2.5A gate.

- [ ] **Step 1: Add the failing acceptance gate**

The gate must execute a deterministic scenario that proves:
1. dispatch freezes a snapshot;
2. worker A claims;
3. its lease expires and worker B reclaims with higher epoch;
4. worker A cannot complete;
5. worker B executes the frozen snapshot;
6. simulated post-execution/pre-job-completion crash leaves one durable execution mapping;
7. a later worker recovers that exact execution and terminalizes the job;
8. resulting execution replay is `MATCH`;
9. cross-tenant job read fails closed.

- [ ] **Step 2: Verify the gate fails before final wiring**

Run:
`cd reasoning/phase2 && node --disable-warning=ExperimentalWarning scripts/phase2-5a-gate.ts`

Expected: non-zero until all gate dependencies/wiring are present.

- [ ] **Step 3: Wire docs/package/CI and complete progress records**

- Add `gate:phase25a` and append it to aggregate `gate`.
- Add explicit Phase-2.5A gate invocation to `.gitlab-ci.yml`.
- Document:
  - database-canonical job authority;
  - frozen snapshot semantics;
  - lease fencing;
  - stable execution intent and crash recovery;
  - new API actions/routes;
  - non-goals and remaining production boundaries.
- Record all six tasks as complete only after their fresh verification.

- [ ] **Step 4: Run complete local verification**

Run:
`cd reasoning/phase1 && npm run conformance && npm run gate`

Expected: Phase-1 suite and gate PASS.

Run:
`cd reasoning/phase2 && npm run conformance && npm run gate`

Expected: all Phase-2 tests and P2.1/P2.2/P2.3A/P2.4A/P2.4B/P2.5A gates PASS.

PostgreSQL CI:
`cd reasoning/phase2 && npm run test:postgres`

Expected: all PostgreSQL integration tests PASS.

- [ ] **Step 5: Perform bounded security review**

Review the full diff from baseline `52e8742c78c556469731dcde264345469144e134` for at least:
- lease/fencing bypass;
- cross-tenant job access;
- resnapshot-on-retry;
- worker-controlled authority/program fields;
- intent collision or conflicting reuse;
- crash window after execution persistence;
- runtime/profile/registry drift;
- terminal-state overwrite;
- API idempotency/resource binding;
- hidden provider/network calls;
- persisted hash validation gaps.

Any Critical or Important finding must receive a focused RED test and GREEN fix before MR creation.

- [ ] **Step 6: Commit final packaging**

Commit message:
`test(phase2): gate fenced distributed execution`

- [ ] **Step 7: Fresh branch/MR/merge verification**

Before claiming completion:
1. run a fresh exact-head feature pipeline;
2. confirm Phase-1, Phase-2, every gate through P2.5A, and PostgreSQL pass;
3. compare feature branch to current `main` and resolve any intervening delta;
4. create MR with source branch retained and squash disabled;
5. run/verify an MR-native pipeline on exact source head;
6. merge only when mergeable and green;
7. verify the post-merge `main` pipeline on the exact merge commit;
8. update issue #10 and roadmap #4 with exact commits/pipelines/test counts and security-review result.

## Unresolved externally observable decisions

None. The approved Phase-2.5A design fixes the public routes, authorization actions, snapshot timing, job statuses, fencing behavior, retry semantics, and terminal error vocabulary needed by this plan.
