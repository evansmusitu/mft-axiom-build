# AXIOM Track B22 S0 — durable model-dispatch outcome journal

**Isolated CI qualification only. Never deploy. Zero real model calls, no real user data.**

Parent: live GitHub Track B21 `af798a25346b9e08c4f25cfb90106f251a8ebab3`.
B15 signed quota, B16 independent workload signature, B17 signed exact synthetic payload, B19 genuine SDK event recorder and B20 causal verifier remain sourced unchanged. The B21/native B12 coordinator remains byte-pinned. The B22 bridge is copied from verified B21 Git blob `2d35d316512eaa610ef7774fe92550739767dd41` with only B22 marker/receipt matching changes.

**Gap addressed:** Earlier B21 admitted genuine SDK model requests but had no persistent record of attempted transport after quota admission. Crashes could leave an unknown provider result. The new journal conservatively commits an `ISSUED` state *before* synthetic transport and does not issue a second permit for the same request ID. A `COMPLETED` outcome is terminal and bound to a result digest; `UNKNOWN` is terminal until independently reconciled by a future separately authorized design. No automated refund or retry.

The journal uses a second SQLite Durable Object routed by one trusted name per configured account/UTC day. Wrong-name instances fail closed without creating SQL tables. No public route exposes reservation calls; the only HTTP test route uses a synthetic bearer in disposable CI. Private signing key fixtures are public in the inherited S0 source, so this does **not** prove issuer independence or customer workload authentication. The default HTTP endpoint rejects unauthenticated requests. CI invokes only local Workerd and scripted model responses.

Evidence gates:
- Node SQLite real transaction tests and deliberate red/green cycle.
- Independent Python synthetic bridge adversarial tests.
- Genuine local Cloudflare Workerd named DO SQLite test, replay/concurrency and persistence checks.
- Two real OpenHands SDK tool workflows via the new Workerd transport gate, no provider inference.
- Separate credentialless CI job for signed native event record plus B20 causality.

**Not proven:** crash recovery across real regions/hosts, true global Cloudflare remaining Free usage, commercially valid independent workload authorization gateway, external penetration test, actual model transport reconciliation, safe user data isolation, production deployment, device phases or superiority. An `ISSUED` record means uncertain whether remote provider actually received a request; user controls and external provider idempotency are required before reconciliation. No production or paid resource is authorized.

## Local-only HTTP route hardening

An independent source review found the initial test Worker route authenticated
only a synthetic bearer whose default fixture was visible in public source.
That made accidental HTTP exposure a risk even though no actual provider existed.
Added a strict literal loopback URL gate (`http://localhost` or
`http://127.0.0.1`) before any bearer or model-request handling. Non-loopback
requests fail with HTTP 503, even with the publicly known *synthetic* test key.
Node RED and GREEN test records are preserved alongside the previously observed
RED and GREEN B22 durable-journal tests. This is defense-in-depth, not
independent workload authentication; do NOT deploy this Worker.
