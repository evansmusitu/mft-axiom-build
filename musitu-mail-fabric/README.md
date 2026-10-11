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

## v0.16.0 — Stream-bounded ingress across webhooks, APIs and operator controls (2026-10-10)

The authenticated customer message API and least-privilege cross-Worker feedback bridge now reject oversized streaming bodies *before* reading them into memory, refuse malformed UTF-8, and fail closed on invalid Content-Length. Privileged sender-revocation and suppression endpoints reuse the same bounded parser with their existing tighter per-route limits; static operator tokens remain separate from customer credentials. The signed Resend webhook still requires JSON MIME and its existing 64 KiB cap. The legacy small customer JSON API continues accepting its prior request MIME format without weakening authentication or schema validation.

Tests were committed first and failed for the intended resource-exhaustion and encoding defects; the repaired code passed the full regression suite. GitHub Actions run [38062069930](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38062069930) passed **192 tests, 1 optional skip**, all 18 scoped-bridge tests, all 23 ingress-security tests, and a genuine **nondeploying Wrangler bundle** with routes disabled and public/webhook/customer traffic flags off. Node 22.13+ is required for the local SQLite test harness.

**This does not activate Resend webhooks or customer delivery**. Connected provider inspection still reports zero webhooks, and the independently deployed cross-Worker sender-outbox link has not been validated live. The private webhook-only Worker stays unused for external traffic. Independent third-party audit, production key custody, cloud-to-cloud disaster recovery, legal and commercial readiness remain open. See [v0.16 security evidence and blockers](docs/2026-10-10-v016-stream-bounded-ingress-audit.md).

## v0.18.0 — Real private Cloudflare two-Worker synthetic feedback integration (2026-10-10)

A separate, nonpublic linked webhook Worker successfully processed **synthetically signed** provider feedback through a real private Cloudflare service binding into the sender's SQLite Durable Object. The sender independently verified one accepted synthetic transaction, a recipient-bound signed bounce, replay idempotency, a durable suppression and owner-signed evidence. Ingress no longer needs sender encryption, Ed25519 signing or recipient-HMAC key material. The scoped cross-Worker capability now supports bounded 15-minute key overlap and fail-closed revocation. Live gated proof: GitHub Actions **38073486380**.

The live Cloudflare result is **not an actual Resend-originated event**, does not register a Resend webhook and is not an external security certification. Both Workers remained nonpublic, outbound sending and webhook intake remain disabled, and no customer data was used. See `docs/2026-10-10-v018-private-two-worker-feedback-proof.md`.

## Post-v0.18 isolated engineering: two-custodian recovery and cautious retention

`src/security/offline-custody.mjs` implements a **local, offline-only** encrypted recovery envelope for the original AES-256 message key, opaque-recipient HMAC key, backup key, and Ed25519 signing key. Two *distinct* independently operated RSA-3072-or-stronger custodians must both supply private keys; each possesses only one separately wrapped share. Recovery requires the tenant, the exact epoch, independently pinned custodian public-key fingerprints, and a separately trusted SHA-256 of the exact bundle. This is a recovery *building block*, **not** real KMS/HSM custody, live-key rotation, escrow-provider attestation, or a reason to enable mail.

`src/ops/retention.mjs` provides an offline dry-run and explicitly gated removal of **residual encrypted payload** from old terminal message rows. It cannot erase rows that are queued, sending, from another tenant, on legal hold, or below the configured age threshold. It deliberately preserves idempotency, suppression and historical provider-event evidence; therefore it **does not implement comprehensive privacy deletion, lawful retention or consent management**. Destructive operation requires verified backup, a retention authority attestation, and an explicit acknowledgement; these are operator inputs, not independently verified certifications. No Worker endpoint or cloud automation is added.

See `docs/2026-10-11-offline-custody-and-retention-safety.md` for audit limits, fail-closed operation, recovery expectations and unresolved external approvals.

### Post-v0.18 engineering: key-rotation inventory and unresolved-outcome retention fix

A tenant-scoped, **read-only** key-retirement dependency audit in `src/ops/key-rotation-readiness.mjs` inventories still-encrypted messages, unresolved queue/sending/provider-unknown work, recipient-HMAC references, suppression references, and provider event counts. It always returns `rotationAuthorized:false` because external backups, live KMS secrets, and independently anchored trust transitions cannot be inferred from SQLite counts alone. The audit produces aggregate counts only; it never retrieves message bodies or key material, mutates tables, or permits a release.

The retention cleanup now **excludes `OUTCOME_UNKNOWN`** even after the age window. Unknown provider acceptance is an unresolved delivery claim; erasing its encrypted envelope during reconciliation is unsafe. Regression tests cover dry-run and approved erasure boundaries. This is still not a general erasure or legally approved retention program. See `docs/2026-10-11-v019-key-rotation-preflight-and-provider-qualification.md`.

### Outbound body URL anti-abuse preflight

`src/policy.mjs` now rejects unapproved destinations in plain-text transactional mail, even when a client labels it `SECURITY` or `RECEIPT`. Non-HTTPS and `www.` links are denied, as are unapproved subdomains, credential-bearing or port-specific URLs, and more than five links. The default allowlist is **empty**: body links require an operator-reviewed exact-host `allowedLinkDomains` SDK setting or comma-separated Worker secret/config `MMF_APPROVED_LINK_DOMAINS`. This is a narrow pre-send anti-phishing control; it is **not** a full content-abuse scanner, click tracking, link shortener detector, consent system or guarantee that mail is not spam. No public sending switches are changed.

## Post-v0.18 — independent provider qualification required for *any* future live sending

A local webhook-enabled flag and an arbitrary `whsec_` string no longer suffice for a live-send preflight. In addition to the time-bounded two-independent-signer production release authorization and actual provider webhook configuration, `src/security/provider-qualification.mjs` requires a separately pinned **third-party auditor-signed, time-limited Resend-origin event qualification statement** tied to a specific tenant, domain, Resend webhook ID, provider message ID, event ID, provider delivery-attempt ID and signed raw-event hash. Missing, expired, incorrect, tampered or same-signer-as-release evidence denies real sending. Outbound flags remain OFF, and **no actual Resend-originated qualification has occurred**. A signed auditor assertion cannot replace direct provider validation, legal approval, runtime KMS, customer consent or independent security certification. See `docs/2026-10-11-controlled-provider-qualification-preflight.md`.

## Phase-1 commercial pilot planning — non-production (2026-10-11)

A live signed Resend test was proven at a **disposable standalone receiver** in a controlled authorized trial. It is not a complete live MUSITU durable-outbox reconciliation or permission for customer delivery. The isolated product branch now includes a read-only fail-closed paid-preparation versus live-delivery checklist (`src/commercial/readiness.mjs`), a local CLI (`npm run check:phase1`, **expected to exit 2 / BLOCKED**), a verified-source evidence seed, and proposed limited paid services without sending. [Phase-1 runbook](docs/2026-10-11-phase1-commercial-pilot-activation.md); [unapproved proposal template](docs/2026-10-11-phase1-proposal-template.md). An **MMF-specific** Paynow settlement and billing bridge (despite verified existing shared MUSITU merchant infrastructure), compliant contract/tax identity, independent security review and actual MMF end-to-end real feedback still block commercial customer delivery. This addition deploys nothing, charges nobody and leaves all production switches unchanged.

## Confirmed existing MUSITU Paynow backend — live read-only audit (2026-10-11)

The isolated workflow `.github/workflows/mmf-paynow-existing-authority-readonly.yml` executed Cloudflare **GET-only** source/settings inspection on the already-existing `mft-phase8-external-authority`, `mft-paynow-transport-gateway`, and `mft-fmi-billing` services (GitHub Actions run `38118420154`, **success**). No new Paynow merchant is needed. The live bindings include FMI/Chemistry scoped authorization, but no MMF-specific signed checkout/settlement bridge is present; **do not reuse FMI customer accounts or checkout URLs for MMF**. Sanitized source-hash bound evidence: `docs/2026-10-11-paynow-real-authority-readonly.json`. Assessment logic: `src/commercial/paynow-binding-evidence.mjs`; it keeps payment and mail sending OFF and refuses missing/stale or modified evidence. See `docs/2026-10-11-existing-paynow-authority-reuse.md`.

## MMF Paynow isolated order-ledger qualification (2026-10-11)

`src/commercial/mmf-order-ledger.mjs` contains a separate MMF-only SQLite/D1-compatible staging order ledger: exact-quote SHA-256 binding, strict one-time USD 99 proposal identity, uniquely indexed provider reference hashes, idempotent pending order insertion and synthetic Ed25519-verified settlement replay, with explicit fail-closed staging locks and no customer delivery or invoicing permission. Tests run against real in-memory SQLite via Node 22 `node:sqlite` (experimental test dependency only). **This is not a production Paynow charge, an actual settled MMF fee or proof of a verified MMF payment authority**. The live shared payment audit still proves only FMI/Chemistry scoped integration; adding an MMF-specific authority/transport binding and independently verifying real settlement remains a separate release-controlled task.

### Distinct private MMF billing stage (not Paynow production checkout)

The stage-only intake worker `src/commercial/billing-stage-worker.mjs` with no public routes or payment integration is documented in [`docs/2026-10-11-mmf-billing-private-stage-worker.md`](docs/2026-10-11-mmf-billing-private-stage-worker.md). The separate locked D1-only deployment template is `wrangler.mmf.billing-stage.template.jsonc`. Existing FMI/Chemistry Paynow billing does **not** settle MMF orders.


## 2026-10-11 Paynow native protocol qualification (isolated, NOT live)

`src/commercial/paynow-native-protocol.mjs` now parses and verifies the official Paynow SHA-512 wire-message contract with fail-closed input validation, exact MMF product/price checks, and an allowlisted Paynow polling URL. `src/commercial/paynow-private-authority-candidate.mjs` demonstrates a **future server-side extension to the existing shared MUSITU payment authority**, using independently fetched signed provider status and an Ed25519 settlement/refund receipt. `npm run test:paynow-native` exercises genuine protocol primitives with FAKE ephemeral keys and an emulated HTTP poll. It makes **no real Paynow call, checkout or refund**. Never put the Paynow integration key or the authority receipt signing private key in the MMF frontend, production Mail Fabric Worker or repository. See `docs/2026-10-11-mmf-paynow-protocol-integration-candidate.md`.

**Release remains BLOCKED**: no MMF-specific routes/tokens in the existing live authority or transport, no deployed MMF billing service, no legal issuer/invoice clearance, no independent security approval, no genuine MMF payment/poll or reversal, and no independently qualified MMF live Resend outbox integration. The shared FMI, Axiom and Chemistry payment stack remains unchanged.

### Private stage receipt intake (October 11, 2026)

The dark MMF billing Worker can now accept **offline authority-signed evidence**
for a previously opened stage order via `POST /v1/billing/stage/evidence`.
This is a private, non-public, simulated payment state integration only. It
never charges Paynow, issues an invoice, grants Mail Fabric delivery, or accesses
FMI subscriptions. It rejects reactivating reversed orders. The independent
receipt bearer token must differ from the private order-operator token.

The deployment template ships with `workers_dev=false`, zero public routes,
`MMF_STAGE_RECEIPTS_ENABLED=false`, no live provider binding, and no secret values.
See `docs/2026-10-11-private-stage-receipt-ingress.md`.

### Dark private MMF authority-to-stage receipt handoff (2026-10-11)

An **unshipped** private service-binding adapter in
`src/commercial/paynow-private-stage-bridge.mjs` completes the locally
exercisable evidence-delivery boundary: a separately authorized authority-side
component signs an MMF-only receipt, verifies its canonical signature and quote,
and passes it using a preconfigured private `MMF_PRIVATE_PAYMENT_STAGE` service
binding to the isolated billing stage Worker. There is **no public HTTP
fallback**, merchant credential, Paynow network transaction, customer charge,
or mail entitlement. The adapter requires an explicit
`MMF_STAGE_BRIDGE_ENABLED=true` *and* all non-production dark-stage locks,
its own stage receipt token, and an Ed25519 public-key fingerprint pin; absent
any prerequisite it fails closed. A 200 HTTP status alone is insufficient:
the private stage's acknowledgement must identify the exact order and
sandbox-only, no-commerce/no-mail state.

Run `npm run test:stage-bridge`, then `npm test` and `npm run check`. The
service-binding object and all provider events used in tests are in-memory
emulators. This does not imply that the real production Paynow authority
already has an MMF route, service binding or MMF secret.
