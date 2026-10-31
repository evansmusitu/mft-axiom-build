# MUSITU AXIOM Customer Frontier — 31 October 2026

**Status: ISOLATED S1 ENGINEERING CANDIDATE — NOT DEPLOYED, NOT PRODUCTION QUALIFIED, NOT AN INDEPENDENT FRONTIER WIN.**

This additive engineering package continues the verified AXIOM 29 October handoff. No main-branch or PR #1 modification is required. The existing production service and browser app remain rollback origins.

## Contents

- `customer_control_plane/schema.sql` — D1/SQLite persistent identity, tenant membership, immutable credit ledger, verified provider event uniqueness, holds, settled receipts, refund requests, and Project/Work/Agent/Artifact/Evidence graph.
- `customer_control_plane/ledger.mjs` — integer-money, idempotent order and verified settlement/reversal accounting, unit reservations and commits, conditional refund limits.
- `customer_control_plane/worker.mjs` — server-side tenant-scoped customer API. Requires a qualified identity verifier service; denies unqualified checkout. Cross-site POST intent/origin guard.
- `customer_control_plane/private_reconciler.mjs` — **private-only** provider-reconciliation boundary. Must not be publicly routed; provider independently verifies real settlement/refund evidence.
- `customer_control_plane/browser_adapter.mjs` — same-origin session-cookie client; no bearer tokens or raw account keys in browser storage.
- `customer_control_plane/vnext_remote_data_adapter.mjs` — optional typed bridge to the existing `axiom_interface/vnext/` Project/Work shell. Does not mislabel local preview as production execution.
- `standalone_portal/` — accessible, responsive independent web customer account frontend for credits/usage, orders, receipts, refund requests, tenant projects, work, artifacts/evidence overview, and support.
- `tests/` — reproducible isolated source tests for ledger, concurrency-related invariants, access and fail-closed behavior.
- `benchmarks/` — frontier-comparison targets and strict **NOT CERTIFIED** evidence comparator; no invented baseline scores.

## Local tests ($0 network/provider cost)

```sh
node --test tests/customer.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
python benchmarks/verify_benchmarks.py benchmarks/frontier_manifest.json benchmarks/observations_not_proven.json --output benchmarks/current_result.json
node --check customer_control_plane/worker.mjs
node --check customer_control_plane/private_reconciler.mjs
node --check standalone_portal/portal.js
```

`sqlite_d1_test_adapter.mjs` uses Node 22 experimental `node:sqlite` for deterministic offline tests only; D1 production transactional behavior and distributed durability **must be proven on actual Cloudflare D1** before promotion.

Read-only static UI preview: `python -m http.server 4173` and navigate to `/standalone_portal/`. Because the API and identity service are not deployed, the portal displays an authentication-required message; this is expected and should **never** be represented as a live usable customer account. An actual responsive/assistive-tech acceptance run remains unverified.

## Critical integration and negative evidence

### Commerce — independently marketed, off-plugin only

OpenAI plugin guidelines on 31 October 2026 prohibit in-plugin digital-credit subscriptions and indirect in-plugin upsell, including checkout links. Keep the 4 commerce tools hidden from the ChatGPT plugin and do not embed this standalone portal billing section in a plugin iframe. ChatGPT may explain a missing entitlement and link to a non-transactional information page, not open a checkout. Source: `https://developers.openai.com/plugins/plugin-guidelines`.

The standalone browser site may support external commercial relationships subject to legal/provider qualification. `PAYMENT_CHECKOUT_QUALIFIED` is **not** an authorization by itself: it can be activated only after the independent provider adapter, signed reconciliation, fraud/chargeback flow, statutory invoicing, tax, privacy, and owner release approvals. Provider checkout must be on `https://payments.mftintelligence.com` only. No live money was processed by this candidate. A browser return URL is never settlement evidence.

`private_reconciler.mjs` requires a separately operated private Worker and provider verifier, with `ALLOW_INTERNAL_RECONCILIATION=qualified_private_binding`. Do **not** expose its route publicly or trust a user-supplied `verified:true` field. The provider verifier must make and record a true live PSP status check, robust against replay, webhook spoofing, ambiguity and provider outage, with externally retained evidence. No provider-specific adapter is asserted complete here. The code is prepared for that binding but does not fabricate it.

### Identity — the key-first experience remains a source-level gap

The sealed live OAuth worker currently asks users for `musitu_account_key` to connect ChatGPT. This candidate **does not alter that worker**. A new qualifying identity broker must complete verified registration, MFA, OIDC session, recovery, PKCE, OAuth consent, customer/tenant provisioning, canonical `issuer + subject` mapping, legacy customer key migration, and revocation. Each account must have the same tenant identity on the standalone portal and ChatGPT plugin, independently proofed. Customer API fails closed when the `IDENTITY_VERIFIER` is absent or the membership is not already active. Authentication service must verify bearer audience, expiry, scopes, CSRF and MFA. Do not infer identity from a `tenant_id` request parameter or email alone.

### Five-object workspace

Projects and Work have storage and scoped API creation; Agent/Artifact/Evidence are persistent SQL objects with tenant-scoped read surfaces. Automatic agent execution, artifact upload, provenance verification and approval are **not enabled**; they require the governed execution engine, independent verifier and security gateway. The remote vNext adapter is opt-in and labels existing preview work honestly. Research, Analyze, Build, Computer, Live and other surfaces remain in the existing AXIOM whole product, not cut down to this customer subset.

### Money and metering

All money is integer minor currency units. Credit ledger, provider receipts and invoices are protected by SQL update/delete-denial triggers in the local test suite. Independent D1 access controls, external immutable custody and operational change controls remain unqualified. Client retries use idempotency keys. A customer's pending order never grants units; unique verified provider settlement grants exactly once and creates a receipt with `tax_review_required`. Refund request never executes a PSP refund. A verified completed provider refund causes a proportionate credit reversal; if units were consumed, debt is recorded and new reservations are denied. Real disputes, split refunds, chargebacks, recovery, taxes and reconciliation against provider financial statements require real-world qualification. Unverified financial events must not be accepted as successful payments.

## Remaining release blockers (do not relabel as finished)

| Gate | Classification | Evidence required |
| --- | --- | --- |
| Zero-key self-service onboarding and customer recovery | NOT PROVEN | Live owned IdP/OAuth PKCE on fresh accounts, real verified email/MFA, browser/ChatGPT identity continuity |
| Independent provider checkout, settlement, invoice compliance, refunds | NOT PROVEN | Provider approval, real sandbox + authorized real-money settlement, reversal, taxes, external witness and accounting reconciliation |
| D1 transaction/concurrency and ledger controls | LOCAL TEST PASS / PRODUCTION NOT PROVEN | Cloudflare D1 migration, multi-region races, ACL, ledger immutability, event replay and crash recovery |
| Unified whole product | PARTIAL CANDIDATE / NOT PROVEN | Real bound vNext adapter, agent/work execution, artifacts, provenance and independent verifier |
| B27 global antirollback | **FAILED_IN_SYNTHETIC_ATTACK** | External nonrollbackable trust root and independent destructive attack proof |
| Phase13/14/15, Wolfram parity, global superiority | NOT CERTIFIED | Earned gates, physical devices, independent comparative evidence and authorized claim scope |
| Accessibility, mobile, resilience, availability | NOT PROVEN | WCAG 2.2 AA manual/automated, actual mobile/tablet, failure injection, SLOs, rollbacks |
| Staging/canary/production | BLOCKED | Security+verifier veto, owner approval, staged smoke, rollback proof |

## Source authority

- Verified 29 October handoff SHA-256: `f5658faa3ef80e04d9efbf2adccb23568c04987f03c58d02886e4aa85feff8d9`
- Live `main` observed: `06cc5f74fb066c11f8d81390f424e58a2f9c261a` (re-read before any GitHub mutation)
- Existing vNext shell reference: `build/axiom-openhands-s2-readonly-20261027` @ `381261c3b77e306230823cb7936e210dfd93bc47`
- PR #1 must stay open, draft, unmerged. Production remains rollback origin.

**Do not start a production billing trial or publish a frontier superiority claim from local synthetic tests.**
