# MUSITU Store Phase 1 — Paynow commercial payment review boundary

**Status: PRIVATE OFFLINE PROTOTYPE ONLY. No Paynow merchant connected; no money
has moved, no customer purchase was made, and no payment/refund/settlement
or entitlement is authorized.**

The standalone `paynow-review.mjs` implements a narrow, testable proof that
an incoming Paynow-style `application/x-www-form-urlencoded` status can be
bound to an independently trusted merchant order. It follows Paynow's
documented field-order/URL-decoding/UTF-8/SHA512-uppercase verification:
- https://developers.paynow.co.zw/docs/paynow/generating_hash/
- https://developers.paynow.co.zw/docs/paynow/validating_hash/
- https://developers.paynow.co.zw/docs/paynow/status_update/
- https://developers.paynow.co.zw/docs/paynow/polling_status/

Security properties checked: constant-time hash comparison; exact amount
as a **string with two decimal places**, no floating-point money; unique
case-insensitive fields; UTF-8 and encoding validation; bound known merchant
reference, Paynow transaction reference and Paynow-hosted exact poll URL;
strict allowlisting; refusal of unexpected payment instrument/tokenization
fields or unsafe URLs. The caller must supply an independently provisioned
merchant key and previously authenticated order details. Do not let the
customer supply merchant keys or expected amounts.

**Payment handling policy:** A notification, redirect, or signed `Paid`
callback **is not sufficient** to unlock paid applications. To reach even
`PAYMENT_CONFIRMED_REVIEW_REQUIRED`, the caller must obtain a second signed
status through an independently authenticated Paynow polling operation and
match the same order and provider transaction. This module does not itself
make a network poll or establish that the supplied polled message was
genuinely retrieved: the transport and its auditing are a separate
requirement. No idempotency, durable accounting, refund workflow, settlement
reconciliation, chargeback handling, signed entitlement authority or secure
webhook delivery endpoint exists here. Even a matched pair still returns
`entitlementGranted=false`, `publisherSettlementAuthorized=false`, and
`refundFinalized=false`. Disputed, refunded, pending and cancelled
statuses always hold for review.

**Provider prerequisites that cannot be fabricated:** MUSITU needs a
lawfully approved Paynow merchant profile, verified beneficiary,
integration ID/key stored outside source code, authorized result and return
URLs, live provider status polling, webhook authenticity and idempotency
storage, actual funded purchases/refunds with independent bank/merchant
settlement reconciliation, consumer protection/transaction records, and
written commercial payout terms with genuine third-party publishers.
Paynow's official docs say to obtain an integration ID and key first:
https://developers.paynow.co.zw/docs/paynow/quickstart/

The 14 tests are synthetic and offline. They use a disposable test-only key;
never place a real merchant secret, payment token, phone or customer details
in a GitHub commit, CI trace or local public artifact.

```sh
node --test store/phase1/payments/paynow-review.test.mjs
```

**Rollout gate:** This isolated boundary must not be connected to the
published MUSITU Store until a reviewed real provider adapter, independently
signed/persisted entitlements, honest charge/refund accounting, monitoring and
explicit owner release authorization are verified. Phase 1 remains RUNNING.
