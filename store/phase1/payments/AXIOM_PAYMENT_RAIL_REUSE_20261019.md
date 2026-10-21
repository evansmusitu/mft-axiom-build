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

**New isolated callback/status implementation (2026-10-19):** The Store
checkout Worker now imports `store-axiom-payment-routes.mjs` and exposes
`POST /store/billing/webhooks/paynow`,
`GET /store/billing/checkout/{STORE-reference}`, and the advisory browser
return endpoint `GET /store/billing/return`. These routes exist in source
but **are not deployed**. The callback verifies the provider's ordered
SHA-512 response against a separately injected Store secret **before DB
access**. It then looks up an existing Store-only pending checkout,
matches amount and the original trusted Paynow poll URL, makes an independent
HTTPS POST to that URL, validates the second signed Paynow transaction
(including the same provider reference), and records ONLY a review request.
Invalid signature, origin, order, amount, poll response, MIME type, expiry
or unsupported client request fails closed. An authenticated customer can
read only their own Store checkout status; the browser's return URL never
claims payment.

`store-axiom-checkout-schema.sql` now also defines
`store_checkout_reviews`, keyed by checkout reference with UNIQUE provider
transaction reference, SHA-256-only callback/poll evidence and
`review_required` / `refund_review_required` states. The transaction's
review INSERT uses a database compare-and-set requiring the original
pending order and calls `STORE_DB.batch()`, inspecting both result metadata
change counts. This does not issue entitlements, deliver APKs, initiate
refunds or pay publishers. A second identical callback is idempotently
acknowledged; conflicting or late status changes require manual follow-up.
**Production refunds, durable refund event history, recovery, and settlement
are NOT implemented.** Do not apply the Store schema to Axiom D1 or expose
these routes under Axiom's billing route.

**TDD and CI evidence:** Expected RED
`39183410612`: 58 legacy checkout/Paynow tests passed while 8 missing
Store webhook/status/return behaviors failed. Green
`39183745477`: 66 passed. CAS tests then exposed missing atomic
preconditions (RED `39183886991`: 66 passed, 2 failed). Additional
security tests exposed unapproved HTML Paynow replies and late callbacks
(RED `39184227988`: 68 passed, 2 failed). Final green milestone:
`39184303227`: **70 tests passed, 0 failed** with Store SQL parsed by
SQLite and original signed Store V1 source hashes preserved.

**Next production qualification gate:** separately deploy the Store Worker
with its own private `STORE_DB` and Store-secret bindings in test/staging
with `STORE_CHECKOUT_ENABLED=false`, certify callback/return/status
availability, run real Paynow-hosted **test-mode** orders on the separately
approved merchant integration and reconcile provider results. Only then
consider a separately approved first-party paid launch; independent
publisher payouts and paid download entitlements require further policy
and financial controls. Do not trigger Axiom production billing workflows.

**Outstanding next engineering gate:** Store test/staging deployment,
true callback delivery, independently verified real test-mode Paynow
status reconciliation, and operator-approved entitlement policy. Only after physical-device release, support,
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


## Durable checkout write acknowledgement — 2026-10-19

The Store checkout previously issued a successful Paynow browser URL as
soon as the **D1 write promises resolved**, without verifying that the
intended Store order INSERT and initiating→pending transition actually
affected exactly one database row. A D1 result with
`{success:true,meta:{changes:0}}` or without change metadata therefore
could falsely authorize a payment link for an orphaned or cancelled Store
checkout. It did not automatically unlock content, but it could still
expose a checkout link that had no reliably recorded order to reconcile.

The Store now requires **`success===true` and `meta.changes===1`**
for (1) the Store-only intent INSERT **before any Paynow network call**,
and (2) the conditional `status='initiating'→'pending'` UPDATE **before
returning any Paynow payment URL**. Missing, failed, or zero-row D1
results fail closed. A failed post-initiation transition remains a
review/recovery issue rather than a customer-visible payment
authorization; do not automatically retry and create duplicate
provider transactions. No Axiom subscription table or production
billing Worker is modified.

Behavior-first regression: three syntactically valid tests observed
the missing persistence checks fail in isolated GitHub Actions run
`39187226652` (70 passed, three specifically failed for absent D1
row-count enforcement). The corrected worker passed **73/73** synthetic
Paynow/D1-security tests, zero failed, in run
`39187297914`. There was one earlier source-test syntax error run
`39187136017` that was corrected before collecting the behavioral red
evidence; that run is **not** counted as the failing-behavior proof.

This does not establish production D1 provisioning or genuine Paynow
settlement. Cloudflare denied **new Store D1 create** (HTTP 403) during
prior isolated staging work. Production checkout, merchant secrets,
customer entitlements and publisher payouts remain DISABLED.


## Checkout initiation stream-deadline regression (2026-10-19)

The initiating Store Worker previously cleared its Paynow request's
8-second abort timer **as soon as HTTP headers arrived**. A provider
could then stream a byte every 45ms without terminating the response,
keeping the checkout in `initiating` with no terminal customer result.
Unlike a legitimate signed Paynow initiation response, this body could
continue indefinitely without triggering the existing size limit.

The isolated Store checkout now keeps the abort timer active while
reading the bounded 8 KiB response **and verifying the signed reply**.
An overlong trickle is aborted and the customer receives only a
non-authorizing HTTP 502; no Paynow browser URL is exposed, no automatic
entitlement is granted, and the intent remains subject to operator
reconciliation. The timer is cleaned up whether the provider succeeds
or fails. This is not a successful real-money certification or production
provider reachability check.

The behavioral regression failed at the original missing timeout:
GitHub Actions `39187529708` (73 tests passed, one expected behavioral
failure `TEST_STORE_INITIATION_ABSOLUTE_TIMEOUT_MISSING`). The first
post-change test-double implementation had an unrelated rejected-promise
fixture error (`39187616764`); the test double was repaired to use
the response stream controller's error event as an actual fetch abort.
Then exact-source CI `39187703345` passed **74/74**, zero failures.

The Store stage is still **NOT deployed**: a separate Cloudflare
Store-D1 create attempt received HTTP 403 on this account. The staging
provisioning gate must not be bypassed by modifying Axiom's databases or
billing routes. Real payment processing stays disabled.


## Checkout / webhook streaming and host-impersonation hardening (2026-10-19)

The isolated Store payment worker has three additional tested safety controls:

1. **Inbound signed callback deadline.** A client may omit Content-Length
   and stream a partial `application/x-www-form-urlencoded` callback
   indefinitely. The previous `boundedBytes` limited total bytes but
   had no absolute read timeout; an incomplete upload remained pending
   without ever reaching signature validation. Webhook body reading now
   has a maximum **8-second absolute deadline**, returns HTTP 408 on
   timeout, cancels the remaining stream without waiting indefinitely,
   and performs **zero Store D1 or Paynow activity** on failure.
2. **Exact billing-origin enforcement.** The Store checkout and advisory
   browser return previously accepted requests to their path even when
   `Request.url` used an unapproved hostname (the checkout could initiate
   a signed Paynow payment despite coming through such a host).
   The shared worker now rejects every non-`https://payments.mftintelligence.com`
   request **before** financial DB or Paynow use. This is a necessary
   defense against accidentally exposing an alternative Worker hostname,
   but is not sufficient to establish production route/domain ownership.
3. **Bounded customer checkout JSON.** Previously `request.text()`
   buffered the entire untrusted POST body and only afterwards checked
   whether it exceeded 2048 characters. Checkout now streams at most
   **2048 bytes** with an **8-second deadline**, validates declared
   Content-Length, and rejects oversized requests with HTTP 413 before
   Store product lookup, intent write or provider initiation.

Behavior-first red/green evidence: the unbounded callback test failed
`39191281666` (74/75 passed; deliberate timeout assertion failed)
then passed `39191414282` (75/75 passed). The unauthorized-host checkout
test failed `39191513045` (75/76 passed; unexpected HTTP 201) and
passed `39191578024` (76/76 passed). The oversized customer JSON
test failed `39191687390` (76/77 passed; HTTP 400 and all 200 chunks
were consumed), and passed `39191772240` (**77/77** synthetic Store
checkout / webhook / Paynow policy tests; zero failed).

All results use offline synthetic Paynow and mocked D1. The real Cloudflare
Store D1/Worker staging remains **NOT DEPLOYED** due to the prior **HTTP 403
D1-create permission refusal**. No real Paynow merchant key, customer
charge, entitlement or publisher payment was activated. Do not route
Store billing traffic to the existing Axiom subscription endpoints.


## 2026-10-20 — D1 signed-review REPLACE bypass eliminated

The Store's D1 migration originally blocked direct updates and deletes of
`store_checkout_reviews`, and protected the `store_checkout_intents`
reference against `INSERT OR REPLACE`. But the **signed-review table
itself** was still vulnerable: at SQLite's normal
`PRAGMA recursive_triggers=OFF`, `INSERT OR REPLACE` deletes a
conflicting review row internally without necessarily firing the
`BEFORE DELETE` immutable-evidence trigger. During an order's pending
window this could silently replace reviewed callback/poll digests or move
the same Paynow provider reference to another pending Store order.

Two new tests reproduced those precise failures with real SQLite, keeping
the original review row under independent readback:
https://github.com/evansmusitu/mft-axiom-build/actions/runs/39366270764
(expected RED, **2 security tests failing**).

A Store-only D1 `BEFORE INSERT` trigger now rejects any new review
whose checkout reference **or** Paynow provider transaction reference
already exists, including `INSERT OR REPLACE` statements, *before*
SQLite can implicitly delete the prior row. This complements the
existing update/delete immutability triggers and unique constraints.

Verified GREEN:
https://github.com/evansmusitu/mft-axiom-build/actions/runs/39366333945
— **10/10 SQLite state-policy tests, 3/3 staging source-preflight
tests, 77/77 signed Paynow/checkout JS tests, 0 failures**.
The unchanged signed MUSITU Store V1 source hash checks passed.

**Limitations:** D1 schema constraints are not a substitute for
account-authorized database write controls, external settlement records,
durable backup custody or a live Paynow integration. These tests ran
in memory against the Store-specific SQLite-compatible schema, and no
production database or merchant account was modified. The Cloudflare
Store staging 403 and explicit release gates remain outstanding.
