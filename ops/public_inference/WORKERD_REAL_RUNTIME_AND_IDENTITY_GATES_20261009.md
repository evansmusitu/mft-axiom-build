# AXIOM public inference continuation — Free plan, 2026-10-09

## Earned

- Existing Cloudflare scoped token: read-only account, zone and subscription evidence PASS (GitHub Actions 37975739096).
- One genuine Workers AI synthetic model call PASS (37976063344).
- Isolated deployed Worker with Workers AI and SQLite Durable Object bindings, no public routes, disabled customer access (37977746857).
- Isolated demo Worker deploy/readback/delete rollback PASS (37977530905).
- **Local workerd SQLite Durable Object 6-request contract PASS**: bad HMAC 403, three admissions 204, replay 429, fourth request 429 (37998084012).
- Pinned local workerd supports compatibility date 2026-07-01, not 2026-09-15 or 2026-10-09. Preserve startup failures.

## Verified architectural limitation

Official Cloudflare docs (developers.cloudflare.com/durable-objects/reference/environments/) say legacy remote development is not supported by SQLite-backed Durable Objects. Runs 37985883645, 37986018199, 37986231751 and 37986439660 **FAILED**. Do not re-label these failures as PASS, nor repeatedly retry remote mode. A local workerd PASS is not equivalent to live Cloudflare-network Durable Object PASS.

Cloudflare Preview URLs are public by default (developers.cloudflare.com/workers/previews/). To exercise the live deployed Durable Object, an independently approved test must first establish a separate, identity-protected test endpoint or another bounded nonpublic invocation method. Do not use an unprotected Preview URL as a shortcut.

## Independent identity authority gap

The existing OAuth worker's current code fixes default resource to `https://mcp.mftintelligence.com` and scopes to `axiom.execute`, `billing.read`, `billing.write`, `openid` and `email`. It does not define `axiom.inference`. Its bearer tokens are **not** authorization to send customer prompts to a third-party inference provider. Do not change the frozen OpenAI OAuth service. Define a separately governed inference audience/scope, explicit external-processing consent and a revocable independent capability issuer in isolation before enabling the customer route.

## Gates remaining (fail closed)

Independent inference identity issuer, server-side customer terms/privacy processing evidence, native cloud DO transaction proof, security/adversarial/abuse tests, real fail-closed billing hard stop, full rollback/canary, and independent S4 public release. None is silently satisfied by user pressure or builder self-certification. **Customers remain disabled.**

**Zero-cash budget USD 0.00.** Keep main, PR #1, sealed authority, other AXIOM phases, production and frozen OpenAI submission unchanged.
