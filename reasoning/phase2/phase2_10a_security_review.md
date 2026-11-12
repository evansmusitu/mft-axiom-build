# Phase 2.10A — billing and live-smoke threat review (2026-11-03)

## Threats tested in code

- Invoice-based provider usage is not free: the budget decorator reserves a tenant, adapter and model specific micro-USD amount BEFORE calling the underlying adapter.
- Reused compilation intent or repeated explanation capture is rejected before provider refetch. Request keys and response commitments are SHA-256; no API token is persisted by the ledger.
- SQLite BEGIN IMMEDIATE prevents double allocation across connections to the SAME database file. The separately implemented PostgreSQL ledger uses budget-row FOR UPDATE locks and atomic settlement across workers, with committed PostgreSQL concurrency/overage tests that cannot run until CI quota is restored. Missing budget/unknown tenant denies network access; an ambiguous provider failure retains a reservation and requires manual reconciliation.
- Strict token parsing handles OpenAI input/output/cached-read and Anthropic uncached input/output/cache-read/cache-write. Misreported/missing tokens fail closed; integer arithmetic uses BigInt and rounds up.
- If actual billability exceeds the reserved amount the full observed charge is recorded and future calls are suspended. This does NOT prevent upstream overage on the completed request.
- The live probe requires opt-in authorization and all configured secrets, hashes approved reader module and version-pinned object content, and writes a private evidence file without raw responses.

## P0 residual risks — NO production security approval

- Critical: adapter budgeting is opt-in, not centrally enforced by a trusted gateway or registry. An unwrapped provider adapter can bypass cost controls. Do not deploy it without an enforced factory that refuses unmetered registration.
- Critical: SQLite file locking works only on a shared compatible filesystem. An opt-in PostgreSQL central ledger is now implemented but untested in CI, not required by the API service, and has not been tested under production worker contention; per-provider organization caps are still required.
- High: vendor price schedules are operator-supplied and may not cover price tiers, extended context, cached pricing, auxiliary/tool tokens, taxes, or transient vendor billable errors. Reconcile with vendor billing; no strict vendor spend guarantee.
- High: registered spend limits are immutable here and intentionally have no authenticated administrative update API. Formal SSO/MFA dual-control administration, audit and emergency suspension/reconciliation workflows are missing.
- High: the live probe trusts the operator-supplied SDK reader module after SHA pin; independent supply-chain review and least-privilege SDK credentials are mandatory.
- High: no real provider credential-backed exercise has occurred; independent TLS/ingress, worker key custody and external penetration signoff remain absent.
- Medium: explanation billing intent includes captured timestamp; a call retried under a new timestamp can be a different paid request. Existing service idempotency must keep the exact intent and prohibit blind provider retries.
- Medium: no documented load, latency, alerting, production restoration, external invoice reference or provider cost dispute process has been executed.
- GitLab CI quota exhausted after initial red/implementation runs. Latest commits are NOT green tested; do not merge or close roadmap.

## Decision
Release NO-GO, change only on a reviewed branch. Blocker issue #24 and roadmap #4 must remain open. Source compatibility matrix commits SQLite and PostgreSQL cost component hashes; its current check is not reverified until CI returns. No profit/return guarantee.


## Additional code review — bounded streaming responses

A further static review found that the generic HTTP evidence transport, the OpenAI/Anthropic model-provider transport, and the MUSITU compute adapter previously cleared their timeout as soon as response headers arrived. That could leave a delayed response body unbounded.

This draft branch adds regression cases for stalled HTTP 200 bodies, with each adapter's deadline covering the fetch and the entire bounded JSON body capture. The three dedicated tests were committed **without a runnable red/green CI cycle because quota was exhausted**. As of this review the changes remain unverified; they do not constitute passed production security evidence.

The fixed MCP adapter already uses a full-body deadline and remains covered by prior specific regression tests. The release reviewer must also verify negative cases for DNS rebinding, redirects, slow streams, aborted reads and uncooperative fetch adapters, plus the distinction between synthetically stalled streams and actual deployed network connections. Do not infer live network or external penetration certification from the new unit tests.
