# MUSITU Mail Fabric — dark isolated billing intake Worker

Date: 2026-10-11. **Engineering stage only. NOT live payments, NOT a billable MMF service, NOT a customer-facing application.**

## Current verified boundary

The MUSITU Paynow merchant, shared authority `mft-phase8-external-authority`, shared transport `mft-paynow-transport-gateway`, and FMI-only product worker `mft-fmi-billing` were authentically inspected READ-ONLY on 2026-10-11, GitHub Actions run `38118420154`. The source hashes and credentials' *binding names* are recorded in `2026-10-11-paynow-real-authority-readonly.json`. No MMF bridge credential/route was observed. No second merchant registration is needed, but that does not make the existing FMI/Chemistry customer checkout an MMF checkout.

## New isolated code

The `src/commercial/billing-stage-worker.mjs` has two **private** authenticated stage routes only:

- `POST /v1/billing/stage/orders` — JSON `{"customerReference":"customer:allowed:001","contractReference":"contract:approved:123","orderReference":"MMF-AAAABBBBCCCDD"}`. Server reconstructs the fixed MMF **proposed** one-time USD 99 quote using its configured tenant ID and writes a pending order to its **own** `MMF_PAYMENT_DB` database; it cannot create a Paynow checkout. HTTP 201 for new, 200 for idempotent same quote, 503 for conflicting reference. No raw payment credentials.
- `GET /v1/billing/stage/orders/MMF-AAAABBBBCCCDD` — tenant-specific pending status, not money settlement. Any source of `PAID_SANDBOX` is explicitly synthetic and is NOT a real-money payment or invoice.

All routes require a separate runtime-provisioned `MMF_BILLING_OPERATOR_TOKEN` (min 32 chars, distinct from customer and operator tokens) and EXACT stage runtime locks: `MMF_STAGE_ONLY=true`, `MMF_REAL_SEND_ENABLED=false`, `MMF_MAIL_SENDING_ENABLED=false`, `MMF_COMMERCE_ENABLED=false`, `MMF_BILLING_API_ENABLED=true`; D1 binding `MMF_PAYMENT_DB` and a valid configured tenant are required. No token means HTTP 503. No public GET/catalog, checkout, payment callback, settlement mutation or customer mail routes exist. Request bodies are byte-limited and structural validation is exact. Returned errors are redacted, and state is no-store.

`wrangler.mmf.billing-stage.template.jsonc` has **workers_dev=false**, **routes=[]**, a fresh MMF-only D1 ID placeholder, no connection to existing shared payment services, no production merchant secret, and no token in version control. This is a **template** and deliberately cannot deploy as provided. The owner must supply new isolated D1 and operator secret in the runtime, only under separate approval. Never point `MMF_PAYMENT_DB` to FMI's D1 database.

## Tests and boundaries

Run `node --test test/mmf-billing-stage-worker.test.mjs test/mmf-billing-stage-config.test.mjs test/mmf-payment-order-ledger.test.mjs` then `npm run check && npm test`. Tests include closed release flags, independent bearer credentials, strict order inputs, immutability, per-tenant access, replay, database failure redaction, a distinct D1 template, and no live money.

**Not complete yet:** A separate MMF-specific Paynow authority signature+transport path must be deployed, security independently assessed, merchant product use and seller legal/tax status reviewed, provider settlements validated in the actual MMF D1 ledger, refund and webhook duplication guarded, and a real consented test checkout independently approved. Existing provider secrets remain on the old shared workers and must not be copied to MMF, GitHub or browser.

**No production resources, protected branches, domains, customer mail or financial transactions were modified by implementing this stage.**
