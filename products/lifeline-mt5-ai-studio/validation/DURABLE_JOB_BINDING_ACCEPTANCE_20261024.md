# LIFELINE MT5 — durable job fingerprint and concurrency acceptance — 24 October 2026

## Problem reproduced, not hypothesized

The previously implemented Windows agent `execute_once` persisted `job_id`, `nonce`, `state` and `receipt`, but returned a cached receipt whenever the same `job_id` and `nonce` appeared completed. It **did not check** that the newly verified, newly signed job kept the original tenant, operation and arguments. This could misleadingly associate an old execution result with a different signed work request.

**Observed red test:** [Windows agent run 40105724817](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40105724817) reproduced **four genuine failures** when reusing the original job id and nonce while modifying operation, arguments, or tenant. Parallel local execution within one common ledger already passed.

## Code fix

`windows/agent.py` now atomically stores a SHA-256 fingerprint over the exact immutable authenticated job fields `job_id`, `nonce`, `operation`, `args`, and `tenant` in a new `job_bindings` table. Cache lookup requires a matching fingerprint and same job nonce and completed state; no plaintext job data is added to the fingerprint table. Signed `issued_at` timestamp refreshes are explicitly excluded so legitimate short-window renewal remains compatible.

Legacy SQLite ledgers lacking that table/fingerprint remain intact but **fail closed** on historical receipt lookup; they must be manually reconciled, never silently reinterpreted. All database statements occur on the same SQLite connection/transaction before native execution, and the connection closes deterministically.

## Fresh verification

- [Green Windows Agent CI 40106078698](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40106078698): **16/16 Ubuntu + 16/16 Windows tests PASS** including immutable command binding, previous timestamp renewal behavior, 24 simultaneous invocations through the SAME durable local ledger, and legacy-ledger fail-closed recovery. A transient test-fixture Windows file-handle cleanup error was corrected by properly closing its SQLite test connections; no weakening of security assertions.
- [Signed edge and Windows/Linux bridge CI 40106078627](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40106078627): **44/44 Ubuntu**, **44/44 Windows**, and **26/26 edge JavaScript** checks PASS.
- [Stage queue and Neon role/TLS offline CI 40105978312](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40105978312): **8/8 Ubuntu and 8/8 Windows tests PASS**, including 24 simultaneous enqueue attempts that cannot exceed the offline stage cap of 8 active tasks.

## Boundaries

These are **offline tests**; SQLite is only a local simulated backend. This demonstrates single-machine at-most-once protection with **one shared durable ledger**, not global exactly-once execution across machines. There is no proof of inter-host isolation, real persistent Windows MT5/MetaEditor/MCP pairing, live Cloudflare→Modal→Neon owner transaction, client trading capability, paid service, or customer deployment. An independently verified distributed fencing/lease design would be required for multiple agents.

The real Cloudflare private backend **remains fail-closed** and requires explicit cutover and four sensitive bindings before it can be activated. The Modal Starter workspace environment previously contained **13 other apps**, so a workspace-wide proxy token remains forbidden absent proven app-level scoping. No secrets, payments, public launch, merged PR, or production infrastructure changes accompanied this code fix.
