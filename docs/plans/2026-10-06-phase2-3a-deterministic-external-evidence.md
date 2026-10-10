# Phase 2.3A Deterministic External Evidence Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-grade, read/compute-only external evidence acquisition boundary that captures external responses immutably, maps them deterministically into adapter-attested facts, and commits those facts through the existing Phase-2 ingestion/world-state trust chain without network refetch on replay.

**Architecture:** Extend the authenticated API with exact `evidence:acquire` authorization and idempotency, introduce server-owned adapter/operation/mapping registries, persist immutable evidence artifacts plus acquisition records, and refactor authenticated fact verification so adapter-generated envelopes reuse the same Ed25519 verification semantics before an atomic artifact + nonce + multi-fact commit. HTTP JSON and MUSITU Axiom compute-only adapters implement the same bounded acquisition contract; reasoning replay remains snapshot-only and network-free.

**Tech Stack:** TypeScript on Node.js 24.12, Node `http`/`fetch`/`crypto`/`sqlite`, PostgreSQL 17 via `pg`, existing AXIOM Phase-1 canonicalization and certificate runtime, GitLab CI.

## Global Constraints

- Network input never establishes trusted `TenantScope`.
- JWT tenant/role/scope claims have no authorization authority.
- Authentication and exact `{principal, tenant, action=evidence:acquire}` authorization occur before adapter lookup, secret resolution, network I/O, artifact persistence, or tenant-domain access.
- External acquisition is read/compute-only. Callers cannot supply arbitrary URL/origin, headers, credentials, DSN, SQL, MCP endpoint/tool registry, or mapping code.
- Adapter output cannot write facts directly.
- Adapter-produced facts enter world state only after the same Ed25519 signed-envelope verification used by existing authenticated ingestion.
- Adapter-attestation identity is separate in authority from API caller identity, independent external source identity, and reasoning-certificate signing identity.
- Completed idempotent retries return exact stored response bytes and perform zero refetch; conflict and `IN_PROGRESS` also perform zero refetch.
- Secrets never enter API request hashes, evidence artifacts, facts, audit records, API responses, platform context, or reasoning certificates.
- Artifact bytes, artifact metadata, mapping implementation identity, mapped fact content, ingestion authentication, snapshot identity, signed platform context, and Phase-1 certificate form a verifiable transitive integrity chain.
- Artifact + all mapped facts + adapter ingestion nonce claims + acquisition terminal record commit atomically in both SQLite and PostgreSQL.
- Reasoning replay never refetches external systems.
- Existing manually signed facts remain valid; acquisition provenance is optional on `TemporalFact`.
- Successful committed acquisition returns HTTP 201.
- Phase-1, Phase-2.1, and Phase-2.2 behavior and gates must remain unchanged and green.
- No unresolved Critical or Important security finding may remain before merge.

---

### Task 1: Extend public types, authorization, audit action validation, and HTTP routing

**Files:**
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/authorization.ts`
- Modify: `reasoning/phase2/src/security_store.ts`
- Modify: `reasoning/phase2/src/security_postgres.ts`
- Modify: `reasoning/phase2/src/http_server.ts`
- Test: `reasoning/phase2/tests/authorization.test.ts`
- Test: `reasoning/phase2/tests/http.integration.test.ts`
- Test: `reasoning/phase2/tests/security_persistence.test.ts`

**Interfaces:**
- Extends `ApiAction` with `"evidence:acquire"`.
- Extends `ApiResource` with `{kind:"evidence"; id?:string}`.
- Adds `POST /v1/tenants/:tenantId/evidence/acquisitions` -> `evidence:acquire`.
- Adds acquisition/artifact/mapping types required by later tasks but no executable adapter implementation yet.

- [ ] **Step 1: Add focused failing tests**
  - Authorization ALLOW only with exact durable `evidence:acquire` grant.
  - A fact/execution grant cannot authorize evidence acquisition.
  - Invalid evidence target/resource shape returns deterministic DENY before repository access.
  - HTTP transport maps the new route to `evidence:acquire`, `resource.kind="evidence"`, forwards `Idempotency-Key`, and never trusts client request IDs.
  - SQLite grant persistence accepts `evidence:acquire`.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/authorization.test.ts tests/http.integration.test.ts tests/security_persistence.test.ts
```

Expected: only Phase-2.3A action/resource/route assertions fail because the action/resource are not yet recognized.

- [ ] **Step 3: Implement the minimum public surface**
  - Add `FactAcquisition`, `EvidenceArtifact`, `VerifiedEvidenceArtifact`, `MappingManifest`, `AdapterManifest`, `AdapterOperationManifest`, `AcquisitionRecord`, `EvidenceAcquisitionRequest`, and `EvidenceAcquisitionResult` types.
  - Add optional `acquisition?: FactAcquisition` to `TemporalFact`.
  - Extend all exact action sets to include `evidence:acquire`.
  - Authorization accepts only `resource.kind==="evidence"` for `evidence:acquire`.
  - Add the HTTP route and keep recognized-mutation missing-idempotency handling inside the application service for auditability.

- [ ] **Step 4: Verify the focused pass**

Run the focused command above. Expected: all focused tests pass.

- [ ] **Step 5: Run affected integration checks**

Run:
```sh
cd reasoning/phase2
npm run conformance
npm run gate:phase21
npm run gate:phase22
```

Expected: all existing tests and both existing gates pass unchanged.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): add evidence acquisition API action surface [green]`

---

### Task 2: Add deterministic adapter registry, verified artifact hashing, and pure mapping contract

**Files:**
- Create: `reasoning/phase2/src/evidence.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/evidence.test.ts`

**Interfaces:**
- Produces `EvidenceAdapter`, `EvidenceMapper`, `AdapterRegistry`, `SecretResolver`, `StaticSecretResolver`, `verifyEvidenceArtifact`, and canonical artifact/mapping hash helpers.
- Consumes the Phase-1 canonical `hashJson`/`canonicalize` primitives.
- Later tasks consume the registry and verified artifact types.

- [ ] **Step 1: Add focused failing tests**
  - Duplicate adapter IDs are rejected.
  - Duplicate operation IDs and mapping IDs are rejected.
  - Unknown adapter/operation/mapping resolution fails closed.
  - Registry returns only server-configured adapter/operation/mapper definitions.
  - Artifact body mutation, metadata mutation, tenant mutation, adapter-version mutation, or stored-hash mutation causes verification failure.
  - The same verified artifact mapped twice produces byte-equivalent canonical fact drafts and deterministic fact IDs.
  - Changing mapping version or implementation hash changes fact identity/commitment.
  - Mapper cannot choose a different tenant; tenant is injected by the acquisition service.
  - `StaticSecretResolver` resolves only server-configured opaque references and rejects unknown references.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/evidence.test.ts
```

Expected: import/module failures for the new evidence kernel.

- [ ] **Step 3: Implement the minimum kernel**
  - Validate manifests at construction.
  - Keep adapter capability restricted to `READ|COMPUTE`.
  - Build `EvidenceArtifact` with exact captured body string, SHA-256 body hash, and canonical artifact hash.
  - Verify both body and artifact hashes before exposing `VerifiedEvidenceArtifact`.
  - Define mapper contract with no clock/network/secret inputs.
  - Compute deterministic mapped fact IDs from tenant, artifact hash, mapping manifest identity, output index, and canonical fact content.
  - Do not persist anything in this task.

- [ ] **Step 4: Verify the focused pass**

Run the focused test. Expected: all evidence-kernel tests pass.

- [ ] **Step 5: Run affected integration checks**

Run `npm run conformance`. Expected: all tests pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): add deterministic evidence adapter kernel [green]`

---

### Task 3: Refactor authenticated ingestion verification and add atomic evidence persistence for SQLite/PostgreSQL

**Files:**
- Modify: `reasoning/phase2/src/ingestion.ts`
- Modify: `reasoning/phase2/src/repositories.ts`
- Modify: `reasoning/phase2/src/world_state.ts`
- Modify: `reasoning/phase2/src/postgres.ts`
- Modify: `reasoning/phase2/sql/postgres.sql`
- Test: `reasoning/phase2/tests/ingestion.test.ts`
- Create: `reasoning/phase2/tests/evidence_persistence.test.ts`
- Modify: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Adds `AuthenticatedFactIngestor.authenticate(envelope, now)` returning verified authenticated fact + nonce claim without persistence.
- Existing `ingest()` delegates to `authenticate()` then existing single-fact persistence, preserving behavior.
- Adds `EvidenceRepository.commitAcquisition(scope, artifact, record, facts)`, `getArtifact`, `verifyArtifact`, and `getAcquisition`.
- SQLite `WorldStateStore` and PostgreSQL repository implementations atomically write artifact, acquisition record, nonce claims, and all authenticated facts.

- [ ] **Step 1: Add focused failing tests**
  - `authenticate()` accepts/rejects exactly the same signatures, freshness, canonicality, tenant, and trust keys as `ingest()` but does not persist.
  - Existing `ingest()` remains behaviorally unchanged.
  - SQLite commit persists artifact + acquisition + all mapped authenticated facts atomically.
  - Duplicate fact, duplicate nonce, malformed acquisition record, or artifact-integrity failure rolls back every artifact/fact/nonce/acquisition write.
  - Cross-tenant artifact/acquisition lookup returns not found.
  - Artifact read revalidates body and artifact hashes and detects direct DB tampering.
  - PostgreSQL reproduces the same atomic commit/rollback/isolation/tamper properties.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/ingestion.test.ts tests/evidence_persistence.test.ts
```

Expected: new verification-only and evidence-repository contracts are absent.

- [ ] **Step 3: Implement atomic persistence**
  - Factor ingestion verification so there is one canonical signature/freshness/canonicality implementation.
  - Add additive SQLite tables `evidence_artifacts` and `evidence_acquisitions`.
  - Add additive PostgreSQL tables `axiom_evidence_artifacts` and `axiom_evidence_acquisitions`.
  - Store immutable artifact body + hashes, and hash the acquisition record.
  - For atomic multi-fact commit, reserve each adapter-attestation nonce and insert all facts inside the same transaction as the artifact/acquisition record.
  - Verify every supplied authenticated fact matches its nonce claim and tenant before write.
  - Make all reads tenant-qualified and integrity-checked.

- [ ] **Step 4: Verify focused pass**

Run focused SQLite tests. Expected: all pass.

- [ ] **Step 5: Run affected integration check**

Run:
```sh
cd reasoning/phase2
npm run conformance
npm run test:postgres
```

Expected: SQLite suite and live PostgreSQL tests pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): persist evidence acquisitions atomically [green]`

---

### Task 4: Add adapter attestation and acquisition orchestration with fail-closed idempotent semantics

**Files:**
- Modify: `reasoning/phase2/src/evidence.ts`
- Create: `reasoning/phase2/src/acquisition.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/acquisition.test.ts`

**Interfaces:**
- Produces `AdapterAttestor` / `createAdapterAttestor`.
- Produces `EvidenceAcquisitionService.acquire(context, principalId, authorizationDecisionHash, request, now)`.
- Consumes `AdapterRegistry`, `EvidenceRepository`, `AuthenticatedFactIngestor.authenticate`, server-side adapter trust key, and deterministic mappers.
- Returns a stable acquisition result containing acquisition ID, artifact ID/hash, and fact IDs; never raw secrets.

- [ ] **Step 1: Add focused failing tests**
  - Acquisition resolves registry only after an already-created authorized tenant context.
  - Adapter result is captured before mapping.
  - Adapter attestation signs canonical `SignedFactEnvelope` payloads with an explicit adapter key ID.
  - Ingestion verifier must trust the adapter attestation key through the configured ingestion keyring; wrong/untrusted adapter key fails.
  - Adapter key cannot authenticate API JWTs or reasoning certificates by construction/interface.
  - Multiple mapped facts are authenticated first and then committed atomically.
  - Adapter/mapping/acquisition failures produce no visible facts.
  - Stable acquisition record contains non-secret adapter/mapping/artifact/principal/authorization commitments.
  - Secrets are absent from returned result and repository inputs.

- [ ] **Step 2: Verify the relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/acquisition.test.ts
```

Expected: acquisition service and attestor imports are missing.

- [ ] **Step 3: Implement orchestration**
  - Generate acquisition IDs from a canonical commitment containing tenant, request hash, adapter/operation/mapping identity, artifact hash, and capture time.
  - Generate adapter nonce per mapped fact from acquisition ID + fact ID + mapped index.
  - Sign the exact existing ingestion envelope payload with Ed25519.
  - Reuse `AuthenticatedFactIngestor.authenticate()` for every generated envelope.
  - Commit through `EvidenceRepository.commitAcquisition` only after all envelopes verify.
  - No adapter/service method receives raw bearer token or idempotency key.

- [ ] **Step 4: Verify focused pass**

Run the acquisition test. Expected: all pass.

- [ ] **Step 5: Run affected integration check**

Run `npm run conformance`. Expected: all pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): attest and commit external evidence acquisitions [green]`

---

### Task 5: Implement bounded HTTP JSON and MUSITU Axiom compute-only adapters

**Files:**
- Create: `reasoning/phase2/src/http_evidence_adapter.ts`
- Create: `reasoning/phase2/src/musitu_axiom_evidence_adapter.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/http_evidence_adapter.test.ts`
- Test: `reasoning/phase2/tests/musitu_axiom_evidence_adapter.test.ts`

**Interfaces:**
- `HttpJsonEvidenceAdapter` implements `EvidenceAdapter` with fixed server-side operation definitions.
- `MusituAxiomEvidenceAdapter` implements `EvidenceAdapter` with explicit compute-only operation allowlist.
- Both consume `SecretResolver` only internally.
- Both return bounded `CapturedEvidence`; neither persists facts.

- [ ] **Step 1: Add focused failing tests**
  - HTTP operation origin/scheme/method/path/header policy comes only from server config.
  - Caller parameters cannot replace scheme/host/port or inject headers.
  - HTTPS is required for production HTTP operations.
  - Ordinary HTTP adapter configuration rejects loopback, unspecified, link-local, multicast, and metadata-style destinations.
  - Redirect response fails; redirect following is disabled.
  - Unexpected content type/status fails.
  - Response size is enforced while streaming and rejects before unbounded buffering.
  - Timeout returns a stable acquisition error without response body leakage.
  - Secret-bearing headers are applied from `SecretResolver` but never copied into captured artifact metadata/body by adapter code.
  - MUSITU adapter accepts only explicit allowlisted operations.
  - Side-effect-like operation names/metadata are denied even if accidentally present in the allowlist.
  - MUSITU request parameters cannot choose the compute base URL or operation outside the configured allowlist.
  - Billing/checkout operations are never exposed.

- [ ] **Step 2: Verify relevant failure**

Run the two focused adapter test files. Expected: modules absent.

- [ ] **Step 3: Implement adapters**
  - HTTP JSON: fixed origin, GET or explicitly configured safe POST, encoded path substitutions, fixed headers, secret header refs, redirect=`manual`, bounded timeout, streaming byte cap, allowed JSON media types/statuses.
  - MUSITU Axiom: fixed configured compute endpoint, explicit operation set, deny-by-default side-effect classifier, bounded JSON capture, no MCP/public billing registry dependency.
  - Use injectable transport functions for deterministic tests while providing production `fetch` defaults.

- [ ] **Step 4: Verify focused pass**

Run focused adapter tests. Expected: all pass.

- [ ] **Step 5: Run affected integration check**

Run `npm run conformance`. Expected: all pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): add bounded external evidence adapters [green]`

---

### Task 6: Integrate evidence acquisition into the authenticated application service and HTTP API

**Files:**
- Modify: `reasoning/phase2/src/api_service.ts`
- Modify: `reasoning/phase2/src/http_server.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Test: `reasoning/phase2/tests/api_service.test.ts`
- Test: `reasoning/phase2/tests/http.integration.test.ts`

**Interfaces:**
- Extends `TenantRuntime` with `acquisitions.acquire(...)`.
- Adds `evidence:acquire` to mutation set.
- Request hash naturally commits route/tenant/body, including adapter/operation/mapping/parameters, while excluding bearer token/idempotency key/resolved secrets.
- Exact successful response is HTTP 201 and is idempotently replayed byte-for-byte.

- [ ] **Step 1: Add focused failing tests**
  - Authentication denial -> zero runtime/adapter/secret/network calls.
  - Authorization denial -> zero runtime/adapter/secret/network calls.
  - Missing idempotency key is audited after authentication/authorization and causes zero acquisition call.
  - First authorized mutation invokes acquisition once and returns 201.
  - Exact retry returns exact stored 201 body and performs zero acquisition/refetch.
  - Changed body with same idempotency key returns 409 and performs zero acquisition/refetch.
  - `IN_PROGRESS` returns 409 and performs zero acquisition/refetch.
  - Acquisition error classes map deterministically to 400/403/413/415/422/502/504/500 as specified without raw upstream body/secret leakage.
  - Audit outcomes distinguish acquisition commit/failure/replay/rejection.
  - Cross-tenant authorization denial precedes registry/network access.

- [ ] **Step 2: Verify relevant failure**

Run:
```sh
cd reasoning/phase2
node --disable-warning=ExperimentalWarning --test tests/api_service.test.ts tests/http.integration.test.ts
```

Expected: evidence mutation cannot yet execute.

- [ ] **Step 3: Implement integration**
  - Add request-body shape validation for `adapterId`, `operationId`, `mappingId`, and object `parameters`.
  - Add `evidence:acquire` to mutation idempotency.
  - Invoke acquisition only after ALLOW + shape + idempotency claim.
  - Complete idempotency only for non-5xx terminal outcomes.
  - Preserve `IN_PROGRESS` for ambiguous 5xx.
  - Extend audit hashing schema only if new non-secret evidence identifiers are stored; if extended, version/hash all fields deterministically in both SQLite/PostgreSQL.
  - Keep all unexpected failures opaque.

- [ ] **Step 4: Verify focused pass**

Run focused API/HTTP tests. Expected: all pass.

- [ ] **Step 5: Run affected integration check**

Run:
```sh
cd reasoning/phase2
npm run conformance
npm run gate:phase21
npm run gate:phase22
```

Expected: all pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message:
`feat(phase2): expose authenticated evidence acquisition API [green]`

---

### Task 7: Add Phase-2.3A acceptance gate, PostgreSQL parity, documentation, CI, and adversarial security review

**Files:**
- Create: `reasoning/phase2/scripts/phase2-3a-gate.ts`
- Modify: `reasoning/phase2/package.json`
- Modify: `.gitlab-ci.yml`
- Modify: `reasoning/phase2/ARCHITECTURE.md`
- Modify: `reasoning/phase2/SECURITY.md`
- Modify: `reasoning/phase2/CONFORMANCE.md`
- Modify: `reasoning/phase2/README.md`
- Create: `reasoning/phase2/phase2_3a_progress.md`
- Modify: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Adds `npm run gate:phase23a`.
- Changes aggregate `npm run gate` to run Phase 2.1, 2.2, and 2.3A gates.
- CI explicitly runs the new gate.
- No new product behavior is introduced in this task except fixes required by adversarial review.

- [ ] **Step 1: Add the end-to-end gate and adversarial tests**
  - Real ephemeral AXIOM HTTP server.
  - Real SQLite world/execution/security/evidence persistence.
  - Real Ed25519 caller, adapter-attestation, source-ingestion, and reasoning-signing keys with separate identities.
  - Controlled deterministic upstream transport.
  - Acquire evidence -> immutable artifact -> deterministic mapping -> adapter-attested ingestion -> world snapshot -> policy -> Phase-1 execution/certificate.
  - Assert snapshot fact contains acquisition provenance and ingestion authentication.
  - Verify artifact/body hash and deterministic remapping.
  - Verify completed idempotent retry performs zero upstream fetch.
  - Verify cross-tenant attempt performs zero upstream fetch.
  - Verify side-effect operation attempt fails.
  - Verify artifact/mapping tampering is detected.
  - Verify stored reasoning replay performs zero network calls.
  - Verify no configured secret occurs in serialized artifacts, facts, acquisition record, security audit, idempotency rows, or HTTP response.
  - Add live PostgreSQL acquisition commit/tamper/rollback parity.

- [ ] **Step 2: Verify the gate initially fails for any missing integration**

Run:
```sh
cd reasoning/phase2
npm run conformance
node --disable-warning=ExperimentalWarning scripts/phase2-3a-gate.ts
npm run test:postgres
```

Expected before final wiring/docs: focused missing acceptance wiring fails; no unrelated prior regression is acceptable.

- [ ] **Step 3: Complete acceptance wiring and documentation**
  - Add `gate:phase23a` and aggregate gate script.
  - Update CI to run Phase-2.1, Phase-2.2, and Phase-2.3A gates explicitly.
  - Document four trust domains, adapter contract, no-refetch replay, artifact integrity chain, atomicity, SSRF controls, MUSITU compute-only boundary, secrets policy, and deferred Phase 2.3B adapters.
  - Record exact acceptance evidence in `phase2_3a_progress.md`.

- [ ] **Step 4: Run full verification**

Run:
```sh
cd reasoning/phase1 && npm run conformance && npm run gate
cd ../phase2 && npm ci --ignore-scripts --no-audit --no-fund
npm run conformance
npm run gate
npm run test:postgres
```

Expected:
- Phase 1: all tests pass + gate PASS.
- Phase 2: all tests pass.
- Phase 2.1 gate PASS.
- Phase 2.2 gate PASS.
- Phase 2.3A gate PASS.
- PostgreSQL integration: all tests pass.

- [ ] **Step 5: Perform bounded security review from Phase-2.2 base**
  - Review every changed file against base `0febed40cd0cecb465936dfd231184965ae4e8e4`.
  - Treat arbitrary outbound access, auth-before-network violations, credential leakage, replay refetch, side-effect adapter access, non-atomic fact/artifact writes, mapper nondeterminism, cross-tenant access, hash omission, and trust-key confusion as Critical/Important classes.
  - Fix any Critical/Important finding test-first and rerun full verification.

- [ ] **Step 6: Commit the passing package**

Commit message:
`docs(phase2): package deterministic evidence acquisition gate`

## Unresolved Product Decisions

None. The approved Phase-2.3A specification fixes the externally observable behavior required for this increment. Engineering details may vary only where they preserve the interfaces, security invariants, status semantics, atomicity, and acceptance criteria above.
