# MMF full-product launch — architecture qualification (no public release)

**Date:** 2026-10-12. **Branch:** `product/musitu-mail-fabric-isolated-20261009` (isolated MMF). This is a technical specification + testable staging implementation. It is NOT a customer-facing or paid service and contains no production secrets or confidential internal staffing decisions.

## Workstream 1 — Complete commercial product architecture

| Component | Implemented, testable kernel | Not yet proven for a production launch |
|---|---|---|
| Catalog | Immutable versioned USD per-month proposals: Launch $99/5k events, Growth $299/30k, Business $899/100k; Enterprise quote-only. Every item `commerciallyReleased=false`. | Owner's actual commercial approval, overage policies, tax rules, signed contracts, support/SLA, validated cost/price fit. |
| Tenant isolation | Separate SQLite `mmf_tenants`, foreign keys, tenant-qualified lookups, domain ownership and scoped api hashes. | Independent security audit of multi-tenant deployment and Cloudflare Durable Object/D1 migrations. |
| Customer identity | Externally verified OIDC subject is bound to tenant owner; unauthorized subject denied. | Actual OIDC issuer, client app, auth-code+PKCE flow, MFA, account recovery, admin/member roles and session invalidation. The subject input is a trusted internal argument, **not** HTTP user input. |
| Domain onboarding | Isolated DNS TXT challenge; verifier must be a server-side DNS resolver, never client assertions. | Real DNS resolver integration, SPF/DKIM/DMARC verification with customer consent, revocation, domain takeover prevention; customer sender enablement remains OFF. |
| API access | Scoped opaque staging tokens; HMAC at rest with operator pepper, token shown only at issuance and revocable. | Gateway authentication / TLS, central key custody, rate limits, rotation, customer dashboard, abuse controls, vault, audit access. |
| Billing lifecycle | Isolated stage-only orders: PENDING, PAID_ATTESTED_STAGE, FAILED, CANCELLED, REVERSED, DISPUTED. Pinned Ed25519 authorization, exact tenant/order/product/amount/ref/UTC window, dedupe. | Production payment authority **does not yet issue these new attested claims**. Require genuine provider-hash verification via server-owned Paynow authority and externally pinned signing key, real invoice and settlement evidence. No production entitlement. |
| Usage | UTC-month event ledger; idempotent tenant-qualified writes with SQLite transaction and cap; read tenant scope. | Real Cloudflare D1/DO deploy, concurrency/load, billing usage reconciliation, export, invoice metering and overages. |

**Critical:** The Node.js SQLite control-plane kernel is intentionally separate from existing Cloudflare workers. It MUST NOT be attached to customer-facing HTTP or used to charge until external identity, Cloudflare persistence migration, provider authority and release gates are proven. No customer API, mail sending or Paynow checkout can be enabled by its stage statuses.

## Workstream 2 — Real provider delivery integration

- Existing `src/durable/fabric.mjs`, `src/webhooks/resend.mjs`, `src/edge/webhook-only.mjs`, `src/edge/feedback-rpc.mjs` and the dedicated outbox stage already implement signed/Svix receipt processing, provider-id and recipient correlation, suppression on bounce/complaint, and replay / stale-unknown safety.
- `test/mmf-launch-delivery-qualification.test.mjs` adds durable SQLite → synthetic provider acceptance → exact raw-body Svix-signed **simulated webhook** → delivered → bounce/complaint → suppression and replay tests. This is a local cryptographic integration test, NOT independent proof of Resend receiving and delivering production MMF outbox mail.
- Connected Resend observations on 2026-10-12: sending domain verified; one historical owner-addressed qualification email and genuine `email.sent` and `email.delivered` events. The qualification webhook was disabled. Neither confirms production durable MMF outbox reconciliation, bounce and complaint callbacks or sending at scale.
- **Exit gates:** register an isolated production-eligible signed Resend webhook and verify secret custody; perform one expressly authorized low-volume MMF durable outbox → actual Resend send → signed provider webhook → originating outbox event correlation with tenant and recipient proof; demonstrate genuine bounce and complaint handling in provider-approved test mode; fully rehearse outage/restore/rotation, no automatic resend of unknown outcomes, 4xx/5xx and signature-replay negative cases. Never invent real bounce/complaint provider events.

## Workstream 3 — Secure existing Paynow integration

- Verified private canary bindings `MMF_PAYNOW_AUTHORITY` and `MMF_PAYNOW_TRANSPORT` point to shared Paynow authority/transport; both shared worker scripts remained unchanged at last audit.
- Stage-only subscription ledger is **product-specific** (`musitu-mail-fabric`). FMI and Chemistry references, orders and entitlements cannot satisfy any MMF record. Browser redirect or callback text is not trusted for paid status.
- The attached stage verifier only accepts independently signed, exact amount+currency+order+tenant+provider ref and published plan code, and guards paid→reversed/disputed. The trusted claim schema is a proposed contract **not yet implemented by live Paynow authority**. Synthetic signer keys from tests cannot be promoted to production.
- **Exit gates:** implement dedicated MMF-specific authority product routes with distinct credentials (no FMI/Chemistry token reuse); merchant-side canonical Paynow HASH verification; only poll Paynow in documented circumstances, reconcile actual provider status using the pinned server-owned authority; quote version and order isolation; currency, refund/chargeback/dispute and failed/pending/cancelled transitions; single-activation guarantee; separate authorized real-money canary with seller/invoice approval and observed settlement; rollback without non-exportable secret loss. Public billing remains OFF.

## Workstream 4 — Production qualification (fail closed)

| Gate | Current evidence | Decision |
|---|---|---|
| Code tests | Isolated suite and CI; execute fresh on exact SHA | Engineering qualification only |
| Release change inventory | Cloudflare GET-only script+binding baselines and encrypted archive | No live rollback rehearsal |
| Canary | Cloudflare isolated deny-all Worker, private service bindings | No public customer API or MMF checkout |
| Production signatures | Existing two-distinct-independent-signer algorithm; synthetic tests | **UNSATISFIED** — no actual second signer identity or cryptographic signature |
| Privacy | Need actual Zimbabwe and customer jurisdiction controller/processor roles, retention, data transfers, incident policy and contracts | **UNSATISFIED** |
| Merchant/invoice | Existing integration reused; MMF legal invoice and production payment entitlement not yet qualified | **UNSATISFIED** |
| Provider | Resend domain verified; qualification webhook disabled, synthetic test coverage | **UNSATISFIED** |
| Backup/incident | Offline backup and sacrificial Cloudflare PITR evidence | Real tenant-data restore / DR, oncall and controlled key rotation not complete |

The production release controller must report **BLOCKED** until each external item is *independently evidenced*. Owner-authorized work can prepare and qualify isolated infrastructure, but must not fabricate an independent reviewer or bypass an existing dual-signature gate to alter shared payment, customer mail, or protected production systems. If the organization adopts an owner-only governance approach, redesign that requirement with a documented risk acceptance, multi-factor technical compensating controls, protected audit journal, restricted non-shared deployment scope, and external compliance/security review where required. A governance redesign is a new change needing genuine tests; it is NOT the same as claiming two approvals exist.

## Explicit non-claims

No production customer signup, onboarding UI, SaaS entitlement, public API, active subscription checkout, tax invoicing, settlement certification, operational customer sending, SLA, or fully certified release is established by this artifact.

## Readiness decision

`NOT READY FOR GENERAL AVAILABILITY`; next release must pass actual OIDC integration, isolated persistence, live provider linked webhook exercise, existing-Paynow authority MMF product logic, genuine issuer/signature and reversal proofs, independent release conditions or approved alternative governance, privacy/legal review, controlled restore and operational acceptance. No paywall or public announcement before exit gates.