# AXIOM inference — quarantine unsupported remote SQLite DO tests (2026-10-10)

**No public release. Cash budget: USD 0.** No production, protected GitHub main, PR #1 or frozen OpenAI reviewer changes are authorized by this record.

## Root-cause qualification update

Cloudflare's official Durable Objects reference explicitly states that **SQLite-backed Durable Objects do not support remote development**. The old one-shot `wrangler dev --remote` tests (37985883645, 37986018199, 37986231751, 37986439660) returned internal 429 for all signed admissions. They establish **REMOTE_QUOTA_NOT_PROVEN**, not that the implementation is safe or unsafe in a deployed SQLite namespace. The remote-dev method itself was unsuitable. See:

- https://developers.cloudflare.com/durable-objects/reference/environments/ (Remote development)
- https://developers.cloudflare.com/workers/local-development/bindings-per-env/
- https://developers.cloudflare.com/workers/previews/resources/ (isolated preview namespace)

Historical failed runs must be preserved. The old `.github/workflows/axiom-public-inference-do-native-runtime-once.yml` is intentionally manual-only and its job disabled. Do not repeatedly run it to attempt false pass.

## Earned / not earned

- **EARNED (local real workerd):** 403 invalid signature, 204/204/204 bounded reservations, 429 duplicate nonce, 429 cap overflow. Actual run 37998084012; no model calls, no public route.
- **EARNED (provider native, synthetic only):** one Workers AI model inference, run 37976063344; account-native zone/subscription access through existing scoped secret, run 37975739096.
- **EARNED (disabled infrastructure):** isolated route-free Cloudflare staged Worker with AI and SQLite DO bindings, run 37977746857. It is NOT a customer release.
- **NOT PROVEN:** successful deployed remote SQLite DO admission/replay/caps; independent inference-only OIDC issuer and scope; tenant membership/revocation; data consent and privacy; independent billable-overage certification; public canary/accessibility/performance; rollback proof; independent S4 release authorization.
- **D1 constraint:** 11 existing D1 databases against the Free 10-database limit; no deletion, reuse, schema mutation or paid upgrade allowed.

## Only safe next route

Use a separate, approved **isolated Cloudflare Preview with preview-isolated SQLite Durable Objects** or an independently approved nonpublic stage test mechanism. Cloudflare previews can expose preview URLs; preview access must be independently protected and binding isolation proven before use. Require: separately scoped S3 authorization, account-native no-charge proof, exact source/image/worker/bindings/namespace, independent identity/security reviewer, time limit, clean rollback and no customer data. Never repurpose MCP OAuth tokens with the wrong audience/scope. No S4 public promotion until all independent gates pass.

`qualification_mode.mjs` enforces LOCAL_WORKERD_ONLY for automatically admitted zero-cost tests and rejects remote deployments/legacy remote-dev input. It is a local policy guard, not an independent Cloudflare authorization service.

GitHub main drift observed: live main at `bc48ab8aed137e61b76e25f113bb29e1efd7b11a` (Oct 10 separate Phase 2.5B merge), no changes to main from this track. PR #1 is OPEN/DRAFT/UNMERGED.
