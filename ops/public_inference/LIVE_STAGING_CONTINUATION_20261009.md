# AXIOM zero-cost inference native stage — live outcome (2026-10-09)

**Actual Cloudflare Worker staging is deployed; public customer inference is NOT ENABLED.**

The isolated deployed Cloudflare Worker is `axiom-inference-zero-cash-do-stage-20261009`, `workers_dev=false`, no public routes, and `AXIOM_PUBLIC_INFERENCE_ENABLE=DISABLED`. Its AI and SQLite Durable Object bindings were read back directly from Cloudflare (GitHub Actions run 37977746857). No production hostname/Worker, GitHub protected main, PR #1 or frozen OpenAI submission was modified.

The **current existing scoped token** `CLOUDFLARE_API_TOKEN` is effective under Bearer authorization. Legacy Global Key route failed HTTP 403 code 9103; do not repeat failed Global API Key path or expose secrets.

**Native earned:** 3 paginated subscriptions, no Workers Paid subscription; one successful non-production, synthetic GLM-4.7-Flash model inference (run 37976063344); full gateway/SQLite-DO offline 36/36 tests (run 37977337327); reversible dummy Worker deploy/readback/delete (run 37977530905); actual disabled DO+AI binding stage (run 37977746857).

**D1 block preserved:** 11 existing databases on Workers Free, documented limit 10; isolated create failed HTTP 403. It is NOT authorized to delete/repurpose any database or claim D1 Write scope. Instead an opt-in Free SQLite-backed Durable Object quota ledger was added and tested; live DO transaction admission has NOT YET been executed. This is not the same as certified production global quota enforcement.

**Exact remaining trust gates:** independent customer identity and capability issuer, independently confirmed commercial/data privacy/Free-plan overage proof, live DO replay/adversarial tests, independent security reviewer approval, end-to-end rollback/canary and separate S4 public release qualification. Builders must not mint their own real Free-plan proof or mark missing evidence PASS. **No customer traffic** until earned. Further work must continue on isolated branch only.

**GitHub CI native evidence:**
- Account and billing: 37975739096 (success)
- Real synthetic Workers AI: 37976063344 (success)
- D1 creation: 37976232537 (FAILED)
- D1 capacity: 37976426413 (success, 11/10)
- DO isolated offline contract: 37977337327 (36/36)
- Worker deploy/readback/delete: 37977530905 (success)
- Stage DO + AI bindings route-free: 37977746857 (success).

**Next safe operation:** independent S3 stage reviewer authorizes bounded synthetic DO execution inside the isolated stage; never fake the independent issuer. Complete the actual private customer authorization service and red-team gates before S4 promotion. Zero cash USD 0.00 remains binding.
