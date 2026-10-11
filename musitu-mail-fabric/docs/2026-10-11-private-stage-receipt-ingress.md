# MUSITU Mail Fabric — isolated private receipt lifecycle qualification

**Status:** local and CI simulated proof ONLY. No production Worker deployed.
No Paynow initiation or settlement, mail delivery, real refund, live merchant
key, signed real Paynow receipt, bank deposit or tax invoice has been proven.

## Why this was added

The prior isolated Paynow native SHA-512 parser, callback + independent poll
candidate, Ed25519 receipt verification, and MMF-only SQLite ledger were each
tested. The MMF private billing Worker exposed pending-order creation and read,
but **had no private receipt-ingestion endpoint connecting that verifier to
durable MMF order state**. That concrete interface gap is now covered in the
**stage-only** Worker, with actual SQLite-backed HTTP regression tests.

## Exact stage contract

`POST /v1/billing/stage/orders` uses `MMF_BILLING_OPERATOR_TOKEN`; strict
body consists of `customerReference`, `contractReference`, `orderReference`.
This stores `PENDING` and a SHA-256 of the immutable MMF-only quote.

`POST /v1/billing/stage/evidence` uses a **different**
`MMF_STAGE_RECEIPT_TOKEN` and is disabled by default. Strict JSON body
consists of the same three quoted fields **plus** `receipt` holding exactly
`{claim, signature}`. The `claim` is a strictly canonical MMF-only Ed25519
settlement or reversal evidence document. Its public signing key is bound
**solely in private Worker environment configuration** by both
`MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM` and matching
`MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256`. The key is not accepted in HTTP body.
All proof details must be matched against the existing immutable quote and
MMF tenant identity. The caller cannot submit its own price, product, billing
account or paid status. Unverified receipt or incorrect tenant/contract/replay
returns failure. The stored states are explicitly `PAID_SANDBOX` or `REVERSED_SANDBOX`;
the HTTP stage responses identify these as `SANDBOX_SETTLEMENT_RECORD_ONLY`
and `REVERSED_SANDBOX`, respectively. They do not enable customer charges or mail. Duplicate
identical receipts are idempotent; `REVERSED_SANDBOX` cannot become paid again.
No cardholder data, merchant key, provider reference in cleartext, or
private signing key is persisted in the MMF stage ledger.

`GET /v1/billing/stage/orders/:reference` continues to use the ordinary
operator credential and reports only the stage state without invoices,
customer payment entitlement, mail sending or provider settlement.

## Mandatory non-live locks

The Worker **always** requires `MMF_STAGE_ONLY=true`,
`MMF_REAL_SEND_ENABLED=false`, `MMF_MAIL_SENDING_ENABLED=false`,
`MMF_COMMERCE_ENABLED=false`, and a separate MMF-only D1 binding. In
addition, evidence intake requires `MMF_STAGE_RECEIPTS_ENABLED=true`,
an independent private receipt operator token, and an Ed25519 public-key
fingerprint pair. The shipping Wrangler template keeps receipt intake
**false** and `workers_dev=false`, no public routes. Stage receipt intake
**must not be exposed** by adding public routes. All test signers and payment
status payloads are ephemeral, not real provider evidence.

## Production gates still open

- Approve lawful vendor/merchant/tax invoice identity and customer scope.
- Independently qualify product-scoped Paynow authority/transport bindings
  without mutating or borrowing FMI/Axiom/Chemistry product permissions.
- Qualify a real consenting-payer MMF provider initiation, callback,
  independent poll, real settlement, refund/chargeback, and operational
  recovery with an independent assessor.
- Deploy a fresh MMF-only database, separate private Worker, protected key
  lifecycle/restore, bounded rate limits and independent security review.
- Separately prove genuine MMF outbox -> Resend signed feedback reconciliation
  and obtain explicit approval before any customer-facing message sending.

Local tests: `npm run test:stage-receipts`, `npm test`, `npm run check`
(all network-free). This work does not claim commercial Phase 1 completion.
