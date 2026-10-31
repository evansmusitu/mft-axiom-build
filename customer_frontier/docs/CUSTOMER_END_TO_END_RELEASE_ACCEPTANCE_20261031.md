# MUSITU AXIOM — Customer end-to-end release acceptance matrix

**Governance:** Isolated additive source, NOT DEPLOYED, NO LIVE PAYMENT, NO RELEASE AUTHORITY. Current production is rollback origin; PR #1 and main preserved. This document supplements 29 Oct governed handoff and existing customer candidate PRs; it does not replace either.

## Customer flows and independently required evidence

| Flow | Source candidate | Live acceptance proof | Status |
| --- | --- | --- | --- |
| Find/install AXIOM from ChatGPT | Existing published plugin | Fresh eligible customer discovery, installation, access prompts, mobile and desktop | NOT PROVEN |
| Zero-key signup | `login_broker.mjs` and `enrollment.mjs` | Verified real IdP with PKCE-S256 state binding, email/MFA, recovery, nonce/replay and external audit | NOT PROVEN |
| Same AXIOM identity in ChatGPT and website | Identity subject/tenant contracts | Full OAuth authorization/token/refresh/revocation integration; fresh and legacy accounts; no raw keys | NOT PROVEN |
| Website purchase of compute credits | `worker.mjs`, `ledger.mjs` and independent checkout service contract | Owner-controlled merchant, external legal review, real sandbox, authorized small live charge, verified PSP status, replay/outage/chargeback trials | NOT PROVEN |
| Correct credit journal | SQLite/D1 schema and Node regression tests | Real D1/staging concurrent settlements, provider events, partial refunds, zero-units rounding, restart/rollbacks, daily settlement matching | LOCAL TESTED / REAL D1 NOT PROVEN |
| Receipts and invoices | Candidate invoice/receipt records | Region-specific tax/legal invoice rendering and issuance; provider statement reconciliation; refunds/credit notes | NOT PROVEN |
| Refund request | `requestRefund` and customer portal | Provider-authorized refund execution, traceable id, signed receipt, customer notification, reversal and disputes | REQUEST FLOW LOCAL ONLY |
| Customer account care | `customer_lifecycle.mjs`, `customer_lifecycle.sql` | Staging migration, real support queue, human assignment/response, identity proof for privacy export/deletion, retention/legal holds, notifications | LOCAL CANDIDATE ONLY |
| Persistent five-object workspace | Browser interface + Project/Work/Agent/Artifact/Evidence schema | Deployed authentic identity, governed executor, evidence/object storage, verifier, policy gate and cross-surface continuity | PARTIAL SOURCE CANDIDATE |
| Enterprise | Tenant/membership model | Admin provisioning, verified team invites and role acceptance, SCIM/SSO, organization billing, audit logs, legal terms | NOT PROVEN |
| Secure independent verifier | External authorization contract | Independent party enrolled with veto, key custody, nonrollbackable root, B27 destructive attack re-test | FAILED B27 / NOT QUALIFIED |
| Real devices, performance, resilience | Local UI shell/tests | WCAG 2.2 AA with assistive tech, physical Android/iOS/tablet, mobile bandwidth, abuse tests, backup/restore, canary and rollback proof | NOT PROVEN |
| Frontier comparative quality | Benchmark manifest | Fresh comparable finance baselines with identical tasks/data/budget, independent reviewer, reproduced outcomes/latency/accuracy and claim authorization | NOT CERTIFIED |

## Specific code boundaries

- `customer_lifecycle.sql` is a **new additive migration**, intended for a qualified staging database only. Run after the existing `schema.sql`. Do not apply to live D1 without migration rehearsal, backups and owner approval.
- `/v1/customer/cases` is an authenticated, tenant- and subject-bound **request recorder**; it does not promise that a human or mail system has processed the request. Creating `privacy_delete` **does not delete data**. Support requests are bounded to ten unresolved cases, while privacy rights requests remain available independently with one active request per right.
- `/v1/customer/memberships` exposes the authenticated user's own active membership, not enterprise-wide identity enumeration.
- The isolated standalone browser portal may display standalone billing only when lawful/provider-qualified. **Never expose digital-credit checkout or upsell through the ChatGPT plugin**.
- No raw API key, OAuth bearer token, provider credentials or password is stored by this customer browser adapter.
- The customer product must continue existing AXIOM quantitative capabilities and every other product surface. This candidate is additive and cannot be represented as the entire platform.

## Independent qualification plan (no synthetic promotion)

1. Security owner registers and verifies an independently controlled IdP; test fresh users and legacy-key migration in staging with real S256 and revocation.
2. Merchant/payment operator verifies provider hard limits, provider status lookup, signed callbacks, legal jurisdictions and tax requirements; run provider sandbox and one explicitly approved real capture/refund/reconciliation.
3. Security and verifier execute hostile multi-tenant, fraud, replay, partial-refund, restart, and B27 destructive antirollback challenges. A failed test stays FAILED.
4. Real customers on physical mobile/tablet and desktop perform discovery → signup → connection → first result → paid credits → usage → refund/service request → evidence download; compare baseline cohorts fairly.
5. Independent release authority signs staging smoke, rollback proof, canary and production promotion. Owner final approval required for production/consequential decisions.

**Decision at this checkpoint: HOLD CUSTOMER GA.** Local candidate engineering cannot substitute for independently admitted identity, finance, external verifier and actual user/device evidence. Do not automatically enable checkout or deploy secrets.
