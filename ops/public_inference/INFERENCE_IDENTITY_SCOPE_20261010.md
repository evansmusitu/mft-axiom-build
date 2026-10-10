# AXIOM inference: identity-bound customer entry — isolated candidate (2026-10-10)

**Public customers: DISABLED. Independent S4 release: NOT EARNED. Cash budget: USD 0.00.**

This candidate adds a separate, verify-only **RS256 inference-audience JWT** boundary before existing exact-body signed S2 capability admission. The trust material (`issuer`, `audience`, pinned public JWKS) must be supplied by an independent identity authority. The code cannot mint identities, HMAC capabilities, consent assertions, admin credentials, or provider access.

## What the new entry point enforces

- Exact trusted issuer and exact inference-only audience from independent server-side policy.
- Single scope `axiom.inference`. Existing frozen MCP tokens (`axiom.execute` and MCP audience) are rejected rather than silently repurposed.
- RS256 only, pinned public JWKS, no private keys or dynamic user-supplied JWKS, bounded token lifetime.
- Identity subject must match the independently signed exact-request S2 capability subject. Any mismatch denies delegation.
- Bounded request body (5,000 bytes), sanitized errors and a disabled-only health response.
- `customer_entry_worker.mjs` is **opt-in source**, not deployed as a Cloudflare Worker, not publicly routed, and not a release authorization.

## What the code does NOT establish

- There is NO live trusted inference issuer, no approved actual JWKS, no verified real user/customer authentication.
- There is NO independent consent and privacy/legal proof, tenant membership grant, per-token revocation or provider billing hard-stop certification.
- This code does not make public inference safe. It must be independently red-teamed, integrated into a genuine identity authority, tested against live workers/Durable Objects, canaried and released under independent S4 authorization.

## Live project state reconciled before this change

The live isolated branch advanced materially beyond the earlier Oct 9 first probe. Newer verified provider-native evidence:
- Scoped GitHub secret `CLOUDFLARE_API_TOKEN` uses Bearer and works; the older Global API Key route failed HTTP 403 / 9103.
- Native Cloudflare account read and one **synthetic** GLM-4.7-Flash inference passed.
- Workers Free was supported by native subscription records; zero-billing-overage independence is **NOT CERTIFIED**.
- D1 account already has 11 databases versus the 10 database Free limit; DO/SQLite used as isolated candidate instead. No DB deletion permitted.
- Disabled route-free stage with AI and DO bindings exists.
- Local workerd DO quota test passed; Cloudflare live-network DO atomic admission remains NOT PROVEN.
- `main`, PR #1, production and frozen OpenAI reviewer service must remain untouched.

## Verification

`node --test inference_identity.test.mjs customer_entry.test.mjs` => 10/10 passed locally.
A separate combined offline regression, composed of the Oct 9 frozen handoff's 29 tests and the 10 new identity tests, returned 39/39 PASS. That combined suite is NOT a fresh execution of all files at the current GitHub head.
No externally billed cloud calls, customer requests or production releases were performed.

## Next qualification gates

1. Separate identity/security owner selects a verified inference issuer + exact audience `axiom.inference`, publishes JWKS, and implements revocation, tenant membership and consent.
2. Independently approve test-only exposure method (Cloudflare Access-protected or equivalent) to verify native deployed DO quota; never expose an unprotected Preview URL.
3. Verify Free billing hard-stop, provider processing terms, real durable quota replay/adversarial tests, rollback proof, customer auth and S4 release.
4. Only then opt in to `customer_entry_worker.mjs` in a separately authorized staging/release change. Builders never self-certify.

This is ENGINEERING IMPLEMENTATION ONLY and does not change earned qualification gates.
