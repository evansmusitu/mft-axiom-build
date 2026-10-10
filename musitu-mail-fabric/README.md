# MUSITU Mail Fabric (MMF)

**Isolated, working pre-production prototype · 9 October 2026**

## What it is

MUSITU Mail Fabric is an **evidence-native communications trust layer** for transaction-critical mail: security alerts, account notices, receipts, support notifications and service incidents. Rather than pretending to out-send established email delivery networks from day one, MMF starts *above* those networks with verifiable policy decisions, cryptographically signed evidence, safe replay behavior and a replaceable delivery adapter. The initial adapter is Resend; the product architecture does not depend on Resend's identity, data model or billing.

The long-term commercial hypothesis is that regulated organizations—especially underserved African, cross-border and multilingual organizations—will pay for *provable, governed outcomes* and supplier independence rather than another API that merely posts a message. This is a hypothesis to validate with buyers, not an established durable competitive moat.

### Working today (tested, no cloud account required)

- Deterministic transactional-only policy gate: tenant/domain/purpose/address/input/region/recipient restrictions.
- Explicit suppression of recipient addresses.
- Duplicate-suppression via tenant-scoped idempotency keys within one running process.
- Fail-closed treatment of unknown provider outcomes: never automatically resend a possibly-accepted message.
- Pluggable email-provider interface and opt-in Resend transport. Simulation performs **zero** external network activity.
- Minimal signed SHA-256 event chain with Ed25519 verification by an independent verifier who already trusts the public key.
- Evidence receipts contain an opaque HMAC of recipient address, a payload digest and high-level metadata, **not** the recipient's email, subject or body.
- Bearer-protected Fetch API adapter for one configured tenant, intended for embedding behind secure infrastructure.
- An automated 14-case test suite with simulated calls, including policy, tamper, idempotency, unknown-outcome, authorization and provider-error checks.

### Statuses must not be confused

`ACCEPTED_BY_PROVIDER` means the provider API accepted a message for processing. It **does not** prove delivery to the recipient, inbox placement, opening, reading, user consent, SLA compliance, or legal compliance. A simulation acceptance only describes the simulation.

`REJECTED_BY_PROVIDER` describes a provider API rejection; `OUTCOME_UNKNOWN` means an uncertain result that requires reconciliation before any human-authorized retry. A signature proves the records have not been changed *relative to a pinned/trusted public signing key*, not that the statements inside them are true.

### Run locally

```bash
cd musitu-mail-fabric
npm test
npm run check
npm run demo
```

Node.js 20+ and no third-party packages are required. Tests, checks and the demo do not send email.

### Integrate via the SDK

```js
import { MailFabric } from './src/fabric.mjs';
import { createSimulatedProvider } from './src/providers.mjs';

const fabric = new MailFabric({
  tenantId: 'customer-one',
  verifiedDomains: ['example.org'], // configuration declaration, not a DNS proof
  allowedRegions: ['us-east-1'],
  provider: createSimulatedProvider()
});
const receipt = await fabric.submit({
  tenantId: 'customer-one', from: 'alerts@example.org', to: 'recipient@example.net',
  subject: 'Receipt', text: 'A transaction receipt is available.',
  kind: 'RECEIPT', idempotencyKey: 'transaction-20261009-0001'
});
console.log(receipt.state); // ACCEPTED_BY_PROVIDER (simulation only)
```

To prepare the Resend adapter, an operator must explicitly set `allowNetwork:true` **and** provide a secret key from a secret store. No key is committed or bundled. A production-grade store, key-management service and deployment gate must be built and separately authorized before enabling real traffic. **Do not use this prototype to send real customer messages.**

## Original v0.1 production gaps (historical; see current status below)

- Durable, transactional message/idempotency store (e.g. D1 or PostgreSQL), safe across crashes and parallel workers.
- Separate tenant authentication, quota enforcement, billing, allowlist/domain-ownership and role provisioning.
- Webhook signature verification, bounce/complaint/suppression ingestion, reconciler and state machine reflecting actual provider events.
- Provider selection driven by *measured* reliability, failure, legal residency and price, with contract-backed routing; no automatic resend of ambiguous outcomes.
- Encryption and retention controls for raw message contents; encrypted-at-rest audit storage and lifecycle expiry.
- Long-lived managed signing keys, public key registry, rotation/revocation and independently auditable timestamping/trust anchoring.
- Abuse prevention, spam/fraud controls, consent management, domain authentication (SPF/DKIM/DMARC), unsubscription rules where marketing is eventually added.
- Actual multi-region residency/legal validation: this prototype's `region` is only an operator-declared policy label and **not** evidence of data residency.
- Independent delivery benchmark, sender reputation, self-hosted SMTP fleet, account support, operational SLA, verified security certifications, cost model or real enterprise customers.

## Protection boundary

This is an independent product prototype in an isolated Git branch. It does not import or alter MUSITU AXIOM's production support runtime, its frozen OpenAI submission, protected `main`, existing customers' data, DNS, mail domain or any live delivery credential. Existing verified Resend/Cloudflare integration continues independently. No business claims of years-long immunity to competition are warranted before substantive customer adoption, performance data and defensible partnerships.

## Version 0.2 — durable pre-production outbox

The `src/durable/fabric.mjs` module introduces a separate D1-compatible SQL outbox with encrypted queued payloads, persistent idempotency, atomic per-tenant delivery claims, suppressed-recipient enforcement, bounded leases and fail-closed uncertain outcomes. Apply `src/durable/schema.sql` only to a dedicated development database after review. See `docs/2026-10-09-v0.2-durable-engine.md` for exact constraints.

`npm test` includes SQLite-backed restart and concurrency tests plus an offline SMTP capture server. To additionally test a **locally installed isolated Mailpit** instance (ports 1025/8025), run `MAILPIT_INTEGRATION=1 node --test test/mailpit.test.mjs`. The test never connects to external mail servers. The Mailpit SMTP adapter cannot target non-loopback endpoints.

**No real Cloudflare D1/Queues deployment or customer sending has been performed. This remains a laboratory prototype.**

## v0.3 isolated distributed engine (2026-10-09)

`src/edge/worker.mjs` supplies authenticated restricted API intake, Cloudflare Queue consumption, and scheduled D1 recovery. `src/webhooks/resend.mjs` verifies Resend/Svix webhook signatures and prevents replay using durable SQL records. `src/durable/fabric.mjs` includes a message-id-scoped claim, persistent provider-event evidence, and explicit rejection of stale/unknown delivery states. `wrangler.mmf.template.jsonc` is a **nondeployable** fail-closed template; it has no real D1 ID or public route and all sending flags are false. The deployment needs separate authorization, secrets, D1/Queue setup, robust load/security testing, and legally reviewed customer policies. More details: `docs/2026-10-09-v0.3-distributed-readiness.md`.

### v0.3.1 independent verifier and optional Postal interface

Run independent verification with `node src/verify-cli.mjs --receipt receipt.json --trusted-key trusted.pem` using a separately trusted Ed25519 public key. A Postal API transport adapter is also available via explicit configuration; no live Postal or Resend dispatch is enabled by this repository. This version does not implement an independent SMTP fleet or recipient-proof legal certification.

## v0.4 laboratory security and delivery controls (2026-10-10)

The v0.4 release strengthens `src/durable/fabric.mjs` with one-statement, SQLite-atomic UTC-day tenant quotas (`dailySendLimit`, default 100), an explicit operator-side `MMF_DAILY_SEND_LIMIT` Worker configuration, and durable HMAC recipient identity storage. Authentication and existing tenant-isolation requirements still apply. The API signals an exhausted daily quota with HTTP 429 and `QUOTA_EXCEEDED`; idempotent repeats of the original request remain retrievable even when the cap is reached or a recipient is later suppressed.

When a **properly authenticated** Resend event reports a bounce or complaint, the matching recipient is suppressed for later submissions and already-queued deliveries. Webhook re-delivery repairs a partial event/suppression write failure. The public webhook can ingest feedback while **outbound sending is paused**, without enabling queue/scheduled dispatch. Transient event-store errors return HTTP 503 for retry, rather than falsely confirming delivery. No unsigned webhook may create suppression.

**Migration safety:** The v0.4 table includes `recipient_hmac` as a required column. `CREATE TABLE IF NOT EXISTS` cannot update an existing v0.3 table: do not apply this schema blindly to existing D1 data. No compatible in-place migration of historical accepted messages is proven, because their encrypted envelope is erased after provider acceptance. Use a separately created fresh database for the isolated v0.4 qualification; any later migration of real data requires a reviewed reconciliation and consent plan.

**Limitations:** Tenant quota controls prevent a daily *message count* overload but are not request-per-second rate limits, spam detection, marketing consent or paid-customer abuse protection. The tests currently use local SQLite and mocked provider delivery; no Cloudflare production D1/Queue or real customer domain deployment was authorized.

## v0.8.1 — Dual authorization for production sending (2026-10-10)

The real-delivery path now fails closed unless a matching, time-bounded authorization is Ed25519-signed by **two distinct independently pinned keys**. This gate is checked before any real provider adapter can be built. No production approval has been issued and no live email is enabled. See `docs/2026-10-10-v081-two-party-release.md`.

## v0.8.2 — Synthetic complete durable delivery-path staging qualification

The private synthetic-only Cloudflare stage can now exercise `DurableMailFabric` itself through its isolated SQLite Durable Object: enqueue, encryption, idempotency, simulation-only provider acknowledgement, payload erasure and signed receipts. It cannot send customer email or expose any API. See `docs/2026-10-10-v082-synthetic-durable-e2e.md`.

## v0.8.3 — Cloudflare SQLite billed-write mismatch correction

A real private staging run exposed and now has a regression test for treating Cloudflare billed `rowsWritten` as the number of SQL rows changed. The Durable Object adapter now reads `SELECT changes()` after each statement without yielding, so atomic delivery claims receive the correct affected-row count. Cloud requalification is mandatory before declaring this resolved in the deployed runtime. See `docs/2026-10-10-v083-sqlite-affected-rows.md`.

### v0.8.3 live qualification result

The isolated private Cloudflare Queue → SQLite Durable Object → full `DurableMailFabric` transaction → synthetic-only provider → signed evidence chain **passed** independently pinned receipt verification in GitHub Actions run [38027200745](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38027200745). The code regression suite reported 97 pass / 1 skipped / 0 fail. **No real email sent; not production-qualified.** Exact evidence and blockers: `docs/2026-10-10-v083-live-cloud-proof.md`.

## v0.9.0 — Encrypted offline disaster recovery (2026-10-10)

This release adds a transactional, tenant-scoped SQLite backup exporter, independently pinned Ed25519 signature verification, AES-256-GCM archive encryption, atomic restoration into a fresh empty database, and a fail-closed operator CLI. The tests now include authentic encrypted pending messages, preserved provider-event and suppression history, no-overwrite and corrupted-backup refusal, and recovery without automatic redelivery of ambiguous SENDING messages.

This is **offline** disaster recovery, not an automated or proven Cloudflare Durable Object cloud backup service. It does not replace the still-required genuine outage exercises, production KMS/HSM key custody, live controlled-provider webhook tests, independent security evaluation, or legal review. See `docs/2026-10-10-v0.9-offline-disaster-recovery.md`.

## v0.10.0 — Actual private cloud PITR and operational health, controlled synthetic recovery (2026-10-10)

A guarded private SQLite Durable Object now supports read-only PITR bookmark inspection without revealing the actual bookmark. A separate operator-authenticated, opt-in health endpoint exposes tenant-aggregate counters and incident indicators, including while real sending is paused.

Live Cloudflare staging identified **four expired historical synthetic SENDING claims**, which were safely reconciled to **OUTCOME_UNKNOWN with zero provider retries**. A second independent staging check confirmed **zero remaining stale claims and zero queued backlog**; overall health remains `ATTENTION_REQUIRED` while ambiguous outcomes are unresolved. Live synthetic Queue, encrypted database, receipt signature and private-flag checks continue to pass.

This is not a validated PITR **restore**, cloud cross-region backup, managed HSM/KMS recovery, real provider webhook round trip or an independent external security assessment. No customer email, public API, paid upgrade or AXIOM production change occurred.

See `docs/2026-10-10-v0.10-private-pitr-operations-recovery.md` and GitHub Actions runs 38031070531, 38031355852, 38031663282 and 38031800509.

## v0.11.0 — Real Cloudflare sacrificial PITR restoration (2026-10-10)

An isolated, **separately named disposable SQLite Durable Object** successfully passed a real Cloudflare point-in-time restore: a synthetic baseline record was written, changed, rolled back using a real Cloudflare bookmark and confirmed restored in a **separate private Queue delivery**. A verified GitHub Actions run proves both the mutation and post-restart readback, using a matching unique probe digest. The private staging tenant ledger, public routes and customer sending were untouched.

This qualifies a narrowly scoped **sacrificial in-place restore**, not a genuine production incident, cross-account backup, HSM/KMS recovery, provider webhook verification, or external third-party security certification. [Cloud staging evidence](docs/2026-10-10-v0.11-real-sacrificial-pitr-restore.md). GitHub Actions successful run: 38035299915.

## v0.12.0 — Recipient-bound and race-safe provider feedback (2026-10-10)

The real Worker now rejects authenticated but **cross-recipient** provider events before evidence is recorded or any suppression changes. Strict Resend webhook ingestion requires exactly one signed recipient (matching Resend's January 2026 event format). An event arriving before the provider ID is durably attributable returns **503** to request a provider retry, rather than falsely acknowledging lost evidence with 202. Matching events then persist exactly once and signed bounce/complaint claims suppress the intended recipient.

A real private Cloudflare Queue/SQLite Durable Object run passed the synthetic Svix-signature, recipient-correlation, replay, evidence and bounce-suppression tests (**GitHub Actions 38036274546**). These signatures are generated locally by the test harness and **are not actual Resend-originated events**. The early-arrival path passes isolated regression tests; its attempted live-cloud rehearsal initially failed due to a shared synthetic recipient already being suppressed. Test identities are now probe-specific, but a fresh corrected live-cloud early-race qualification remains unverified.

See `docs/2026-10-10-v0.12-recipient-bound-reconciliation.md`. The service remains **non-public, customer delivery disabled, and not commercially production-qualified**.

**Commercial release preflight:** Two valid independent release signatures alone cannot enable live Resend delivery without a configured authenticated webhook signing secret. Postal customer sending is explicitly blocked until its authenticated feedback integration is qualified. These are software safety checks, not claims of actual Resend webhook registration.

## v0.13.0 — Operator-controlled privacy and emergency containment (2026-10-10)

- New disabled-by-default **operator-only manual suppression** API. Tenant-scoped HMAC recipient digests are persisted without plaintext addresses; retries are idempotent, and previously suppressed recipients cannot enqueue new communication.
- An **atomic per-tenant UTC-day cap** limits new operator suppressions to 200 by default (configurable 1–5000); concurrent requests cannot bypass the limit in tested SQLite. Duplicate requests remain available when the cap is exhausted.
- New disabled-by-default **operator-only sender revocation** API provides an emergency stop for the configured verified domain, even while customer sending is paused. Both operator APIs reject reused customer bearer tokens, invalid JSON and misconfiguration.
- Real private Cloudflare Queue and SQLite Durable Object executed the synthetic operator suppression flow with actual storage readback and a subsequent blocked message. No customer email, public route or external provider call was activated.

See `docs/2026-10-10-v0.13-operator-safety-and-cloud-proof.md`. The current **commercial release gate remains closed**: actual Resend webhook setup/round trips, customer-held KMS/HSM key custody, independent security assessment, compliance and business operations are still not qualified.

## v0.14.0 — Separate non-public provider webhook ingress (2026-10-10)

MUSITU now has an independent `src/edge/webhook-only.mjs` Worker that accepts only authenticated Resend webhook POSTs when separately activated. It never serves public customer APIs, sending APIs, operator actions or diagnostics. A dedicated `MMF_RECEIPTS` SQLite Durable Object namespace is distinct from the existing synthetic `MMF_LEDGER` staging database. `wrangler.mmf.webhook-only.template.jsonc` disables all traffic by default and contains **no credentials or public routes**.

This version passed **167 automated tests plus one optional skip**, successfully bundled through a real Wrangler dry run, and **provisioned the new route-disabled Cloudflare Worker** through a guarded isolated workflow. Live Cloudflare readback verified namespace separation and all traffic flags disabled. **No real Resend webhook is registered** (the connected account still reports zero), no public address is active, and no customer email was sent. Real provider event qualification and independent external security review remain blocking.

Technical evidence: `docs/2026-10-10-v0.14-webhook-only-private-cloud-proof.md`. GitHub Actions: 38055150067 (bundle) and 38055283891 (private cloud provisioning).

## v0.15.0 — Bounded webhook body and least-privilege sender-ledger link (2026-10-10)

The public-facing Resend webhook code now enforces a hard **64 KiB streaming limit** before buffering, validating strict JSON media type and rejecting invalid UTF-8. The separately deployed private webhook-only Worker now fails closed if the actual **sender outbox** has not been linked: the independent receipt namespace is not an acceptable source for provider-message correlation.

A future linked Worker uses a separately scoped `MMF_OUTBOX_FEEDBACK_SECRET`, not the sender database's general-purpose SQL secret. The sender Durable Object allows only exact recipient/provider queries and feedback writes, and requires proven accepted-message attribution before recording delivery feedback or suppression. A non-public, all-features-disabled external-DO binding template is supplied for staged qualification.

**Caution:** This is tested software and a Cloudflare *dry-run* configuration, not yet a deployed cross-Worker bridge or registered real Resend webhook. The previous webhook Worker remains nonpublic and unused for customer feedback. See `docs/2026-10-10-v015-secure-feedback-bridge.md`.
