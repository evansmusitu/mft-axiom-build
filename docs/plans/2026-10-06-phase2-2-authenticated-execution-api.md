# Phase 2.2 Authenticated Execution API Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production network boundary that authenticates callers, deterministically authorizes tenant-scoped actions, provides durable idempotency and tamper-evident security audit evidence, and exposes authenticated fact ingestion/execution/replay without weakening Phase-1 or Phase-2.1 trust guarantees.

**Architecture:** The HTTP transport only parses bounded requests and maps routes to an explicit action/resource target. A security boundary authenticates an Ed25519 JWT into a principal, deterministically authorizes `{principal, requestedTenant, action, resource}`, and only then constructs `TenantScope` and invokes existing Phase-2.1 services. Durable SQLite/PostgreSQL security repositories store authorization grants, mutation-idempotency state, and per-tenant hash-chained audit records; all reasoning execution remains delegated to `ReasoningControlPlane` and therefore to the Phase-1 compiler/runtime/certificate verifier.

**Tech Stack:** TypeScript on Node 24.12, Node built-in HTTP server/fetch/crypto, `jose@6.2.12` for standards-based Ed25519 JWT verification, Phase-1 AXIOM kernel, SQLite reference persistence, PostgreSQL 17 + node-postgres, GitLab CI.

## Global Constraints

- Branch from verified post-merge Phase-2.1 baseline `b347fd42c623eb0fa8b6a824eee26d6abb702878` only.
- Preserve state → policy → signed platform context → Phase-1 execution → independently verified signing → persisted replay.
- Network input may request a tenant but must never directly establish trusted `TenantScope`.
- No tenant world-state/execution repository, tenant runtime, ingestor, or `ReasoningControlPlane` operation may run before caller authentication and authorization succeed. Security-boundary repositories used to resolve grants, idempotency, and denied/accepted audit evidence are the only pre-domain persistence exception.
- Authentication establishes identity only. Authorization grants are server-side data; JWT claims cannot self-authorize tenant actions.
- Cross-tenant access must fail even when object IDs are known.
- Existing Ed25519 source-ingestion signature/freshness/nonce checks remain mandatory.
- Existing signer-provider verification, historical signer-key replay, snapshot/execution integrity, policy source fingerprint, and exact world-state provenance remain mandatory.
- Mutation idempotency is fail-closed: completed identical retries return the original durable outcome; key reuse with different input is rejected; an abandoned `IN_PROGRESS` record is never automatically re-executed.
- Security audit records are tenant-streamed, sequence-checked, head-checked, and hash-chained. Verification must detect record mutation, middle/tail deletion, or reordering relative to the persisted stream head.
- Raw bearer credentials and raw idempotency keys are never persisted.
- Phase-1, Phase-2.1, and PostgreSQL conformance remain green throughout.
- No brokerage execution, billing/quotas, model compiler, distributed workers, arbitrary policy language, broad adapter marketplace, dynamic authorization admin API, or UI in this increment.
- TLS termination, rate limiting/WAF, database encryption/backup policy, and dynamic JWKS/key distribution are deployment/infrastructure boundaries, not bypasses around this application trust model.

---

### Task 1: Remove the obsolete split nonce-receipt path

**Files:**
- Modify: `reasoning/phase2/src/ingestion.ts`
- Modify: `reasoning/phase2/src/repositories.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Delete: `reasoning/phase2/src/ingestion_receipts.ts`
- Modify: `reasoning/phase2/src/postgres.ts`
- Modify: `reasoning/phase2/scripts/phase2-gate.ts`
- Modify: existing ingestion/PostgreSQL tests

**Interfaces:**
- Consumes: `WorldStateRepository.putAuthenticatedFact(scope, fact, claim): Promise<boolean>`.
- Produces: `AuthenticatedFactIngestor` constructor with no `receipts` dependency.
- Removes: `IngestionReceiptRepository`, `IngestionReceiptStore`, and `PostgresIngestionReceiptRepository`.

- [ ] **Step 1: Add the focused failing test**

Assert that authenticated ingestion can be constructed using only `tenant`, `world`, `keyring`, `maxEnvelopeAgeMs`, and `maxFutureSkewMs`; assert no public Phase-2 export exposes a standalone nonce-claim implementation used by ingestion.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && npm run conformance`

Expected: constructor/export assertions fail because the compatibility receipt surface still exists.

- [ ] **Step 3: Implement the minimum behavior**

Remove the unused receipt constructor dependency and legacy receipt repository/classes. Keep nonce claim + authenticated fact persistence exclusively behind `WorldStateRepository.putAuthenticatedFact`, preserving the Phase-2.1 transactional behavior in SQLite/PostgreSQL.

- [ ] **Step 4: Verify the focused pass**

Run: `cd reasoning/phase2 && npm run conformance`

Expected: all ingestion tests pass with the atomic world-repository path as the only ingestion replay boundary.

- [ ] **Step 5: Run the affected integration check**

Run: Phase-2 PostgreSQL integration and Phase-2.1 gate.

Expected: authenticated ingress, duplicate nonce rejection, and rollback-on-failed-fact-write remain green.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `refactor(phase2): retire legacy ingestion receipt path`

### Task 2: Authenticate callers into collision-safe principals

**Files:**
- Create: `reasoning/phase2/src/authentication.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Modify: `reasoning/phase2/package.json`
- Modify: `reasoning/phase2/package-lock.json`
- Test: `reasoning/phase2/tests/authentication.test.ts`

**Interfaces:**
- Produces:
  - `PrincipalIdentity { principalId, issuer, subject }`
  - `CredentialEvidence { issuer, subject, keyId, jwtId, issuedAt, expiresAt, tokenHash }`
  - `AuthenticatedPrincipal { principal, credential }`
  - `CallerAuthenticator.authenticate(bearerToken, now): Promise<AuthenticatedPrincipal>`
  - `JwtTrustStore.trustedPublicKeyPem(issuer, keyId): string | undefined`
  - `createJwtTrustStore(...)`
  - `Ed25519JwtAuthenticator({ trustStore, audience, maxTokenAgeMs, maxTokenLifetimeMs, maxClockSkewMs })`
- Principal ID is `principal:${hashJson({issuer, subject})}`; never concatenate unescaped issuer/subject identifiers.

- [ ] **Step 1: Add the focused failing tests**

Require a valid Ed25519 JWT to authenticate only when:
- protected header has `alg=EdDSA`, required `kid`, and `typ=at+jwt`;
- claims contain non-empty `iss`, `sub`, `jti`, `iat`, `exp`, and configured `aud`;
- signature verifies against the injected `{issuer,kid}` trust store;
- `exp` is in the future, optional `nbf` is not beyond configured clock skew, and token age/lifetime satisfy constructor limits.

Reject unknown issuer/key, wrong audience, wrong algorithm, missing claims, malformed token, expired/not-yet-valid token, excessive token age/lifetime, and the same textual subject under two issuers producing a collision.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && node --disable-warning=ExperimentalWarning --test tests/authentication.test.ts`

Expected: module/interfaces are missing.

- [ ] **Step 3: Implement the minimum behavior**

Pin `jose@6.2.12`. Verify compact JWTs with an explicit `EdDSA` allow-list and injected static trust store; do not fetch remote JWKS. Compute `tokenHash` with SHA-256 over the raw token and persist/return only that fingerprint. Do not consume role, tenant, or scope claims for authorization.

- [ ] **Step 4: Verify the focused pass**

Run: focused authentication test.

Expected: all positive/negative JWT cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance`

Expected: existing Phase-2.1 suites remain green with the new dependency installed.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): authenticate Ed25519 API principals`

### Task 3: Add deterministic server-side tenant authorization

**Files:**
- Create: `reasoning/phase2/src/authorization.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/repositories.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/authorization.test.ts`

**Interfaces:**
- Produces:
  - `ApiAction = "fact:ingest" | "execution:create" | "execution:read" | "execution:replay"`
  - `ApiResource { kind: "fact" | "execution"; id?: string }`
  - `AuthorizationTarget { requestedTenantId, action, resource }`
  - `AuthorizationGrant { grantId, principalId, tenantId, action }`
  - `AuthorizationGrantRepository.putGrant(grant): Promise<void>`
  - `AuthorizationGrantRepository.listApplicable(principalId, tenantId): Promise<AuthorizationGrant[]>`
  - `AuthorizationPolicyManifest { id:"axiom.api-authorization", version, implementationHash, grantsHash }`
  - `AuthorizationDecision { status:"ALLOW"|"DENY", principalId, requestedTenantId, action, resource, matchedGrantIds, policyManifest, decisionHash }`
  - `DeterministicAuthorizer.authorize(authenticated, target): Promise<AuthorizationDecision>`
  - `AuthorizedTenantContext { principal, tenant:TenantScope, authorization, credential }` created only for ALLOW.

- [ ] **Step 1: Add the focused failing tests**

Require exact server-side grant matching by principal ID, requested tenant, and action. Prove:
- a token with arbitrary `tenant`, `roles`, or `scope` claims gains nothing;
- tenant A grant cannot authorize tenant B;
- `execution:read` cannot authorize `execution:replay`;
- malformed/empty tenant or resource identifiers deny before repository use;
- grant insertion order cannot change `decisionHash`;
- decision hash changes when tenant/action/resource/grant set changes;
- DENY never returns an `AuthorizedTenantContext`.

- [ ] **Step 2: Verify the relevant failure**

Run: focused authorization test.

Expected: authorization module/repository interfaces are missing.

- [ ] **Step 3: Implement the minimum behavior**

Fingerprint the authorization implementation source similarly to `evidencePolicyManifest()`. Sort applicable grants canonically before computing `grantsHash`; include target resource and matched grant IDs in `decisionHash`. Keep authorization policy exact-match only; do not introduce wildcard roles or a user-authored policy language.

- [ ] **Step 4: Verify the focused pass**

Run: focused authorization test.

Expected: deterministic allow/deny and cross-tenant/action isolation pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance`

Expected: existing reasoning and ingestion conformance stays green.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): add deterministic tenant authorization`

### Task 4: Persist grants, fail-closed idempotency, and tamper-evident audit

**Files:**
- Create: `reasoning/phase2/src/security_store.ts`
- Create: `reasoning/phase2/src/security_postgres.ts`
- Modify: `reasoning/phase2/src/repositories.ts`
- Modify: `reasoning/phase2/src/types.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Modify: `reasoning/phase2/sql/postgres.sql`
- Test: `reasoning/phase2/tests/security_persistence.test.ts`
- Extend: `reasoning/phase2/tests/postgres.integration.ts`

**Interfaces:**
- Produces:
  - SQLite/PostgreSQL implementations of `AuthorizationGrantRepository`.
  - `IdempotencyRepository.claim(input): Promise<IdempotencyClaimResult>`
  - `StoredApiOutcome { statusCode, bodyJson, contentType }`
  - `IdempotencyRepository.complete(input, outcome:StoredApiOutcome): Promise<void>`
  - `AuditRepository.append(event): Promise<AuditRecord>`
  - `AuditRepository.verifyStream(requestedTenantId): Promise<{status:"MATCH"|"MISMATCH"; diagnostics:string[]}>`.
- Idempotency binding key: `{principalId, tenantId, action, idempotencyKeyHash}`.
- Request hash: SHA-256/canonical hash over `{method, routeTemplate, requestedTenantId, body}`.
- Claim outcomes:
  - `CLAIMED`: new `IN_PROGRESS` record.
  - `REPLAY`: same request hash and completed record; return stored HTTP status/body.
  - `IN_PROGRESS`: same request hash but unfinished record; fail closed with 409.
  - `CONFLICT`: same binding key with different request hash; fail with 409.
- Unexpected failure after `CLAIMED` leaves the record `IN_PROGRESS`; automatic retry must not re-run a possibly completed side effect.
- Audit record core includes requested tenant ID, request ID, optional principal ID, action/resource, credential token hash when available, authorization decision hash when available, request hash, idempotency key hash when applicable, outcome, timestamp, sequence, and previous hash.

- [ ] **Step 1: Add the focused failing persistence tests**

SQLite and PostgreSQL must prove:
- grants are durable and exact-match;
- completed idempotent retries return the byte-equivalent stored response/status;
- different body under the same idempotency binding returns `CONFLICT`;
- concurrent/same-key second claim cannot execute;
- `IN_PROGRESS` never silently re-executes;
- raw idempotency keys/tokens do not appear in persisted rows;
- audit appends are strictly sequenced per requested tenant;
- independent tenant streams have independent genesis/head hashes;
- audit verifier detects record mutation, deletion of a middle record, deletion of the tail relative to stored head/count, and sequence reordering.

- [ ] **Step 2: Verify the relevant failure**

Run SQLite focused test and PostgreSQL integration job.

Expected: security persistence modules/tables are missing.

- [ ] **Step 3: Implement the minimum behavior**

SQLite: use `BEGIN IMMEDIATE` around claim/complete and audit-head transitions. PostgreSQL: use transactions and row locking (`SELECT ... FOR UPDATE`) on per-tenant audit heads/idempotency records. Store canonical response JSON and status for completed mutation outcomes. Use parameterized SQL only. Schema must include tenant/principal/action in every security key that could otherwise cross domains.

- [ ] **Step 4: Verify the focused pass**

Run focused SQLite persistence test.

Expected: all idempotency and audit-integrity cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `npm run test:postgres`

Expected: PostgreSQL 17 proves equivalent grant, idempotency, and audit behavior alongside existing Phase-2.1 repository tests.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): persist authorization idempotency and audit`

### Task 5: Compose the secure application service and HTTP boundary

**Files:**
- Create: `reasoning/phase2/src/api_service.ts`
- Create: `reasoning/phase2/src/http_server.ts`
- Modify: `reasoning/phase2/src/index.ts`
- Test: `reasoning/phase2/tests/api_service.test.ts`
- Test: `reasoning/phase2/tests/http.integration.test.ts`

**Interfaces:**
- `TenantRuntimeFactory.create(scope:TenantScope)` produces the existing tenant-bound `AuthenticatedFactIngestor`, `WorldStateRepository`, `ExecutionRepository`, and `ReasoningControlPlane`.
- `AxiomApiService.handle(request): Promise<ApiResponse>` owns the order: authenticate → authorize → validate the action-specific request shape → construct `TenantScope` → idempotency for mutations → domain operation → complete deterministic terminal outcomes → append final audit outcome.
- `ApiResponse { statusCode, bodyJson, headers }` carries one already-serialized JSON body; fresh mutation responses are serialized once, stored as that exact `bodyJson`, and completed retries reuse those exact bytes.
- HTTP transport generates `requestId`; client-supplied request IDs never become trusted IDs.
- Exact endpoints:
  - `POST /v1/tenants/:tenantId/facts` → action `fact:ingest`; requires `Idempotency-Key`; body is `SignedFactEnvelope`.
  - `POST /v1/tenants/:tenantId/executions` → action `execution:create`; requires `Idempotency-Key`; body is `ExecutionRequest`.
  - `GET /v1/tenants/:tenantId/executions/:executionId` → action `execution:read`.
  - `POST /v1/tenants/:tenantId/executions/:executionId/replay` → action `execution:replay`.
- Transport limits JSON request bodies to 1 MiB and accepts `application/json` on POST routes.
- Error envelope: `{ error: { code, message, requestId } }`; no stack traces, SQL text, key lookup details, or raw provider errors.

**HTTP contract:**
- 200: execution evaluation (including domain `DENIED`), execution lookup, replay, and stored idempotent response if original was 200.
- 201: first successful fact ingestion; identical completed idempotent replay returns the original 201/body.
- 400: malformed JSON/request shape, missing `Idempotency-Key`, invalid path identifier, or request rejected before domain execution as structurally invalid.
- 401: missing/invalid/expired caller credential; include `WWW-Authenticate: Bearer`.
- 403: authenticated principal lacks the exact tenant/action grant; no tenant repository/runtime is created.
- 404: authorized request cannot find the tenant-scoped object or route does not exist.
- 409: idempotency conflict or existing `IN_PROGRESS` request.
- 413: body exceeds 1 MiB.
- 415: POST body is not JSON.
- 422: caller is authorized but the signed fact envelope fails source authentication/freshness/nonce/canonical-payload checks.
- 500: unexpected internal error; response is opaque, event is audited, and a claimed mutation remains fail-closed.

- [ ] **Step 1: Add the focused failing application/HTTP tests**

Use spies plus a real ephemeral `127.0.0.1:0` Node HTTP server and `fetch`. Prove:
- valid credential + exact grant can ingest a valid signed fact and execute/replay;
- path/body/header tenant spoofing cannot change the authorized tenant;
- principal authorized only for tenant A receives 403 for tenant B and no tenant runtime/repository method is called;
- a known tenant-B execution ID queried under authorized tenant A returns 404 from tenant-A scope only;
- invalid/expired credential returns 401 before authorization/repository access;
- action escalation (`read` grant attempting `replay`) returns 403;
- same mutation + same idempotency key replays exact durable response without invoking domain mutation again;
- same key + changed request returns 409;
- stale/invalid signed fact returns 422 and persists no fact;
- a program containing reserved `AXIOM_PLATFORM_CONTEXT_SHA256:` input is rejected and cannot bypass the control plane;
- policy `DENIED` remains a normal 200 domain result with no Phase-1 certificate persisted;
- unexpected signer-provider invalidity remains rejected by `ReasoningControlPlane` and surfaces only as opaque 500;
- accepted, denied, idempotent-replay, and internal-error attempts all append audit evidence.

- [ ] **Step 2: Verify the relevant failure**

Run: focused API/HTTP tests.

Expected: application service and server do not exist.

- [ ] **Step 3: Implement the minimum behavior**

Route-match before body dispatch, parse bounded JSON, extract one Bearer token, generate server request ID, authenticate, authorize, validate the action-specific body shape, and construct `TenantScope` only from ALLOW. For mutation routes, hash the canonical request and caller key, claim idempotency, dispatch exactly once, and complete every deterministic non-5xx terminal outcome produced after the claim (including approved/denied execution results, successful ingestion, and source-envelope 422 rejection). Replay completed outcomes with the stored status and exact stored `bodyJson`. Unexpected 500-class failures leave the claim `IN_PROGRESS` so retries cannot duplicate a possibly committed side effect. Catch known boundary/domain errors into the contract above; map unknown errors to opaque 500. Never add an alternate certificate/execution path around `ReasoningControlPlane`.

- [ ] **Step 4: Verify the focused pass**

Run: API service and HTTP integration tests.

Expected: all endpoint, spoofing, authorization, idempotency, and error-contract cases pass.

- [ ] **Step 5: Run the affected integration check**

Run: `cd reasoning/phase2 && npm run conformance && npm run gate`

Expected: old Phase-2.1 behavior stays green and API composition tests pass.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `feat(phase2): expose authenticated execution API`

### Task 6: Package the Phase-2.2 conformance gate and documentation

**Files:**
- Create: `reasoning/phase2/scripts/phase2-2-gate.ts`
- Modify: `reasoning/phase2/package.json`
- Modify: `.gitlab-ci.yml`
- Modify: `reasoning/phase2/ARCHITECTURE.md`
- Modify: `reasoning/phase2/SECURITY.md`
- Modify: `reasoning/phase2/CONFORMANCE.md`
- Modify: `reasoning/phase2/README.md`
- Create: `reasoning/phase2/phase2_2_progress.md`

**Interfaces:**
- Preserve `scripts/phase2-gate.ts` as the explicit Phase-2.1 gate.
- Add `npm run gate:phase21`, `npm run gate:phase22`, and make `npm run gate` execute both.
- Existing CI jobs remain; Phase-2 conformance runs both gates and PostgreSQL job runs expanded security persistence coverage.

- [ ] **Step 1: Add the end-to-end Phase-2.2 gate**

The gate must use a real ephemeral HTTP server and prove:
1. Ed25519 JWT principal authentication.
2. Exact tenant/action authorization.
3. authenticated Ed25519 fact ingestion.
4. idempotent mutation replay.
5. reasoning execution through the unchanged `ReasoningControlPlane`.
6. Phase-1 certificate issuance plus existing independent signer verification.
7. durable execution persistence.
8. authorized deterministic replay.
9. denied cross-tenant known-ID request before foreign repository access.
10. denied action escalation.
11. invalid/expired caller credential.
12. tamper-evident audit verification.
13. audit detection after deliberate persisted audit mutation.
14. Phase-2.1 source-ingestion freshness/nonce protections still enforced.

- [ ] **Step 2: Verify the relevant failure**

Run: `cd reasoning/phase2 && npm run gate:phase22`

Expected: the new acceptance script fails until Tasks 1–5 are composed.

- [ ] **Step 3: Implement composition/docs/CI**

Document the caller-authentication trust root separately from source-ingestion trust keys and reasoning-certificate signing keys. State that JWT authorization claims are ignored, that requested tenant is untrusted until authorization ALLOW, and that audit/idempotency rows are security state. CI must continue Node 24.12 and PostgreSQL 17.

- [ ] **Step 4: Verify the focused pass**

Run: `cd reasoning/phase2 && npm run gate`

Expected: Phase-2.1 and Phase-2.2 gates both PASS.

- [ ] **Step 5: Run the complete acceptance pipeline**

Run a fresh GitLab branch pipeline.

Expected:
- `phase1:conformance`: SUCCESS with Phase-1 gate PASS.
- `phase2:conformance`: SUCCESS with all Phase-2 tests and both gates PASS.
- `phase2:postgres`: SUCCESS against PostgreSQL 17 including security persistence/adversarial cases.

Then perform a full diff/security review from `b347fd42c623eb0fa8b6a824eee26d6abb702878` to branch head. Fix every Critical/Important finding test-first, rerun complete CI, and create a merge request only after the review is clean. Require a fresh MR-specific pipeline and final MR-level security review. Do not merge automatically.

- [ ] **Step 6: Commit the passing deliverable**

Commit message: `docs(phase2): package authenticated execution boundary gate`

## Externally observable decisions fixed by this plan

- Caller credential: compact Ed25519 JWT, `alg=EdDSA`, `typ=at+jwt`, configured audience, required issuer/subject/key ID/JWT ID/issued-at/expiry; no remote JWKS in this increment.
- JWT role/scope/tenant claims have zero authorization authority; grants are server-side.
- HTTP surface is exactly the four `/v1/tenants/...` endpoints above.
- Mutation idempotency key is required for fact ingestion and execution creation only.
- Cross-tenant authorization denial is 403 before repository lookup; authorized-tenant missing objects are 404.
- Reasoning policy denial remains a 200 domain outcome, distinct from API authorization denial.
- Source-envelope authentication/freshness/canonicality rejection is 422.
- Completed idempotent retries reproduce the stored original status/body; `IN_PROGRESS` never auto-retries.
- Audit integrity is a per-requested-tenant hash chain plus persisted sequence/count/head; external notarization/anchoring is not part of Phase 2.2.

## Explicitly deferred boundaries

Dynamic JWKS discovery/rotation service, authorization administration APIs, human login/session flows, rate limits/quotas, TLS certificate management, external audit notarization, brokerage execution, adapter marketplace, model compilation, distributed workers, billing, and UI remain separate increments.
