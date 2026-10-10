# Phase 2.1 Tenant-Scoped Production Boundaries Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the verified Phase-2 control plane behind tenant-scoped repository contracts, prove the contracts against real PostgreSQL, and add authenticated Ed25519 fact ingestion with replay protection.

**Architecture:** Repository operations become asynchronous and receive an explicit `TenantScope`; the control plane is tenant-scoped and commits the tenant ID into the signed platform context. SQLite remains the local reference implementation while PostgreSQL becomes a CI-proven server adapter. External fact ingestion is a separate authentication boundary that verifies signed envelopes before atomically claiming a nonce and persisting authentication evidence with the fact.

**Tech Stack:** TypeScript on Node 24.12, Phase-1 AXIOM kernel, Node SQLite reference adapter, PostgreSQL + node-postgres for server persistence, Node Ed25519 crypto, GitLab CI.

## Global Constraints

- Start from verified baseline `39c69a39e3b9bcded140ea6c46bb6d398d790b6f`.
- Preserve the state → policy → signed platform context → Phase-1 execution → independently verified signing → persisted replay chain.
- All tenant-owned facts, snapshots, execution records, and ingestion nonces must be tenant-scoped in storage and cryptographically domain-separated where hashed/signed.
- Cross-tenant access must fail even when another tenant's object IDs are known.
- PostgreSQL behavior must be exercised against a real PostgreSQL service in GitLab CI.
- External fact ingestion must verify Ed25519 signatures before persistence and reject duplicate nonces.
- Phase-1 and existing Phase-2 conformance must remain green.

---

### Task 1: Tenant-scoped asynchronous repository contracts

**Files:**
- Create: `reasoning/phase2/src/repositories.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/world_state.ts`
- Modify: `reasoning/phase2/src/execution_store.ts`
- Modify: `reasoning/phase2/src/control_plane.ts`
- Modify: existing Phase-2 tests
- Test: `reasoning/phase2/tests/tenant_isolation.test.ts`

**Interfaces:**
- Consumes: current `TemporalFact`, `WorldSnapshot`, `PlatformExecutionRecord`.
- Produces:
  - `TenantScope { tenantId: string }`
  - `WorldStateRepository.putFact(scope,fact): Promise<void>`
  - `WorldStateRepository.snapshot(scope,asOf): Promise<WorldSnapshot>`
  - `WorldStateRepository.getSnapshot(scope,id): Promise<WorldSnapshot>`
  - `ExecutionRepository.put(scope,record): Promise<void>`
  - `ExecutionRepository.get(scope,id): Promise<PlatformExecutionRecord>`
  - asynchronous `ReasoningControlPlane.execute` and `replayStored`.

- [ ] **Step 1: Add the focused failing test**

Require two tenants to store the same fact ID independently; snapshots must contain `tenantId`; snapshot hashes must differ by tenant; tenant B must not read tenant A's snapshot or execution record by known ID; replaying tenant A's execution through a tenant-B control plane must return `MISMATCH`.

- [ ] **Step 2: Verify the relevant failure**

Run: `npm run conformance`
Expected: new tenant-isolation assertions fail because repositories and signed context are global.

- [ ] **Step 3: Implement the minimum behavior**

Add tenant columns/composite keys to SQLite tables, include tenant ID in snapshot hashing and `PlatformExecutionRecord`, inject `TenantScope` into the control plane, include tenant ID in the signed platform-context hash, and change repository/control-plane calls to async interfaces.

- [ ] **Step 4: Verify the focused pass**

Run: `npm run conformance`
Expected: tenant isolation passes and all migrated Phase-2 tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: `npm run gate`
Expected: Phase-2 gate PASS with tenant-scoped execution/replay.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): enforce tenant-scoped repository contracts`

### Task 2: Real PostgreSQL repository adapters

**Files:**
- Create: `reasoning/phase2/src/postgres.ts`
- Create: `reasoning/phase2/sql/postgres.sql`
- Create: `reasoning/phase2/tests/postgres.integration.ts`
- Modify: `reasoning/phase2/package.json`
- Modify: `.gitlab-ci.yml`

**Interfaces:**
- Consumes: `WorldStateRepository`, `ExecutionRepository`, `TenantScope`.
- Produces: `PostgresWorldStateRepository`, `PostgresExecutionRepository`.

- [ ] **Step 1: Add the focused failing integration test**

Against a GitLab PostgreSQL service, require tenant-isolated fact insertion, deterministic snapshot persistence/reload, execution-record persistence/reload, and cross-tenant read denial.

- [ ] **Step 2: Verify the relevant failure**

Run in CI: PostgreSQL integration job.
Expected: module/adapter missing.

- [ ] **Step 3: Implement the minimum behavior**

Use parameterized node-postgres queries only. Schema uses composite tenant keys and JSONB payloads; snapshot and execution integrity checks remain identical to SQLite semantics. No SQL query may omit tenant criteria for tenant-owned reads.

- [ ] **Step 4: Verify the focused pass**

Run: GitLab PostgreSQL integration job.
Expected: PostgreSQL adapter tests PASS against the live service.

- [ ] **Step 5: Run the affected integration check**

Run all Phase-1/Phase-2 conformance plus PostgreSQL job.
Expected: all green.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): add PostgreSQL repository adapters`

### Task 3: Authenticated Ed25519 fact ingestion with nonce replay protection

**Files:**
- Create: `reasoning/phase2/src/ingestion.ts`
- Modify: `reasoning/phase2/src/repositories.ts`
- Modify: SQLite/PostgreSQL adapters and schemas
- Modify: `reasoning/phase2/src/types.ts`
- Test: `reasoning/phase2/tests/ingestion.test.ts`
- Extend: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Consumes: tenant repository contracts and Node Ed25519 crypto.
- Produces:
  - `SignedFactEnvelope { tenantId, keyId, issuedAt, nonce, fact, signature }`
  - `IngestionKeyring.trustedPublicKeyPem(tenantId,keyId)`
  - `IngestionReceiptRepository.claimNonce(scope,keyId,nonce,issuedAt): Promise<boolean>`
  - `AuthenticatedFactIngestor.ingest(envelope, now): Promise<TemporalFact>`.

- [ ] **Step 1: Add the focused failing tests**

Require valid signed ingress to persist authentication evidence; reject unknown tenant/key, signature mismatch, envelope tenant mismatch, future envelope outside configured skew, stale envelope outside configured age, and second use of the same tenant/key/nonce.

- [ ] **Step 2: Verify the relevant failure**

Run: `npm run conformance`
Expected: ingestion module missing/new tests fail.

- [ ] **Step 3: Implement the minimum behavior**

Canonicalize and sign all envelope fields except `signature`. Verify against tenant/key public key. Freshness windows are constructor configuration, not hard-coded policy. Atomically claim nonce in the persistence adapter before storing the authenticated fact. Persist `authentication { keyId, issuedAt, nonce, envelopeHash, signature }` on the fact so snapshot hashing commits to the evidence.

- [ ] **Step 4: Verify the focused pass**

Run: `npm run conformance`
Expected: all ingestion security cases PASS.

- [ ] **Step 5: Run the affected integration check**

Run PostgreSQL integration and Phase-2 gate.
Expected: nonce uniqueness and auth evidence behave identically in SQLite and PostgreSQL.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): authenticate tenant fact ingestion`

### Task 4: End-to-end signed tenant/authentication evidence gate

**Files:**
- Modify: `reasoning/phase2/scripts/phase2-gate.ts`
- Modify: `reasoning/phase2/ARCHITECTURE.md`
- Modify: `reasoning/phase2/SECURITY.md`
- Modify: `reasoning/phase2/CONFORMANCE.md`
- Modify: `reasoning/phase2/progress.md`

**Interfaces:**
- Consumes: tenant-scoped repositories, PostgreSQL adapters, authenticated ingestion, existing policy/signing/replay chain.
- Produces: updated Phase-2.1 acceptance gate and security contract.

- [ ] **Step 1: Add the end-to-end acceptance assertions**

Create an authenticated tenant fact, execute/replay within that tenant, assert the fact's authentication evidence is transitively committed by the signed snapshot/platform context, and prove known-ID cross-tenant replay/read attempts fail.

- [ ] **Step 2: Verify the relevant failure**

Run: `npm run gate`
Expected: gate fails until all Task 1–3 contracts are composed.

- [ ] **Step 3: Implement the minimum composition and documentation**

Update the gate and docs to state the exact trust properties and remaining boundaries.

- [ ] **Step 4: Verify the focused pass**

Run: `npm run gate`
Expected: Phase-2.1 gate PASS.

- [ ] **Step 5: Run the affected integration check**

Run fresh GitLab branch pipeline: Phase 1, Phase 2, and PostgreSQL integration.
Expected: all jobs SUCCESS.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `docs(phase2): package tenant production-boundary gate`

## Unresolved externally observable decisions

- Network/API authentication and authorization semantics are intentionally outside this increment; no HTTP status/error contract is introduced here.
- PostgreSQL deployment topology, encryption-at-rest, backup retention, and connection-pool sizing remain deployment decisions rather than repository-protocol semantics.
- RBAC roles beyond cryptographic source authentication are deferred to the next control-plane authorization increment.
