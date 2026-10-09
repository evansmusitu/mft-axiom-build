# MUSITU Mail Fabric — isolated pre-production MVP

A new MUSITU-owned communications trust layer above email delivery networks. It does not claim to operate its own SMTP fleet or outperform incumbents.

Built features: transactional-only policy; tenant/sender/recipient/domain controls; optional suppressions; tenant-scoped in-process idempotency; no automatic retry after unknown provider outcome; pluggable simulation and opt-in Resend transport; signed Ed25519 SHA-256 evidence chains; opaque recipient identifiers; authenticated Fetch API.

Run locally: cd musitu-mail-fabric && npm test && npm run check && npm run demo

Simulation sends zero real email. Sender domain verification and legal regions are configured assertions, not automatic DNS or legal attestation. API ACCEPTED_BY_PROVIDER is NOT evidence of inbox delivery or of human reading. Digital signatures require an independently pinned public key before they can support third-party audit.

Important blockers before sending real customer mail: durable distributed transactional store/outbox, sender DNS ownership verification, keys in external secret management, consent/suppression/webhook-bounce verification, reputation and abuse controls, measured data residency, real customer authorization, secure deployment and backups. This prototype stores idempotency in memory and uses demonstration signing keys: NOT production safe.

Everything is isolated on product/musitu-mail-fabric-isolated-20261009. This work changes no protected main, frozen OpenAI, existing support operations, DNS, mail domain or production customers.

See docs/2026-10-09-market-design.md for product moat hypothesis and phased roadmap.

## v0.2 isolated durable outbox and Mailpit tests

The new `src/durable/fabric.mjs` and `src/durable/schema.sql` implement an encrypted, D1-compatible pre-production SQL outbox with tenant-isolated persistent idempotency, conditional delivery claims, lease expiration that fails closed, persistent recipient suppressions and signed evidence across restarts. `src/testing/mailpit-smtp.mjs` is a loopback-only Mailpit SMTP adapter for controlled tests, not a public email relay.

`npm test` runs the original unit tests plus SQLite-backed restart, concurrency, encryption, suppression and tenant-isolation tests. The isolated CI additionally runs a real Mailpit SMTP/API capture test using the GitHub Container Registry image. For details and remaining production blockers, see `docs/2026-10-09-v0.2-durable-engine.md`.

**Not deployed:** No Cloudflare D1 database, Queue, public sender, live customer traffic or production keys have been connected by this milestone. Provider acknowledgments do not establish inbox delivery.
