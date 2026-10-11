# MMF-specific Paynow authority / transport product-scope preflight

**Date:** 2026-10-11 · **State:** isolated/offline candidate. This does not create any live Paynow merchant authority, product-specific route, payment initiation, banking settlement, invoice, customer-mail entitlement, or Cloudflare deployment.

## Verified input

The authoritative whole-product handoff at `df71996aebd6b66165b845cc18adcc716dec51c4` and latest scoped Cloudflare GET-only evidence report **four missing MMF capabilities**:

1. `MMF_AUTHORITY_PRODUCT_ROUTES`: private `/internal/paynow/sign-initiate-mmf` and `/internal/paynow/verify-callback-mmf` in existing authority Worker `mft-phase8-external-authority`.
2. `MMF_AUTHORITY_PRODUCT_TOKEN`: an MMF-only bridge credential reference `MMF_AUTHORITY_BRIDGE_TOKEN` whose actual value remains outside GitHub/code/fixtures.
3. `MMF_TRANSPORT_PRODUCT_TOKEN`: MMF-only transport reference `MMF_TRANSPORT_BRIDGE_TOKEN` isolated from FMI/Axiom/Chemistry credentials.
4. `MMF_TRANSPORT_PRODUCT_ROUTE`: private `/internal/paynow/initiate-mmf` in existing transport Worker `mft-paynow-transport-gateway`.

The latest source inspection normalized Cloudflare multipart representations; raw old source hashes cannot prove drift. The live Cloudflare evidence from the handoff is a sanitized inventory, **not a signed code-level proof of permissions**.

## What was built in isolation

`src/commercial/mmf-product-scope-preflight.mjs` defines a *data-only* pinned candidate integration contract, validates every field against a closed schema (no merchant key, no token values, no cross-product aliases), and refuses incomplete or unsafe read-only inventory metadata. Its result **always** denies real payments, shared Worker edits, customer emails and commercial eligibility even if an inventory later reports all four capabilities present. Zero `fetch()`/provider/Cloudflare calls exist in this module.

`test/mmf-product-scope-preflight.test.mjs` tests the four observed missing capabilities, a fabricated fully-present inventory that still cannot release production, strict legacy-product segregation, route and token-binder substitution, accidental raw merchant-key injection, false positive authority claims, incomplete evidence, and unsafe Cloudflare mutation flags. The test fixture contains only sanitized capability booleans copied from the handoff, not production secrets, customer records or live endpoint assertions.

The contract is preparation for a future **separately authorized** scoped implementation in existing merchant authority/transport infrastructure; no shared Worker was changed. Existing private MMF two-Worker synthetic stage remains a distinct, signed, non-financial test path. The speculative USD 99 readiness SKU is not a payable/approved offer.

## Required next work, no automatic promotion

- Independent audit of real authority/transport source semantics and no regression to FMI, Chemistry, Axiom, or their merchant authority.
- Explicit operator approval of named MMF-specific route and secret custody changes before touching shared Workers; separately test existing routes.
- Real isolated merchant-scope entitlement, cryptographic callback verification and independent signed Paynow status polling under approved provider terms, with distinct MMF audit trails.
- Real payment initiation only after separate user authorization, consent from an actual payer, provider authorization, operational/legal/tax review and two-party release; Paynow `Paid` does not by itself prove bank settlement.
- Real customer-mail outbox and signed provider feedback reconciliation require separate approval and qualification; synthetic `paid_sandbox` grants no email rights.

**Commands:** `node --test test/mmf-product-scope-preflight.test.mjs`; `npm run check`; `npm test`; `npm run check:phase1` (expected BLOCKED exit 2).