> **17 October identity update:** The real ZITADEL account is verified on its Free plan. A tested, explicit ZITADEL OIDC adapter is implemented (255 local tests and optimized build pass); instance provisioning awaits the user’s permanent data-region decision. No live ZITADEL login, revocation or browser acceptance is claimed. See `docs/ZITADEL_STAGING_IDENTITY.md`.

> **16 October update:** Groq is securely configured on its verified Free account with inference ZDR. Five real model cases pass, plus 14 real PostgreSQL AI-workflow checks (one additional real model request), 26 standard real PostgreSQL checks and 241 local tests. See `docs/PHASE1_EXECUTION_STATUS_20261016.md`. Owner/staff OIDC login, genuine WhatsApp message E2E, AXIOM service transport and release/recovery gates remain incomplete. Private staging only.

# MUSITU WhatsApp AI Employee SaaS — Phase 1 v1.8.0 private candidate

**Phase 1 is IN PROGRESS; public release and customer messaging remain disabled.**

Groq Free is now the user-selected model provider. Its pinned synthetic-qualification gateway and tests are implemented; secure account/key setup and genuine model execution remain pending. See [Groq staging qualification](docs/GROQ_STAGING_QUALIFICATION.md). Current local suite: 236 passing tests.

The verified original v1.7.0 source now includes a protected Next.js staging application, restricted Neon runtime and ingress roles, 19 tenant-scoped business tables, encrypted contact/message persistence and opaque identity sessions. Current evidence: **236 local automated tests**, **26 hosted native PostgreSQL checks**, **three genuine Meta read-only API checks** and **six configured callback HTTP checks** pass. Meta verified and saved the new app's callback. Official incoming/status sample events reached it and were rejected because their sample channel is unbound; no genuine customer message or delivery receipt was admitted. Keycloak, live model and full acceptance remain pending.

- [Current execution status and blockers](docs/PHASE1_EXECUTION_STATUS_20261015.md)
- [Private deployment and recovery runbook](docs/PRIVATE_STAGING_DEPLOYMENT_RECOVERY_RUNBOOK.md)
- [Real PostgreSQL results](evidence/20261014/real-postgres-qualification-meta-http.json)
- [Real hosted callback HTTP checks](evidence/20261015/hosted-isolated-http-final.json)
- [Isolated draft PR](https://github.com/evansmusitu/mft-axiom-build/pull/29)

Use Node 24 and `npm ci --ignore-scripts`, `npm test`, `npm run build`. Hosted qualification requires the named disposable Neon sandbox and restricted encrypted environment credentials; never substitute production or owner runtime credentials. Vercel authentication protects all dashboard deployments. The separately deployed callback receiver is configured for the isolated development app and exact verified recipient; it has no sending route. Meta's unpublished-app policy currently limits incoming traffic to dashboard test fixtures. Business authentication additionally requires an independently configured OIDC provider; hosting protection does not substitute for employee identity.

## Preserved v1.7.0 development history

The material below records the earlier artifact's state. Its historical statements about missing roles, native testing and Next.js are superseded by the linked current report. Original source and all release restrictions are retained.

# MUSITU WhatsApp AI SaaS — Phase 1 v1.7.0 isolated private integration candidate

This is the **unmerged independent product workspace**, continued from the complete v0.9.0 source archive. It implements an offline end-to-end **private demonstration** of signed WhatsApp-format ingestion, tenant-aware booking, approved FAQ drafting, immutable local review/consent concepts, handover and a browser-based business console.

**Release is blocked.** This artifact does not claim native PostgreSQL qualification, live Keycloak, owned Meta account delivery, a live model connection, customer billing, a Next.js production build or Chatwoot deployment. AXIOM and MAIL FABRIC production systems are unchanged.

## Get started

Requires Node 22+; uses only built-in Node modules for local tests and UI. Do not upload real customer records or real secrets to this harness.

```sh
npm run verify
npm run demo
npm run demo:next
npm run serve:private-demo
```

`serve:private-demo` prints a loopback-only `/app` URL and a short-lived ephemeral **test token**; use tenant `tenant-A` in the browser and paste the token into the Secure session form. This stage supports creating a **synthetic** appointment and transferring a synthetic conversation to HUMAN. A separate second example tenant is inaccessible with the first tenant's identity.

The dashboard does **not** persist the JWT in localStorage or cookies. HTTPS, trusted production sessions and CSRF/session-hardening are requirements of any customer-facing deployment.

## Governed draft-review console (new in v1.0.0)

The authenticated `GET /v1/tenants/{tenantId}/capabilities` route checks real tenant membership and reports which **offline-only** review operations the injected store implements. It never authorizes WhatsApp sending or payment collection.

`/app` now supports an explicit disconnect action that erases in-memory session state and clears business data. It shows "Approve offline" and "Stage offline" only when the backend supports those methods. Its review client keeps per-session, per-draft idempotency keys in memory to allow retry after uncertain HTTP results, and validates server responses before updating the UI.

The default local SQLite demonstration deliberately advertises `review:false` and `stageOffline:false`, because approval/staging are only implemented in the PostgreSQL repository candidate. Never treat a candidate API method as native PostgreSQL proof.

The optional model gateway now enforces an 8KiB streamed response maximum and a transport timeout even for injected transports that ignore AbortSignal.

The `npm run browser:smoke` optional test executes the real Chromium DOM under Playwright when available. Because this managed Chromium environment prohibits navigating to loopback addresses, it injects the exact local CSS/JS sources into Chromium and forwards same-origin API requests through a Python loopback bridge. This is a real DOM/UI interaction test, **not** a deployment/browser-network or Meta test. Python Playwright and Chromium are optional development dependencies.

## Verification and release status

```sh
npm run release:gate          # Expected exit code 2, blocked
npm run qualify:postgres      # Guarded: deliberately unavailable without isolated local PG17 + operator authority
```

See `docs/phase1/finalization/ONE_PASS_STATUS.md`, `docs/phase1/finalization/qualification.json` and `docs/phase1/finalization/FINAL_VERIFY.log`. The native PostgreSQL qualification workflow is present for an isolated sandbox repo, but was not executed on this host. Never point it at any AXIOM, MMF, FMI or customer database.

## Components

- `src/private-stage/`: ephemeral local DB and private authenticated stage API.
- `src/dashboard/`: responsive private dashboard (not Next.js).
- `src/ai/`: FAQ-only AI selection adapter, disabled absent explicit qualified provider.
- `src/adapters/`: read-only AXIOM arithmetic bridge (injected connector); MAIL FABRIC remains disabled.
- `src/postgres/` and `db/`: PostgreSQL candidates, gated until native tests run.
- `scripts/launch-private-console.mjs`: operator-only demo, no provider calls.
- `scripts/phase1-release-gate.mjs`: deliberately denies public promotion.

**Only offline staging is authorized. No Meta sends, public API, payment or production deployment.**

## New in v1.1.0: official Meta protocol boundary (private only)

- `src/adapters/meta-webhook-bridge.mjs` implements Meta's GET verification challenge and signature-checked POST dispatch for an injected `PostgresSignedWebhookIngestor`. A 200 means the injected persistence call returned, **not** customer delivery. It listens on loopback only, cannot be exposed publicly through this package and has no sending logic.
- `src/adapters/meta-send-protocol.mjs` builds the official Graph API text message request **as offline data** and classifies simulated acceptance receipts. Missing or uncertain receipts are `UNKNOWN` with automatic retry disabled. No token, HTTP client or send method exists.
- `npm run meta:protocol:demo` exercises a synthetic signed webhook handshake on loopback. It neither invokes Meta nor a database.
- A dedicated Neon Free PostgreSQL 17 sandbox was provisioned, and its version/extensions were checked. **No migrations were applied and no native app schema/RLS/concurrency qualification succeeded.** The existing `qualify:postgres` guard remains in effect. The attempt to provision a testing role through the connected database interface was blocked, so do not claim native readiness.

Do not turn on a public listener or outbound send by editing flags. Real delivery requires properly approved Meta credentials, durable outbox, verified consent/session, customer data privacy controls, independent qualification, and the existing blocked release gate.

## New in v1.3.0: real native booking constraints and stricter release checks

- A **separately provisioned Neon Free PostgreSQL 17.11 sandbox** was used only for artificial qualification data; no customer data and no AXIOM/MMF/FMI database tables were touched. Native SQL confirmed a gist exclusion constraint rejects overlapping *confirmed* bookings, permits adjacent appointments, and permits same-time cancelled records. A unique effect-key constraint rejects duplicates. This is **not** the full application migration or RLS qualification.
- Read-only inspection detected the provider's project owner role has `rolbypassrls=true`. Indeed that owner could read two artificial tenant records despite `ENABLE/FORCE RLS`; use of this role for the SaaS is prohibited. Provisioning a dedicated non-bypass app role via the current Neon connector was blocked, so native cross-tenant isolation remains **unproven**.
- Runtime role preflight now requires the actual connected role to be non-superuser and non-BYPASSRLS, all 14 required tables to have ENABLE/FORCE RLS, and precisely one audited `tenant_boundary` policy for each required table. Extra permissive policies, missing policies, suspicious conditions or unsafe roles fail closed. This **metadata gate still requires two-tenant behavioral validation under the app role**.
- The local-only native PostgreSQL qualification script now invokes the stronger role-and-policy gate after applying migrations, before exercising any repository actions. Production release remains denied.

See `docs/phase1/native-postgres/REAL_NEON_CONSTRAINTS_20261013.md`.

## Phase 1 v1.3.0 additional PostgreSQL qualification (2026-10-13)

A separate read-only startup gate verifies a **dedicated two-fixture sandbox** under the same non-owner, non-`BYPASSRLS` runtime identity:

- Scopes with `app.tenant_id` unset, tenant A and tenant B must see 0/1/1 **exact** tenant records respectively, without a WHERE filter that could mask a permissive policy.
- Every probe uses a read-only transaction with transaction-local context; rollback is verified, and a connection with failed rollback is discarded.
- Effective privilege checks reject schema/database creation rights, any runtime UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES permissions, and INSERT privileges beyond bookings, draft approvals and offline preparations.
- `createQualifiedPostgresRepository` rejects metadata-only qualification; it requires full policy, grant and behavioral gates.
- The isolated PostgreSQL 17 GitHub Actions qualification script now invokes all three gates after seeding exactly two noncustomer tenants.

**Caveat:** The connected Neon project remains blocked: its only role is the privileged owner with `BYPASSRLS`; role creation was not authorized by the available tools. These gates are covered by local mocked-client tests but have **not** passed under a real least-privilege Neon identity. No customer use or live Meta sending is authorized.


## New in v1.4.0: authenticated action audit and message-ingress hardening

This iteration adds bounded, auditable **local private staging only**:

- The evidence selector now fails closed unless `approved: true` is an explicit boolean on the matching tenant's FAQ entry; missing/null/truthy metadata cannot authorize a draft.
- Model gateway creation now requires `allowedOrigins: ["https://exact.trusted.provider"]` with exactly one pinned HTTPS origin matching the endpoint. The existing `qualified:true` operator guard and model-select-only behavior remain mandatory. This is a configuration fail-closed check, **not** a DNS-rebinding or independent vendor privacy certification.
- The Meta loopback webhook bridge rejects oversized declared Content-Length *before reading*, terminates oversized chunked bodies, bounds incomplete request bodies by `maxBodyReadMs`, and returns retryable HTTP 503 when persistence exceeds `maxPersistenceMs`. A 503 does **not** prove the database aborted; downstream idempotency is mandatory.
- SQLite private inbound events now record keyed payload fingerprints, blocking same-message-ID/different-content replays within a batch and after process restart. Legacy events without fingerprints fail closed on retry. Synthetic inbound batches are capped at 50 events and 256 KiB, including direct store access.
- A **local only** HMAC-chained action audit records booking creation, human handover, FAQ source modifications, channel revocation and draft creation. Idempotent booking/phone revocation does not create duplicate action events. The SQLite schema disallows ordinary UPDATE/DELETE and audit readers recheck the HMAC chain. **Not WORM storage:** a sufficiently privileged attacker can truncate the tail; external anchoring, backups, key management and complete PostgreSQL auditing remain release requirements.
- The private authenticated `GET /v1/tenants/{tenantId}/audit` endpoint is OWNER/ADMIN scoped and read-only. The browser shows audit events and clears them on disconnect. Other stores without this optional method expose no route.

The v1.4.0 browser and test archive demonstrate an isolated qualification prototype; they do not connect customer WhatsApp numbers, send messages, charge payments or validate a production deployment. See `docs/phase1/v14/CONTINUATION.md`.

## New in Phase 1 v1.5.0: customer suppression + private recovery

- Signed Meta-format inbound messages containing exact `STOP` or `UNSUBSCRIBE` persist a tenant- and conversation-scoped automation suppression in the private SQLite stage. The record is stable across restarts, deduplicated on signed callback replay and protected by transactional rollback. `START` does not automatically reauthorize messaging.
- Staff can record an off-WhatsApp customer opt-out through an authenticated private `POST /v1/tenants/:tenantId/conversations/:conversationId/suppress` API with `{ "reason": "CUSTOMER_REQUEST" }`. The private dashboard shows and allows this action only on unsuppressed conversations. Historical approved-source drafts are now displayed as `SUPPRESSED`.
- The PostgreSQL **candidate** adds migration `db/008_signed_customer_suppression.sql`, an ingress suppression guard, offline preparation checks and staff-attested suppression. **It is not native-tested, and live sending remains unavailable.** The RLS/permission matrix now expects 15 tables and four narrowly permitted runtime insert tables.
- Private SQLite encrypted recovery helpers (`backupEncryptedPrivateStage`, `restoreEncryptedPrivateStage`) are covered by tamper, wrong-key, no-overwrite, WAL-commit and restart recovery tests. They are **not** a production backup/PITR system: the temporary raw snapshot requires an encrypted filesystem, and the backup key must be independently secured.
- Use `npm run verify`, `npm run browser:smoke`, `npm run demo`, `npm run demo:next`, `npm run meta:protocol:demo` and `npm run release:gate` (expected exit 2). See `docs/phase1/v15/CONTINUATION.md` for evidence and remaining blockers.

**No real WhatsApp messages, public users, purchases, outgoing email or production database operations are enabled.**

## New in private Phase 1 v1.6.0: team-access revocation and OIDC deadlines

- Local private SQLite stage supports OWNER-only, tenant-scoped staff listing and **irreversible stage revocation** for non-owner membership subjects. `GET /v1/tenants/{tenantId}/staff` and `POST /v1/tenants/{tenantId}/staff/{memberId}/revoke` are JWT-authenticated, strictly body-validated and recheck current database membership on every operation. Revoking an owner, including the requesting owner, is intentionally denied. **There is no enrollment, invitation, role elevation or self-service sign-up.**
- Revocation writes exactly one HMAC-chained local audit event and survives database restart; token signatures remain cryptographically valid but the private application rejects revoked members. This does **not** revoke sessions at the IdP or terminate other applications' JWT sessions. Live Keycloak account lifecycle remains unqualified.
- Browser displays owner-only staff roster, restricted `Revoke access` controls and updated role state. JWT remains RAM-only. A 401/403 response clears the current authenticated session and sensitive business dashboard panels; late replies from a previous tenant session cannot clear a newer session. This is verified in the actual Chromium DOM with the existing local bridge, **not** on a public hosted application.
- PostgreSQL offline draft approval now refuses the customer if a prior signed/staff customer suppression exists, including attempts to bypass the browser and invoke the API directly. This is **unit-tested with an injected PostgreSQL client, not native-PostgreSQL-certified**. Concurrency correctness requires native application-role qualification.
- OIDC JWKS retrieval has a bounded wall-clock timeout **even when the injected network transport ignores AbortSignal**, including unresponsive response streams. Operator-configurable `jwksFetchTimeoutMs` is range-limited to 100–3000ms (default 3000). Stalled identity service results in HTTP 401, not a success/fallback. All tests use synthetic keys and providers; live IdP security certification is still pending.

**Absolute release boundary remains unchanged:** no real WhatsApp sends, public signups, customer billing or live customer identity/records; Phase 1 is **NOT complete**. See `docs/phase1/v16/CONTINUATION.md`.

## New in private Phase 1 v1.7.0: runtime connection fencing, request deadlines, model privacy

- Added `createRuntimeRoleBoundPool` which inspects **every checked-out PostgreSQL connection** for the expected non-superuser, non-`BYPASSRLS` role **before** any tenant query or transaction. It discards unexpected or broken leases. `createQualifiedPostgresRepository` now passes only the role-bound wrapper into its repository after the existing three qualification probes; metadata-only checks remain insufficient.
- Added explicit `createRoleBoundSignedWebhookIngestor` as the safer ingress construction path. The legacy lower-level constructor remains solely for isolated tests, not for production wiring. Ingress tests assert a second, elevated connection is rejected before `BEGIN`. The new role guard alone does **not** establish native database privileges or trusted Meta identity.
- The private authenticated JSON API rejects over-declared body length before reading and returns HTTP 408 on a bounded incomplete body. `maxBodyReadMs` defaults to 3000ms and must be 100–30000ms. Read-only routes are unchanged.
- The optional model-selection gateway detects **common** user contact details, URLs and token-like strings in proposed prompts or approved FAQ *questions* and routes them to human review **before** calling an injected external model. This is intentionally conservative, and not comprehensive PII detection or vendor privacy approval. Normal exact-source FAQ ID selection remains possible.
- Updated the **unexecuted** disposable PostgreSQL CI qualifier to expect 15 tenant-scoped tables and four narrowly granted insert tables, and to use the role-bound runtime and ingress factories. It is **NOT** a native PG pass.

This artifact remains private and synthetic; no live customer messages, no external provider sends, no payments, no Keycloak deployment and no public release. See `docs/phase1/v17/CONTINUATION.md` for final verification and release blockers.

### Private process health semantics (v1.7.0)

- `GET /health/live`: HTTP 200, `ALIVE_PRIVATE_STAGE`. Means only that this loopback-only process can respond.
- `GET /health/ready`: HTTP 503, `NOT_READY`. Hard-blocked until all *real* external infrastructure qualification and public release controls are fulfilled by an independently reviewed deployment, not by a request parameter or token.

Both endpoints are tested; neither is exposed as a public production service by this candidate.
