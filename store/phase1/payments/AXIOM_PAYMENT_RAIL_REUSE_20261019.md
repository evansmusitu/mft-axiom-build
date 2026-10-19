# MUSITU Store — reuse the proven Axiom Paynow payment architecture
**Checkpoint:** 2026-10-19. **Scope:** isolated Store V2 draft PR #27, Phase 1 RUNNING. **No production payment activation.**

## Decision: Reuse the EXISTING MFT merchant and Axiom architecture, not Axiom subscriptions

Axiom's actual billing deployment in this repository is described in
`ops/axiom_billing_commercial_enable_v1.py` and
`.github/workflows/axiom-billing-disposable-checkout-e2e.yml`.
Its flow is: authenticated customer token → server-owned product price →
separate durable D1 checkout intent → Paynow SHA512-signed initiate POST →
independently hash-verified Paynow checkout URL → signed callback and independent
provider poll → server-controlled entitlement, only for Axiom subscriptions.

**Critical fact:** Axiom's live payment-signing helper hard-codes
`https://payments.mftintelligence.com/billing/return` and
`https://payments.mftintelligence.com/billing/webhooks/paynow`.
Using it directly for Store sales would send Store payment callbacks to Axiom,
whose code updates Axiom plans, monthly quota and subscriptions. **That is
not acceptable even though the MFT Paynow merchant account is already live.**

## Engineering implemented in the isolated Store branch

`store-axiom-checkout.mjs` mirrors the above proven pattern while
removing cross-product billing coupling:

- Exact Store route `POST /store/billing/checkout` under
  `https://payments.mftintelligence.com`. This route **has not been deployed**.
- `STORE_DB` is a separate D1 binding with Store-specific customer token,
  approved product and checkout-intent tables; no Axiom database writes.
- Only a previously approved, **first-party** Store product (not an Axiom plan)
  can be selected by an authenticated Store customer.
- Merchant secret and integration ID are injected through private runtime
  bindings. The **existing authorized MFT Paynow integration may be reused**
  under permitted merchant scope, but *its secret must be provisioned
  separately* for the Store service. No secret is copied from Axiom source,
  GitHub, logs or client code, and no Axiom production routes are altered.
- SHA512-signs Paynow's documented URL-encoded InitiateTransaction request
  with **Store** `returnurl` and `resulturl`, not Axiom callback URLs.
- Saves an intent **before initiating** the Paynow request; checks Paynow's
  signed response, restricts HTTPS Paynow redirect host, rejects duplicate/
  unknown fields, enforces an 8 KiB streamed response cap and records only
  `payment_status=pending`. Failed initiation remains a recorded review
  matter, not a paid order.
- Every response explicitly carries `entitlement_granted=false`,
  `publisher_payout_authorized=false` and
  `live_money_certified=false`. No automatic digital delivery, Axiom quota,
  refunds, marketplace commission distribution or payout.
- **Default-off**: missing `STORE_CHECKOUT_ENABLED=true`,
  `STORE_FIRST_PARTY_ONLY=true`, **`STORE_CALLBACKS_CERTIFIED=true`**,
  separate D1 binding, Store merchant ID, or Store secret → HTTP 503 and
  no provider calls. A configured MFT key alone never authorizes checkout.
- The SQL in `store-axiom-checkout-schema.sql` is intentionally an
  **empty Store-only migration**. No real products, payment credentials or
  customer tokens are seeded. Do not apply it to Axiom's existing D1.

## Independently verified (synthetic CI, not real money)

Red/green tests in a local Node 22 runtime:
- Deliberately unimplemented worker failed **7/7** behavioral tests.
- Initial implementation passed 7/7.
- A crafted stream without a Content-Length exposed full-response buffering;
  one added security test failed, and bounded streaming then passed **9/9**.

GitHub Actions for the exact isolated branch runs these nine tests alongside
48 existing Paynow verification, private ledger and transport tests.
The workflow also executes the new Store D1 schema in an in-memory SQLite
database and confirms **no Axiom subscription/customer/quota tables or
pre-authorized Store products** are created.

## Why this is not a live Store checkout yet

Axiom's real merchant account historically received live-mode confirmation,
but the **Store-specific HTTPS callback, return, status and independent
provider-confirmation endpoints are NOT deployed**. A customer purchase
cannot be allowed to point to a nonexistent callback; nor may an Axiom
callback process a Store payment. Therefore **do not enable**
`STORE_CHECKOUT_ENABLED` on a publicly accessible worker at this stage.

Unqualified: Store-owned secure secrets, Store-only D1 migration/deployment,
independent callback receipt and Paynow status polling in the *same deployed
Store service*, separate authorized Store product catalog, verified funded
provider transaction, refund/settlement accounting and signed entitlements.
Third-party publisher collections/payouts additionally require a lawful
approved marketplace/seller model; this implementation does not assume that
MFT's first-party merchant status grants that permission.

**Next engineering gate:** isolated Store result callback + authenticated
checkout-status route + signed poll reconciliation + operator-reviewed
entitlement policy. Only after physical-device release, support,
independent publishers, production signing, commercial terms and
owner launch authorization may live customer payments be enabled.

Official provider implementation contract:
- https://developers.paynow.co.zw/docs/paynow/initiate_transaction/
- https://developers.paynow.co.zw/docs/paynow/generating_hash/
- https://developers.paynow.co.zw/docs/paynow/validating_hash/
- https://developers.paynow.co.zw/docs/paynow/status_update/
- https://developers.paynow.co.zw/docs/paynow/polling_status/

**Immutable boundaries:** no changes to protected main, signed Store V1,
Axiom's billing worker, Axiom D1 subscriptions, frozen OpenAI PR #1,
MMF, FMI or other projects. No real money charged.
