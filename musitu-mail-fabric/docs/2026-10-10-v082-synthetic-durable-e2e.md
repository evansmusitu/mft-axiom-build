# MUSITU Mail Fabric v0.8.2 — Staging-only durable transaction qualification

## Scope

This qualification executes the **actual DurableMailFabric** message lifecycle against the *isolated* SQLite-backed Durable Object used by the existing private Cloudflare Worker. The injected message is synthetic: `synthetic@example.org` to `synthetic-recipient@example.net`, no customer data, no real provider, no DNS public route. The configured provider is an in-process simulation and never makes network requests.

## Data path

`Cloudflare Queue synthetic probe → stage-only Worker → internal authenticated SQLite Durable Object adapter → DurableMailFabric.enqueue → durable encrypted envelope → DurableMailFabric.processById → simulated provider API acknowledgment → final durable state + envelope erased → signed evidence receipt → local and remote verification`.

The authorized test report must say **SIMULATED PROVIDER ACCEPTED**, not mail delivered to inbox. Signed evidence is anchored only to the explicitly pinned **staging** Ed25519 public-key SHA-256 fingerprint. No legally qualified timestamp, genuine provider attestation, real transport, independent legal certification or external penetration test is implied.

## Verification and controls

- Fails closed unless `MMF_STAGE_ONLY=true`, `MMF_REAL_SEND_ENABLED=false`, `MMF_API_ENABLED=false`, `MMF_WEBHOOK_ENABLED=false` and `MMF_STAGE_CRYPTO_READY=true`.
- Requires stage-only key material from Worker Secrets; no real sender/customer/API secret is introduced.
- A synthetic message is created from a restricted fixed template (the Queue body carries only a random probe ID). The same probe ID replays the durable original record without generating a second send, and the accepted encrypted envelope is erased.
- Reporter emits only synthetic signed event metadata; source addresses and message content must never be present in emitted evidence.
- The standalone runner must pin the expected staging public-key fingerprint before trusting the receipt and must verify its signed hash chain outside the Cloudflare Worker process.

## Operational boundary

No staging-to-production cutover, paid account upgrade, public URL, Resend/Postal API call, or AXIOM production edit is authorized by this validation. Full customer readiness still requires provider-side event reconciliation from controlled real inboxes, independently controlled long-lived KMS/HSM key custody and backup, independent audit, privacy/legal approval, monitoring and genuine outage recovery proof.
