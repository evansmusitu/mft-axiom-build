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

## Next isolated qualification: reversible sandbox payment evidence (2026-10-11)

`src/commercial/fmi-paynow-reuse.mjs` now specifies an **UNDEPLOYED CANDIDATE** MMF-only reversal-receipt format (`mmf-paynow-reversal-v1`). The actual Cloudflare merchant authority has **not** been modified to issue these signatures. It accepts an exact scoped schema and an externally configured, SHA-256-SPKI-fingerprint-pinned Ed25519 signature; reversal claims have to match the preceding paid record's provider-reference hash and original-settlement timestamp. Tests use fresh ephemeral test keys only.

`src/commercial/mmf-order-ledger.mjs` extends the separate stage-only D1 schema from `PENDING` to `PAID_SANDBOX` to `REVERSED_SANDBOX` with an atomic, idempotent reverse transition and one provider reference per order. Refund and chargeback reasons are supported as an offline contract; contradictory or cross-order reversals are rejected, and a duplicate paid event cannot resurrect a reversed order. The dark-stage HTTP GET renders `REVERSED_SANDBOX` without granting email privileges. **There is NO HTTP refund endpoint**; no actual Paynow refund/chargeback is submitted, observed, or certified by this stage.

Observed red–green TDD: focused `test/mmf-payment-reversal-lifecycle.test.mjs` failed 6 cases with `MMF_REVERSAL_NOT_IMPLEMENTED`, then passed all 6 after implementing the minimum stage state machine. Full local test output: 278 tests, 277 pass, 0 fail, 1 skip (`npm test`); `npm run check` exits 0. Pending an independent Paynow service-contract audit and a dedicated product-scoped authority, even this validated offline reversal protocol **MUST NOT** be enabled on any live commerce surface. Treat this as payment lifecycle **pre-production software**, not a merchant integration, settlement evidence, financial authorization or an externally qualified product.
