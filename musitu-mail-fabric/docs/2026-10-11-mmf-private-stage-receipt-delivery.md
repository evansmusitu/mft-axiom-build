# MMF — private authority-to-stage receipt delivery candidate

**STATUS: UNDEPLOYED, OFFLINE QUALIFICATION ONLY. No real payment, customer
mail, invoice, settlement or production Worker has been exercised.**

## Missing interface closed

The existing isolated payment authority candidate verified signed Paynow
callback and independently polled status, then produced an Ed25519-signed MMF
receipt. The MMF stage Worker separately verified and stored those receipts,
but no private delivery adapter connected the two. The module
`src/commercial/paynow-private-stage-bridge.mjs` provides that seam with a
single preconfigured **Cloudflare service-binding fetch** — no global fetch,
user URL or Paynow initiation.

### Stage-only authority-side environment contract

The candidate needs an MMF-scoped private Cloudflare `MMF_PRIVATE_PAYMENT_STAGE`
service binding, `MMF_STAGE_BRIDGE_ENABLED=true`, `MMF_STAGE_ONLY=true`,
`MMF_COMMERCE_ENABLED=false`, `MMF_REAL_SEND_ENABLED=false`,
`MMF_MAIL_SENDING_ENABLED=false`, `MMF_BILLING_API_ENABLED=true`,
`MMF_STAGE_RECEIPTS_ENABLED=true`, and API/webhook exposure disabled. Separate
secret `MMF_STAGE_RECEIPT_TOKEN` must be at least 32 characters and distinct
from any stage order operator/customer token. Authority identity is pinned via
`MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM` and
`MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256`. All secrets are configured privately;
**none** belong in a Wrangler vars block or repo.

The private stage Worker itself remains separately deployed *only after*
explicit staging approval, on an isolated MMF-only D1. Its Wrangler template
remains `workers_dev=false`, `routes=[]` and payment/receipt intake disabled
by default. **Do not attach this candidate to any existing production
Paynow authority, FMI billing, Axiom or Chemistry Worker.**

### Invariants

- The caller passes an exact server-derived MMF quote and a canonical Ed25519
  signed receipt; the adapter independently checks the signature, key pin,
  product/tenant/order/contract/price, timestamp and non-commerce flags
  **before** sending any request.
- The only request is `POST /v1/billing/stage/evidence` across
  `MMF_PRIVATE_PAYMENT_STAGE.fetch`, with a distinct bearer token and a
  bounded JSON body. External fetch and client-specified destinations are
  impossible from this interface.
- A returned 200 response is **not enough**: JSON must be size-bounded,
  match the exact order, carry the expected sandbox state, and explicitly deny
  money collection, tax invoices, live settlement and mail sending.
- The distinct stage Worker verifies the signed receipt *again* and applies
  the atomic D1 order transitions. Identical receipt repeats are idempotent;
  paid-after-refund replay is rejected.
- No customer, payment instrument/cardholder, Paynow merchant key, raw provider
  reference or signing private key is stored by the MMF stage database.
- Any transport, parsing, signature, pin, contract or state violation fails
  closed with a generic error; the caller must not treat an uncertain result
  as an invoice or new entitlement.

### Actual evidence and outstanding gates

The mock Cloudflare binding in `test/mmf-private-service-receipt-bridge.test.mjs`
invokes the actual MMF stage Worker and SQLite-backed ledger end-to-end,
including signed Paid, replay, signed Refunded and non-resurrection, failure
injection, forged receipt, cross-product and forbidden configuration. Tests
run offline. A service binding is **not** configured on the live shared
Paynow Worker and the existing merchant tokens remain unchanged.

Before **real** payment qualification: independent legal seller/invoice
identity, approved MMF SKU pricing, MMF-only authority credentials and routes,
private binding isolation, real Paynow callback plus independent real poll,
consenting payer, genuine settlement/chargeback checks, new D1 backups and
recovery, an independent security assessor, and explicit customer delivery
release authorization remain necessary. No synthetic evidence may be
presented as proof that these external gates passed.
