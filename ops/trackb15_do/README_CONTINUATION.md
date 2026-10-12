# MUSITU AXIOM — Track B15 SQLite Durable Object global ledger CANDIDATE (2026-10-12)

**Stage:** Isolated S0 local prototype. Not deployed. Not production-authorized, not externally security certified, not evidence of Cloudflare Durable Object semantics under a live runtime, and NOT a globally qualified ledger.

## Continuation, NOT restart

Previous B14 evidence was verified from live GitHub run `38272446481` on commit `704e36801628524744917015219f5bc9e0d9c412`: two genuinely concurrent OpenHands SDK workers, four provider model calls each, four actions/observations each, one `finish` each, and two small coding tasks passing bounded behavior tests. Signer and executor ran as separate CI jobs but are NOT a production-independent security authority.

Protected main remained `bc48ab8aed137e61b76e25f113bb29e1efd7b11a`, PR #1 open/draft/unmerged. Before ANY subsequent repository write re-read live GitHub and reject drift.

## Why B15 is necessary

B14's model call caps are an in-memory ledger. Other runner machines or restarted brokers can double-spend the SAME purported Free capacity. B13 and B14 also proved that Cloudflare GraphQL `totalNeurons` is advisory/sampled, NOT an exact provider-certified remaining quota. Do not extend live inference authority using sampled usage alone.

Cloudflare Durable Objects on Workers Free (SQLite backend only) offer a potential durable global serialization point per account/day, within their free daily limits. This candidate implements synchronous SQL transaction logic with a pinned independent Ed25519 public verification key. **No Cloudflare deployment, Durable Object invocation, model request, GPU provisioning, secret transfer or protected-branch write occurred as part of B15.**

## Scope and model

- `ledger_core.mjs`: Ed25519-signed grant validation with exact fields, UTC-day and expiry gates, tenant/workload isolation, one ledger per account/day, cross-grant conservative 10,000 Neuron ceiling, per-call cap, per-grant count, and request-id+digest idempotency. A duplicate returns `dispatch_allowed:false`; a broker MUST NEVER retry provider inference on this receipt.
- `durable_object.mjs`: API adapter for Cloudflare SQLite-backed Durable Object. **Default `fetch` is HTTP 503; there is NO binding/routing deployment configuration.** Future routing must choose a canonical object ID by trusted configured account and current UTC day; do not accept caller-chosen bucket keys.
- `test_ledger.mjs`: genuine Node `node:sqlite` SQL statements (not a fake map); includes 40 concurrent request admissions, persisted restart checks, signature tampering, cross-tenant replay, immutable cap reductions, signed revocation, midnight expiry and pre-reservation kill handling.
- `verification.log`: 23 local test cases PASS, zero failures. Negative tests were observed failing before the monotonic cap reduction, pre-admission revocation and signed revocation implementations.

## IMPORTANT: Known unresolved gates — fail closed

1. **No Cloudflare runtime / Miniflare deployment test yet.** `node:sqlite` SQL accepts the tested DDL and transaction pattern, but Cloudflare SQLite API compatibility has NOT been demonstrated on a real DO instance. B15 is *candidate*, not certified global state.
2. **No exact account-wide Free remaining Neurons** proof; signed grants set `provider_remaining_certified:true` only in synthetic tests. An independent signer MUST refuse to issue that production claim absent trustworthy evidence. Never convert GraphQL advisory usage into verified remaining.
3. **No approved independent production Security/Authorization Gateway** is connected. B14's ephemeral CI signer is a testing separation only, not independent release authority.
4. **No broker-to-Durable Object production binding or broker identity attestation**. Signed authorization must be necessary but not sufficient; separate workload identity and private service-to-service channel required.
5. No external PII/customer data, global multi-region proof, external benchmark, incident/rollback/reconciliation/rollback qualification, real-device proof, disaster-recovery or multi-run duplicate replay qualification.
6. Free plan quota/cost evidence is provider-specific and may have changed. Cloudflare Workers Free limits are not permission for production deployment or a guarantee of account-wide $0.
7. Per-day ledger keys must be broker-routed by trusted UTC clock to exactly one Durable Object per configured account/day; misrouting must fail closed.

## Rerun

```
node --check ledger_core.mjs
node --check durable_object.mjs
node --test test_ledger.mjs
python3 VERIFY_B15.py
```

No network, no secrets, no cloud calls.

## Next decisive action

B16: test this exact DO ledger through an isolated **local Workers runtime/Miniflare** with an independent pre-authorized signer and actual SQLite Durable Object state. Verify cross-instance idempotency, signed policy revocation, crash/persistent recovery, and per-day unforgeable bucket routing. Only then evaluate a **nonproduction** Free-plan scoped deployment after current billing, unique account ledger, security and approval gates. Leave protected main, PR #1 and OpenAI submission unchanged.

## Primary official references

- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/get-started/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
