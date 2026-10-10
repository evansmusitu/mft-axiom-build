# Phase 2.5C Authenticated Workers Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw distributed-worker identifiers with cryptographically authenticated worker identities and server-signed, lease-scoped capabilities while preserving Phase 2.5A execution-intent fencing and deterministic replay.

**Architecture:** A new worker trust domain verifies Ed25519 proof-of-possession requests against server-owned worker records. Successful claims and heartbeats produce a separately signed lease capability whose exact hash is committed in distributed job state; every later mutation requires both current worker authentication and the exact current capability. SQLite and PostgreSQL persist worker-operation receipts atomically with job transitions so lost responses replay the same logical outcome rather than performing a second mutation.

**Tech Stack:** TypeScript on Node.js >=24.12, Node `crypto` Ed25519 primitives, SQLite `node:sqlite`, PostgreSQL via `pg`, Node test runner, existing AXIOM canonical JSON/hash utilities.

## Global Constraints

- Implementation begins only from a freshly verified canonical `main` that includes the completed Phase 2.5B merge and successful post-merge pipeline. Do not stack implementation on the unmerged Phase 2.5B feature branch.
- Preserve all Phase-1 reasoning/certificate semantics and all Phase-2.5A execution-intent semantics.
- A raw `workerId` is never sufficient authority for claim or mutation.
- Worker keys are a separate authority class from API callers, fact sources, adapter attesters, model providers, reasoning signers, and lease-capability signers.
- Worker-supplied tenant, pool, action, lease time, or authorization data never establishes authority.
- Every worker operation uses a canonical Ed25519 proof bound to exact action, body, route/job target, requestId, and issuedAt.
- Every post-claim mutation requires the exact current server-signed lease capability.
- Lease capability identity binds workerId, workerKeyId, poolId, tenantId, jobId, intentHash, leaseEpoch, leaseExpiresAt, allowed actions, and the active lease-signer key ID.
- Heartbeat rotates the active lease-capability commitment.
- Revocation is immediate: a revoked worker cannot mutate an existing lease.
- Worker operation receipts are durable in Phase 2.5C and are not garbage-collected.
- Receipt replay first revalidates current worker identity/key status; exact request replay performs no new job mutation.
- Job transition and worker-operation receipt persistence are one database transaction.
- Server time, never worker time, determines lease expiry and lifecycle transition timestamps.
- Existing PostgreSQL `FOR UPDATE SKIP LOCKED` claim semantics remain.
- Legacy P2.5A `PENDING` jobs remain claimable. Legacy `LEASED` jobs cannot be treated as authenticated active leases and become claimable only after their existing expiry under a higher epoch.
- No arbitrary untrusted remote worker output becomes trusted reasoning output.
- No broker, mTLS/SPIFFE identity, database credential, hostname, or process name becomes AXIOM worker authority.
- Do not claim guaranteed trading profit, investment returns, model truth, valuation, or commercial success.

---

### Task 1: Worker trust records and signed request proof

**Files:**
- Create: `reasoning/phase2/src/worker_authentication.ts`
- Create: `reasoning/phase2/tests/worker_authentication.test.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/index.ts`

**Interfaces:**
- Consumes: `canonicalize`, `hashJson`, `sha256Hex` from Phase-1 canonical utilities and Node Ed25519 verification.
- Produces:
  - `WorkerAction = "CLAIM" | "HEARTBEAT" | "RELEASE" | "COMPLETE" | "FAIL_TERMINAL"`
  - `WorkerIdentity`
  - `WorkerTrustRecord`
  - `WorkerRequestProof`
  - `AuthenticatedWorkerContext`
  - `WorkerTrustStore.get(workerId,keyId)`
  - `WorkerRequestAuthenticator.authenticate(proof, expected)`

- [ ] **Step 1: Add the focused failing test**

Add exact tests proving:

1. a valid Ed25519 proof authenticates to the configured immutable worker identity;
2. the same `workerId` signed by an unregistered key is rejected;
3. an unknown worker/key is rejected;
4. a `REVOKED` trust record is rejected;
5. tampering action, targetJobId, bodyHash, requestId, or issuedAt after signature causes rejection;
6. non-Ed25519 trust keys, non-canonical Base64, malformed timestamps, missing IDs, and invalid public-key hashes fail closed;
7. request proof older than configured max age or beyond configured future skew fails;
8. authentication returns server-owned `poolId`, `allowedActions`, and `maxLeaseMs`, not caller-supplied equivalents.

- [ ] **Step 2: Verify the relevant failure**

Run:

```bash
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/worker_authentication.test.ts
```

Expected: failures because worker authentication types/classes and exports do not yet exist.

- [ ] **Step 3: Implement the minimum behavior**

Implement `worker_authentication.ts` with:

- strict required-string and timestamp validation;
- canonical Ed25519 SPKI public-key normalization and SHA-256 identity;
- immutable/frozen trust records on construction;
- lookup by exact `workerId + keyId`;
- domain-separated signing payload:
  `{domain:"AXIOM_WORKER_REQUEST_V1", protocolVersion, workerId, keyId, requestId, action, targetJobId?, bodyHash, issuedAt}`;
- signature verification under the configured public key;
- freshness verification from a server-supplied verification time;
- exact expected action/job/body binding;
- current `ACTIVE` status and action authorization;
- `AuthenticatedWorkerContext` containing only server-owned identity/policy fields and request identity/hash.

Do not implement database receipts in this task.

- [ ] **Step 4: Verify the focused pass**

Run the focused test command above.

Expected: all worker-authentication tests pass.

- [ ] **Step 5: Run the affected integration check**

Run:

```bash
npm run conformance
```

Expected: all existing Phase-2 tests plus the new worker-authentication tests pass.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add reasoning/phase2/src/worker_authentication.ts reasoning/phase2/src/types.ts reasoning/phase2/src/index.ts reasoning/phase2/tests/worker_authentication.test.ts
git commit -m "feat(phase2): authenticate distributed worker requests"
```

---

### Task 2: Server-signed lease capabilities

**Files:**
- Create: `reasoning/phase2/src/worker_lease_capability.ts`
- Create: `reasoning/phase2/tests/worker_lease_capability.test.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/index.ts`

**Interfaces:**
- Consumes: authenticated worker identity from Task 1 and Ed25519 prepare/finalize/keyring patterns available on the verified post-P2.5B main.
- Produces:
  - `WorkerLeaseCapabilityCore`
  - `WorkerLeaseCapability`
  - `WorkerLeaseCapabilitySigner`
  - `createStaticWorkerLeaseSigner(...)`
  - `prepareWorkerLeaseCapability(core)`
  - `finalizeWorkerLeaseCapability(prepared, publicKey, signature)`
  - `verifyWorkerLeaseCapability(capability, trustedPublicKey)`
  - `workerLeaseCapabilityHash(capability)`

- [ ] **Step 1: Add the focused failing test**

Test exact properties:

1. capability signs/verifies under an Ed25519 lease-signing key;
2. capability core includes exact workerId/keyId/poolId/tenantId/jobId/intentHash/epoch/expiry/allowedActions;
3. mutating any core field invalidates the signature;
4. a reasoning-certificate key or worker key is not implicitly trusted as a lease-signing key;
5. wrong historical key ID fails;
6. non-canonical/short/oversized signatures fail;
7. capabilityId/core hash is deterministic from the domain-separated canonical core and does not depend on signature bytes;
8. finalize rejects a prepared core whose canonical payload was mutated after preparation.

- [ ] **Step 2: Verify the relevant failure**

Run:

```bash
node --disable-warning=ExperimentalWarning --test tests/worker_lease_capability.test.ts
```

Expected: failures because lease-capability primitives do not exist.

- [ ] **Step 3: Implement the minimum behavior**

Use a distinct domain and authority:

`AXIOM_WORKER_LEASE_CAPABILITY_V1`.

The signer interface must expose a lease-signer identity/key ID and trusted public-key lookup, but must not reuse or alias the reasoning-certificate signer authority. If the Phase 2.5B prepare/finalize pattern is reusable, reuse the structural pattern only; keep types, domain separator, keyring, and public API distinct.

`allowedActions` must be canonicalized to the exact fixed order:
`HEARTBEAT, RELEASE, COMPLETE, FAIL_TERMINAL` filtered by policy, with duplicates rejected.

- [ ] **Step 4: Verify the focused pass**

Run the focused capability test.

Expected: all capability tests pass.

- [ ] **Step 5: Run the affected integration check**

Run:

```bash
npm run conformance
```

Expected: complete Phase-2 suite remains green.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add reasoning/phase2/src/worker_lease_capability.ts reasoning/phase2/src/types.ts reasoning/phase2/src/index.ts reasoning/phase2/tests/worker_lease_capability.test.ts
git commit -m "feat(phase2): add signed worker lease capabilities"
```

---

### Task 3: SQLite authenticated lease state and atomic worker receipts

**Files:**
- Modify: `reasoning/phase2/src/repositories.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/distributed_execution_store.ts`
- Create: `reasoning/phase2/tests/distributed_worker_capability.test.ts`
- Modify: `reasoning/phase2/tests/distributed_execution_security.test.ts`

**Interfaces:**
- Consumes: `AuthenticatedWorkerContext`, `WorkerLeaseCapability`, lease signer/verifier.
- Produces authenticated repository methods replacing raw worker-string authority:
  - `claimNext(worker, operation, serverNow, leaseMs)`
  - `heartbeat(worker, capability, operation, serverNow, leaseMs)`
  - `releaseForRetry(worker, capability, operation, serverNow)`
  - `complete(worker, capability, operation, serverNow, result)`
  - `failTerminal(worker, capability, operation, serverNow, code)`
- Extends `DistributedExecutionState` with optional `leaseWorkerKeyId`, `leasePoolId`, and `leaseCapabilityCoreHash`.
- Adds `WorkerOperationReceipt`.

- [ ] **Step 1: Add the focused failing test**

SQLite tests must prove:

1. no repository public mutation accepts a bare workerId as authority;
2. authenticated CLAIM produces lease epoch 1 and capability commitment;
3. `leaseMs` above worker `maxLeaseMs` is rejected rather than silently widened;
4. exact claim `requestId` replay returns the same logical lease/job and does not claim a second queued job;
5. same workerId/requestId with changed request hash conflicts;
6. heartbeat rotates lease expiry and `leaseCapabilityCoreHash`;
7. previous capability fails after heartbeat rotation;
8. capability for another worker/key/job/tenant/intent fails;
9. revoked worker fails mutation even with a still-unexpired capability;
10. expired lease fails;
11. stale epoch fails after reclamation;
12. release clears authenticated lease metadata;
13. terminalization clears authenticated lease metadata and preserves result proof semantics;
14. direct SQL tamper of receipt, leaseWorkerKeyId, leasePoolId, or capability hash is detected by integrity checks;
15. legacy `PENDING` row remains claimable;
16. a legacy `LEASED` row with no authenticated lease fields cannot be mutated and becomes claimable only after expiry at a higher epoch.

- [ ] **Step 2: Verify the relevant failure**

Run:

```bash
node --disable-warning=ExperimentalWarning --test tests/distributed_worker_capability.test.ts tests/distributed_execution_security.test.ts
```

Expected: failures showing the repository still trusts raw worker strings and lacks capability/receipt state.

- [ ] **Step 3: Implement the minimum behavior**

Update SQLite schema with:

- `lease_worker_key_id TEXT`;
- `lease_pool_id TEXT`;
- `lease_capability_hash TEXT`;
- `axiom_worker_operation_receipts` keyed by `(worker_id,request_id)` with workerKeyId, action, requestHash, canonical logical outcome, outcomeHash, createdAt, receiptHash.

For existing SQLite databases, execute additive `ALTER TABLE` migration guarded by column inspection rather than dropping/recreating the jobs table.

Transaction ordering for every mutation:

1. validate tenant/job current state;
2. validate authenticated worker context;
3. look for existing receipt;
4. exact receipt match => return stored logical outcome without state mutation;
5. requestId conflict => fail;
6. verify current capability when action is not CLAIM;
7. perform one state transition using server time;
8. mint/derive the exact new capability core when the resulting state is LEASED;
9. commit state including new capability hash;
10. persist operation receipt in the same transaction.

Persist the domain-separated canonical capability-core hash, including the active lease-signer key ID, as part of the leased state. Do not commit signature bytes in the job transaction. After commit, finalize/sign that already-committed core; exact request replay reconstructs the same logical capability from the durable receipt/core and performs no second state mutation. Verify the finalized capability against persisted core hash before returning it.

Extend state hashing and stored-state validators to include the new lease fields. Keep immutable intent hashing unchanged.

- [ ] **Step 4: Verify the focused pass**

Run the focused SQLite tests.

Expected: all authenticated capability/legacy/tamper tests pass.

- [ ] **Step 5: Run the affected integration check**

Run:

```bash
npm run conformance
npm run gate:phase25a
```

Expected: full Phase-2 conformance green and Phase 2.5A gate still passes after adapting its worker fixture to authenticated operations.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add reasoning/phase2/src/repositories.ts reasoning/phase2/src/types.ts reasoning/phase2/src/distributed_execution_store.ts reasoning/phase2/tests/distributed_worker_capability.test.ts reasoning/phase2/tests/distributed_execution_security.test.ts
git commit -m "feat(phase2): fence SQLite jobs with worker capabilities"
```

---

### Task 4: PostgreSQL parity and transactional replay receipts

**Files:**
- Modify: `reasoning/phase2/sql/postgres.sql`
- Modify: `reasoning/phase2/src/distributed_execution_postgres.ts`
- Modify: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Consumes: the authenticated repository interface and receipt/capability types from Task 3.
- Produces: PostgreSQL behavior exactly matching SQLite semantics.

- [ ] **Step 1: Add the focused failing test**

Extend PostgreSQL integration coverage to prove:

1. authenticated concurrent claim still yields one owner under `FOR UPDATE SKIP LOCKED`;
2. exact claim request replay returns the original claimed job;
3. requestId conflict fails before another job transition;
4. heartbeat capability rotation invalidates the previous capability;
5. stale epoch and cross-worker capability use fail;
6. revoked worker cannot complete;
7. receipt + state transition survive as one transaction;
8. deliberate SQL tamper of new lease fields, capability-core hash, or receipt hashes fails verification;
9. legacy leased row behavior matches SQLite migration semantics.

- [ ] **Step 2: Verify the relevant failure**

With the existing test PostgreSQL environment:

```bash
npm run test:postgres
```

Expected: the new cases fail because schema/repository parity is not implemented.

- [ ] **Step 3: Implement the minimum behavior**

Update `postgres.sql` additively and idempotently:

- add lease worker key/pool/capability-hash columns;
- add worker-operation receipt table with primary/unique constraints required for request replay protection;
- add indexes only where they support receipt lookup or existing claim order.

Update `PostgresDistributedExecutionRepository` to perform receipt lookup/conflict handling and state transition under one SQL transaction and row locks. Preserve `FOR UPDATE SKIP LOCKED` for selecting new work.

Do not broaden worker SQL privileges as part of this task; database role hardening is deployment policy and remains separate.

- [ ] **Step 4: Verify the focused pass**

Run:

```bash
npm run test:postgres
```

Expected: all PostgreSQL integration tests pass.

- [ ] **Step 5: Run the affected integration check**

Run:

```bash
npm run conformance
npm run test:postgres
```

Expected: both SQLite/unit conformance and PostgreSQL parity are green.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add reasoning/phase2/sql/postgres.sql reasoning/phase2/src/distributed_execution_postgres.ts reasoning/phase2/tests/postgres.integration.ts
git commit -m "feat(phase2): add PostgreSQL worker capability parity"
```

---

### Task 5: Integrate authenticated worker runtime and recovery semantics

**Files:**
- Modify: `reasoning/phase2/src/distributed_model_execution.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/tests/distributed_execution_security.test.ts`
- Create: `reasoning/phase2/tests/distributed_worker_runtime_auth.test.ts`

**Interfaces:**
- Consumes: a worker credential/signing callback, `WorkerRequestAuthenticator`, authenticated distributed repository, and lease capability signer.
- Produces: `DistributedModelExecutionWorker.runOnce(...)` that performs signed/authenticated lifecycle operations without accepting a bare identity string as authority.

- [ ] **Step 1: Add the focused failing test**

Test the whole worker lifecycle:

1. worker creates signed CLAIM and receives one authenticated lease;
2. existing `validatePrepared` and `executeBound` run only after successful worker authentication/claim;
3. success completion uses the exact current capability;
4. policy DENIED and signed runtime DENIED still preserve the existing proof rules;
5. stale compilation uses authenticated `FAIL_TERMINAL(STALE)`;
6. integrity failure uses authenticated `FAIL_TERMINAL(FAILED_INTEGRITY)`;
7. unexpected failure uses authenticated RELEASE;
8. lease expiry before mutation returns `LEASE_LOST`;
9. revocation between execution and completion returns `LEASE_LOST`/worker-auth failure and leaves durable execution recoverable by the next worker;
10. lost completion response followed by a higher-epoch retry recovers the one existing execution intent and does not create a second durable AXIOM execution;
11. old worker capability cannot terminalize after another worker reclaims the lease.

- [ ] **Step 2: Verify the relevant failure**

Run:

```bash
node --disable-warning=ExperimentalWarning --test tests/distributed_worker_runtime_auth.test.ts tests/distributed_execution_security.test.ts
```

Expected: failures because the current worker still uses a raw worker string.

- [ ] **Step 3: Implement the minimum behavior**

Change worker construction to receive:

- immutable worker identity/credential signer;
- worker request authenticator context or a local in-process client abstraction that exercises the same signed request contract;
- lease capability signer/verifier through the repository/control boundary.

`runOnce` must generate a new `requestId` per logical lifecycle operation and retain that same requestId when retrying the same lost-response operation. It must never reuse CLAIM requestId for heartbeat/release/completion.

Keep the execution path:
`validatePrepared -> executeBound`
unchanged except for authenticated lease lifecycle calls around it.

If completion fails because authentication/capability is stale after execution has already persisted, do not attempt a second execution. A later worker must recover through existing `getByIntent/executeBound` network-free proof verification.

- [ ] **Step 4: Verify the focused pass**

Run the focused worker-runtime tests.

Expected: all worker authentication, expiry, revocation, recovery, and one-durable-execution cases pass.

- [ ] **Step 5: Run the affected integration check**

Run:

```bash
npm run conformance
npm run gate:phase25a
npm run test:postgres
```

Expected: complete suite remains green.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add reasoning/phase2/src/distributed_model_execution.ts reasoning/phase2/src/types.ts reasoning/phase2/tests/distributed_execution_security.test.ts reasoning/phase2/tests/distributed_worker_runtime_auth.test.ts
git commit -m "feat(phase2): authenticate distributed worker lifecycle"
```

---

### Task 6: Phase 2.5C acceptance gate, security review, and documentation

**Files:**
- Create: `reasoning/phase2/scripts/phase2-5c-gate.ts`
- Modify: `reasoning/phase2/package.json`
- Modify: `.gitlab-ci.yml`
- Modify: `reasoning/phase2/README.md`
- Modify: `reasoning/phase2/ARCHITECTURE.md`
- Modify: `reasoning/phase2/SECURITY.md`
- Modify: `reasoning/phase2/CONFORMANCE.md`
- Modify: `reasoning/phase2/progress.md`
- Create: `reasoning/phase2/phase2_5c_progress.md`

**Interfaces:**
- Consumes: complete Phase 2.5C behavior from Tasks 1–5.
- Produces: `npm run gate:phase25c` and CI evidence required for merge readiness.

- [ ] **Step 1: Add the focused failing acceptance gate**

The gate must fail until it can demonstrate all of:

- raw worker IDs are insufficient;
- correct worker proof succeeds;
- wrong/revoked worker keys fail;
- claim request replay does not claim another job;
- requestId conflict fails;
- lease capability is server-signed and bound to exact worker/job/intent/epoch;
- heartbeat rotates capability;
- stale capability/epoch fails;
- lost-response/recovery retains one durable execution;
- SQLite tamper detection passes;
- PostgreSQL parity is covered by CI integration tests.

- [ ] **Step 2: Verify the relevant failure**

Run:

```bash
node --disable-warning=ExperimentalWarning scripts/phase2-5c-gate.ts
```

Expected: failure until the final gate assertions and package script are wired.

- [ ] **Step 3: Implement the minimum gate/docs integration**

Add `gate:phase25c` to `package.json` and aggregate `gate`. Add it explicitly to the Phase-2 GitLab conformance job after P2.5B.

Document:

- worker authority separation;
- request proof and server-owned policy;
- capability binding/rotation;
- receipt replay semantics;
- revocation behavior;
- legacy lease migration behavior;
- remote transport/mTLS/SPIFFE and untrusted remote compute as deferred;
- no guaranteed trading/profit/model/commercial properties.

Perform a bounded source-level security review specifically for:
- confused-deputy paths between API callers and workers;
- capability substitution;
- requestId replay/race conditions;
- key rotation/revocation gaps;
- state/receipt hash omissions;
- SQLite/PostgreSQL semantic divergence;
- lost response after persisted execution.

Any Critical/Important finding must receive a regression test first, then a fix, then fresh full verification.

- [ ] **Step 4: Verify the focused pass**

Run:

```bash
npm run gate:phase25c
```

Expected: `P2.5C PASS`.

- [ ] **Step 5: Run the complete acceptance matrix**

Run:

```bash
cd reasoning/phase1 && npm run conformance && npm run gate
cd ../phase2 && npm ci --ignore-scripts --no-audit --no-fund
npm run conformance
npm run gate:phase21
npm run gate:phase22
npm run gate:phase23a
npm run gate:phase24a
npm run gate:phase24b
npm run gate:phase25a
npm run gate:phase25b
npm run gate:phase25c
npm run test:postgres
```

Expected: every test passes, every gate through P2.5C reports PASS, and PostgreSQL integration is green.

Then require a fresh exact-head GitLab pipeline on the implementation branch. A quota/capacity failure before runner start is neither a pass nor a product test failure and cannot be used as merge evidence.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add .gitlab-ci.yml reasoning/phase2/package.json reasoning/phase2/scripts/phase2-5c-gate.ts reasoning/phase2/README.md reasoning/phase2/ARCHITECTURE.md reasoning/phase2/SECURITY.md reasoning/phase2/CONFORMANCE.md reasoning/phase2/progress.md reasoning/phase2/phase2_5c_progress.md
git commit -m "docs(phase2): package Phase-2.5C worker trust boundary"
```

After that commit, run the complete acceptance matrix and another fresh exact-head pipeline because documentation/CI changes alter the head SHA.

## Merge readiness

Do not open or merge the Phase 2.5C MR until all of these are true:

1. Phase 2.5B is merged and post-merge verified on canonical `main`.
2. The Phase 2.5C implementation branch is rebased/created from that verified main.
3. No unresolved Critical or Important security-review findings remain.
4. Fresh exact-head Phase-1, Phase-2, every gate through P2.5C, and PostgreSQL checks pass.
5. MR-native pipeline passes at the exact source SHA.
6. Merge is non-squash and retains the source branch.
7. A fresh post-merge `main` pipeline passes before completion is claimed.

## Unresolved externally observable product decisions

None. The specification fixes the authority model, revocation behavior, receipt retention for this increment, lease capability semantics, migration behavior, and deferred transport scope.
