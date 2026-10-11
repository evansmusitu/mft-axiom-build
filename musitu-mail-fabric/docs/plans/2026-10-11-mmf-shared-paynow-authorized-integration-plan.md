# MMF Shared Paynow Product Isolation — Authorized Integration Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce product-isolated MMF payment authority and transport routes into the existing MUSITU payment architecture without ever reusing FMI/AXIOM/Chemistry product authority or accidentally initiating real payments.

**Architecture:** Product-scoped request validation executes before existing shared merchant integration logic. The legacy routes and their bindings are preserved exactly. A separate MMF-only service binding reaches those routes with a distinct scoped bearer, tenant/order ledger, independent callback + poll verification, and a default OFF payment-release gate.

**Tech Stack:** JavaScript / Cloudflare Workers, existing MUSITU Paynow authority and transport Workers, Node 22 test runner, GitHub Actions, private Cloudflare service bindings.

## Global Constraints

- Owner authorized MMF-specific code preparation and integration engineering on 2026-10-11. Previous release boundaries require a separate independent approval before any shared production deployment, real merchant transaction, settlement or customer email. Do not silently treat this authorization as a payer consent, tax/legal certification, independent security signoff or instruction to charge anyone.
- Do not edit `main`, PR #1, DNS, public routes or FMI/Axiom/Chemistry entitlements or their secrets.
- `mft-phase8-external-authority`, `mft-paynow-transport-gateway` and `mft-fmi-billing` are shared existing payment infrastructure. Restore-ready snapshots and fresh compare of their Cloudflare source and settings must precede any approved shared Worker modification.
- Four MMF-specific product capabilities remained absent at live GET-only Cloudflare inventory 2026-10-11T15:38:10.311Z. Old raw source hashes are not comparable with current canonical multipart-normalized hashes.
- Neither probes nor synthetic signed attestations are merchant approval or settlement evidence. `MMF_COMMERCE_ENABLED` remains false and no customer mail is enabled.

---

### Task 1: Exact stage-only MMF route admission contract — implemented in isolated branch

**Files:** `src/commercial/mmf-shared-product-route-stage.mjs`, `test/mmf-product-shared-route-staging.test.mjs`, `package.json`.

**Interfaces:** `handleMmfSharedProductRoute(request: Request, env: object, role: 'AUTHORITY'|'TRANSPORT'): Promise<Response>`.

- [x] **Step 1:** Write fail-closed stage-only behavior and negative tests for three MMF-specific route paths; exercise absent/incorrect tokens, cross-product tokens, wrong tenant, wrong method and provider-operation payloads.
- [x] **Step 2:** Run focused failing test against previous module stub; record red behavior.
- [x] **Step 3:** Implement a bounded, credential-redacting stage-only probe handler, accepting exact product scope and refusing payment, merchant credentials, provider polling, mail and settlement assertions.
- [x] **Step 4:** Run Node 22 focused stage route tests and full regression before the source is committed.
- [x] **Step 5:** Commit only the isolated branch and verify GitHub readback and CI.

### Task 2: Read-only authoritative shared Worker source and metadata reconciliation

**Files:** Existing `src/staging/audit-live-paynow-merchant-scope.mjs`; new evidence within the handoff. No shared Worker writes.

**Interfaces:** sanitized source SHA-256, canonical multipart source normalization, expected named bindings, absent MMF route and MMF token inventory.

- [ ] **Step 1:** Repeat authorized GET-only Cloudflare inventory immediately before shared integration work and compare normalized source independently to the previous complete report.
- [ ] **Step 2:** Capture restorable authoritative full source/settings backup in protected custody accessible to the operator; never upload merchant keys or raw shared Worker sources to public GitHub or public artifacts.
- [ ] **Step 3:** Confirm the current shared authority's handler dispatch shape, transport method/route contracts and payment callback semantics. Record only non-secret validated interface metadata.
- [ ] **Step 4:** Abort if source, settings, bindings, OAuth or non-MMF behavior differ from the independently reviewed baseline.

### Task 3: Shared Worker product-specific routing and independent provider qualification

**Files:** Future authority and transport handler modules integrated in their existing private deployment sources; separate MMF-only billing integration and narrowly scoped secrets.

**Interfaces:** authority `POST /internal/paynow/sign-initiate-mmf`, `POST /internal/paynow/verify-callback-mmf`; transport `POST /internal/paynow/initiate-mmf`; independent token references `MMF_AUTHORITY_BRIDGE_TOKEN`, `MMF_TRANSPORT_BRIDGE_TOKEN`.

- [ ] **Step 1:** Confirm merchant account product permission and exact seller identity, currency and approved quote before enabling any payable request.
- [ ] **Step 2:** Implement MMF-specific routes as closed-schema additive handlers leaving original FMI, AXIOM and Chemistry handlers byte-for-byte unchanged; reject product-crossed requests and reused secrets.
- [ ] **Step 3:** Verify two independent authenticated Paynow provider status records for MMF (callback plus status poll), idempotent MMF-only order transitions and negative fraud/replay/refund/settlement cases; provider `Paid` must not be labeled bank settlement.
- [ ] **Step 4:** Run negative authentication, source-diff, staged private-Worker, recovery, legacy-route and all MMF CI tests. Collect independent review and backup/rollback certification.

### Task 4: Separately authorized production release and consented test

**Files:** Existing Cloudflare shared Worker deployment pipeline, MMF-scoped owner + independent approver release evidence, complete audit pack.

**Interfaces:** exact source hash and worker configuration before/after, explicit production release grant; consented provider test under approved merchant agreement.

- [ ] **Step 1:** Obtain independent human production approval, seller/legal/tax readiness and operator review of rollback, pricing and payer consent.
- [ ] **Step 2:** Deploy reviewed additive shared-Worker changes only once immutable preflight source hashes match, then read back and test pre-existing FMI/AXIOM/Chemistry services unchanged; rollback on mismatch.
- [ ] **Step 3:** Authorize one scoped real transaction and independently verify actual provider callback/poll and merchant settlement before recording real MMF revenue. No automatic customer email release.

## Unresolved externally controlled decisions

- Merchant holder/provider confirmation that the current integration is permitted to collect MMF service payments.
- Legally approved MMF offering, tax invoice issuer, price and contracting entity.
- Independent approver/security reviewer release authority and exact production change window.
- Real payer's affirmative consent and rollback/settlement ownership for one controlled payment.

**Release state:** BLOCKED pending Tasks 2–4. The implemented Task-1 stage probe alone cannot install or activate the four missing live MMF merchant capabilities.