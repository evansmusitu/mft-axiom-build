# 25 October 2026 — private Cloudflare stateless stream-bounds security checkpoint

**Scope:** isolated LIFELINE MT5 AI Studio, nontrading / owner-only synthetic-status source. No cloud provider writes, no worker deployment, no paid provisioning, no owner cutover, no other project mutations. Existing D1 and Modal paths retained unchanged.

## Validated issue and correction

- `infra/cloudflare/alternative/private_worker.mjs` previously called `request.text()` before checking the exact required `{}` status payload. A hostile/misrouted stream could be fully buffered before an `unauthorized` response. Replace that with a two-byte maximum streamed reader; reject a mismatching `Content-Length`, cancel overlong streams early and accept only the byte sequence `7b 7d`.
- `infra/cloudflare/alternative/gateway.mjs` previously buffered the entire private Service Binding response with `result.text()` before checking `raw.length > 4096`. Replace that with a 4,096-byte bounded stream reader, early stream cancellation and strict UTF-8 decoding before schema validation. Failure continues to return only the sanitized 502 error.
- `infra/cloudflare/alternative/test_alternative.mjs` adds two synthetic streaming regression tests that prove early cancellation of excess request and response data, without accepting any trading or job commands.

## Recorded local red/green runs

- **RED 1:** Before private Worker fix: `node --test infra/cloudflare/alternative/test_alternative.mjs` -> 8 pass, 1 fail (`private Worker cancels oversized streamed status bodies immediately`). Failure showed absent cancellation.
- **GREEN 1:** After first fix: `node --test infra/cloudflare/alternative/test_alternative.mjs infra/cloudflare/alternative/test_config.mjs` -> 11 pass, 0 fail.
- **RED 2:** Before gateway fix: `node --test infra/cloudflare/alternative/test_alternative.mjs` -> 9 pass, 1 fail (`gateway cancels oversized private service response without reading it all`). Failure showed absent cancellation.
- **GREEN 2:** After both fixes: `node --test infra/cloudflare/alternative/test_alternative.mjs infra/cloudflare/alternative/test_config.mjs` -> **12 pass, 0 fail**.
- Additional unchanged suites before edit: Python provider-readonly unit tests **8 pass**, Windows unit tests **61 pass**, Modal offline unit tests **36 pass**.
- `npm ci --offline` could not install the full `jose`/Wrangler Node dependency tree because some tarballs were missing from the isolated environment cache. `npm ci` online also returned an npm internal error. Full `infra/cloudflare/test.mjs` was therefore **not run locally**; use real GitHub CI after commit for that path. Do not mark it passed without CI evidence.

## Provider no-spend and availability limits

The handoff's last authenticated exact-account D1 list returned **11** databases; its Free-plan D1 numeric maximum is **10**. Never create D1 or remove other projects' assets. Cloudflare publicly documents Workers Free limits of **100 Workers** and **100,000 requests/day**, but these are product-wide plan limits **not current account subscription, spare quota, or a hard $0 spend guarantee**. The exact account's Worker plan, remaining available capacity, and enforceable no-spend conditions are not proven by this source checkpoint. The zero-D1 Worker is **still source-only and unprovisioned**. Existing Access MFA and signed service binding must be verified live before any cutover.

## Acceptance remaining blocked

Current authenticated owner JWT, Workers account eligibility and hard no-spend bound, no-public-ingress deployment readback, live private Service Binding HMAC acceptance and negative cases, permanent native Windows x64 host/MT5 pairing, and historical demo-market testing. Stateless replay may occur within 90 seconds but has no side effects; never extend it to stateful commands without durable nonce rejection. PR #30 remains draft; main is not modified.
