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

## Operator-private durable payment-review evidence (isolated Phase 1)

`paynow-review-ledger.mjs` now offers
`recordPaynowReviewEvent({ledgerDirectory,callbackBody,polledBody,integrationKey,order})`
to record **private review evidence only** after the existing SHA-512
signed callback **and** separately supplied provider-polled status both
pass verification against an operator-authenticated merchant order.

The caller must provide an independently authenticated, audited provider
poll; this offline module **does not establish or perform that transport**.
A malicious caller who can forge the `polledBody`, order, or key defeats
the external trust boundary. No live Paynow account or production
credentials are connected.

A Linux owner-controlled 0700 directory stores per-order, canonical
0600 evidence, named by SHA-256 of a domain-separated merchant order
reference. A single exclusive transaction lock, no-follow reads, safe
filesystem ownership/permissions, atomic pending-to-committed rename,
file fsync and directory fsync prevent normal concurrent writers
overwriting review history. Existing ledger symlinks **including dangling
symlinks**, corrupt/noncanonical state, stale locks and interrupted
pending writes fail closed for human investigation rather than silently
resetting payment history. Pending entries cannot be automatically
recovered or cleared. Repeated **identical signed events** are idempotent;
provider-transaction identity conflicts are rejected. A later refund,
dispute, cancellation or any unconfirmed status permanently locks the
review status against automatic recovery by a subsequent Paid event.
At 100 events per order, new entries require independent manual
resolution. No raw callback, provider URL, merchant key, bank data or
payment instrument is persisted by this module.

The returned `REVIEW_RECORDED_PRIVATE_ONLY` status **never authorizes**
paid-content downloads, publisher payout, actual refund completion or
settlement. In every outcome:
`entitlementGranted=false`,
`publisherSettlementAuthorized=false`,
`refundFinalized=false`.
The ledger is not a general financial database, does **not** guarantee
exactly-once monetary transfers, and cannot withstand whole-filesystem
rollback or compromise of the trusted OS user. Multi-node ledger
coordination, independent signed audit backup, merchant bank settlement,
live provider polling and actual commerce integration are still release
blockers. Do not deploy this test-only ledger as a customer webhook.

Test command:

```sh
node --test store/phase1/payments/paynow-review.test.mjs \
  store/phase1/payments/paynow-review-ledger.test.mjs
```

**TDD evidence:** original empty ledger behavior failed 10 focused tests,
GitHub Actions run `39167961779`; the genuine dangling-symlink
regression independently failed in run `39168207577` and passed after
the no-follow directory-entry fix. Final reviewed code qualified
25/25 tests in run `39168260433`. All tests use a *synthetic* merchant
key, synthetic order and synthetic signed messages with no external
network or money.

## Server-initiated independent Paynow polling boundary

`paynow-provider-poll.mjs` now exposes
`pollAndRecordPaynowReviewEvent({ledgerDirectory,callbackBody,integrationKey,order})`
for a **trusted private merchant operator process only**. It first validates
the Paynow SHA-512-signed callback against an independently authenticated
merchant order and merchant integration key, **before any network egress**.
Then it performs Paynow's documented **empty HTTPS POST** to the exact
previously trusted Paynow transaction poll URL
(`www.paynow.co.zw/Interface/CheckPayment/?guid=...`); it never makes a
customer-specified request to arbitrary hosts. Native Node.js HTTPS
requires a valid TLS certificate for the fixed Paynow server name.

The outbound request carries **no integration key, contact details or
payment instrument**. The response is bounded to 12 KiB and 8 seconds;
redirects, non-200 statuses, unexpected content type, malformed payloads,
invalid provider signature, different merchant reference, amount,
transaction ID or poll URL **fail closed without changing the payment
review journal**. An accepted response is independently signature-checked
again by the pre-existing private review ledger, which returns only
`REVIEW_RECORDED_PRIVATE_ONLY` and explicitly denies entitlement,
refund and settlement authority. This code does not initiate charges,
publish downloads, process actual refunds, operate a public webhook,
or connect an authorized Paynow merchant account.

The `requestImpl` argument exists **solely for CI transport test doubles**
and is rejected unless `CI=true`. The 9 transport tests use synthetic
signed messages, fake HTTPS responses and a disposable private ledger; they
do not contact Paynow, verify live production connectivity or demonstrate
real fund transfers. The caller must securely supply a genuine Paynow
integration key and order obtained from authenticated merchant storage,
and run the component behind its own protected backend. Neither that
backend nor a genuine merchant profile is deployed in this branch.

Official Paynow protocol source:
https://developers.paynow.co.zw/docs/paynow/polling_status/

Run the transport regression and existing payment policy suite:

```sh
CI=true node --test \
  store/phase1/payments/paynow-review.test.mjs \
  store/phase1/payments/paynow-review-ledger.test.mjs \
  store/phase1/payments/paynow-provider-poll.test.mjs
```

Release gates: merchant KYC and account connection, secure credential custody,
authenticated durable order database, real HTTPS deployment and event
idempotency across instances, legitimate sandbox and live provider calls,
reconciled real purchase/refund/settlement, legal consumer agreements and
explicit separate release approval all remain unqualified. This transport
alone cannot unlock applications or mark a payment settled.

## Cross-order provider transaction claim (Phase-1 review-only hardening)

`paynow-review-ledger.mjs` additionally reserves each *signed Paynow
provider transaction reference* with a unique,
SHA-256-domain-separated `provider-<digest>.json` claim in the **same
operator-private local ledger directory**. The provider reference comes from
the two validated Paynow status messages, not from the frontend. A
per-provider immutable owner-only file is created with exclusive
`O_CREAT|O_EXCL` before committing the first per-order review record;
the file and containing directory are fsynced. This ensures two different
merchant order references cannot simultaneously use one signed provider
transaction in a shared, local, correctly owned directory.

A second order claiming an already-reserved provider reference is denied.
If a provider claim exists but its corresponding order journal is missing,
processing stops for manual investigation (it cannot silently initialize
new history). An unexpected, corrupted, symlinked or unreadable provider
claim also blocks the transaction. Identical signed-event retries for the
correct existing order remain idempotent. A failed operation between
claim reservation and order-journal commit may intentionally strand a claim;
**never automatically delete it** to chase availability.

**This is not a production globally unique payment database.** There is
no global provider-transaction registry across machines, tenants or
backups; a complete filesystem rollback, privileged file tampering and
lost/duplicated independent ledger copies remain unresolved. Legacy order
journals created before the provider-claim index **must be independently
reconciled and migrated** before they participate in any commercial
entitlement workflow. The index makes no monetary transfers and cannot
prevent provider-side chargebacks. Real purchase/refund settlement
and independent financial controls remain required before launch.

Red-green evidence: original contract (three new security cases) failed
because another merchant order could reuse a provider transaction and a
deleted journal could restart, GitHub Actions run `39173541171`.
The new reservation scheme preserves independent provider identity and
fails closed on missing order history. Final regression in run
`39173772545` passed **37/37 total payment tests**. All provider
references, keys and transactions are synthetic CI fixtures.
