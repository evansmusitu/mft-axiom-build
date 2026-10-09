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

## Production gaps — NOT implemented

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
