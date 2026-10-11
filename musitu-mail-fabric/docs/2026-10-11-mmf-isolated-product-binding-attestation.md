# MMF product-specific Paynow boundary — isolated signed attestation qualification

**Date:** 2026-10-11. **State:** offline synthetic candidate only. **GitHub base:** `b01b8f1b3951ecf6be24c3aa1618773e3a555e69`.

This continuation strengthens isolated, cross-product boundary qualification without adding a merchant route to either existing shared Cloudflare Worker. The previous GET-only Cloudflare inventory reported four **missing** MMF capabilities. This commit does **not** resolve that live infrastructure gap.

## Implementation

- `src/commercial/mmf-isolated-binding-attestation.mjs` checks two independent Ed25519 signatures over canonical bounded stage-only envelopes: one representing the MMF-specific *authority* route/binding contract and one representing the MMF-specific *transport* contract.
- The signatures are generated with ephemeral local **test-only** keys. Neither the test nor product module accesses merchant secrets, live Cloudflare tokens, payment networks or customer records. The public fingerprints provided at the test boundary are not a real trust anchor and **must not** be promoted to production identity claims.
- Role, exact two authority routes, exact single transport route, independent worker names, exact capability labels, independent named token *references*, product `musitu-mail-fabric`, synthetic tenant, expiry, replay nonce, and explicit false finance/mail flags are enforced.
- Claims with an added field (particularly embedded merchant credentials), inherited FMI endpoints, reused signer, invalid signature, expired claims, replayed nonce, wrong tenant or any actual provider operation are rejected. Nonces are recorded together only after both signatures validate. Replay registry in this test is an in-memory `Set` and **is not** an operational distributed replay ledger.
- Successful verification returns `realMerchantProductScopeProven=false`, `cloudflareRoutesVerified=false`, `mayInitiatePayments=false`, `maySendCustomerEmail=false`, `mayMutateSharedWorkers=false`, and `canEnableCommercialLaunch=false` by construction.

The new `MMF Isolated Product-Scope Offline CI` GitHub workflow is bounded to the isolated MMF branch, contains **no secrets**, has repository `contents: read` permission only and **never deploys**. It runs the scoped test, `npm run check`, full `npm test` and the explicitly blocked phase-1 gate. Its presence is not proof it has run; verify the actual workflow job and commit SHA before claiming GitHub CI green.

## Blocking dependencies

1. Read-only Cloudflare source/settings inventory must be refreshed by authorized GET-only workflow; none was run in this local qualification. The original audit's legacy raw SHA baseline is not directly comparable to multipart-normalized output.
2. A **separately authorized** future change to two shared payment Workers would be needed for genuine MMF-specific private routes and named bindings; this offline implementation does not modify those Workers or their real secrets.
3. Independent cryptographic/provider tests, genuine product merchant scope, legal terms, payer consent, bank settlement and dual release approval remain unproven.
4. The USD 99 readiness SKU remains an unapproved proposal. No real Paynow initiation, paid invoice, refund, external customer email or commercial activation is permitted by this result.