# Reuse MUSITU FMI Paynow payment path for MUSITU Mail Fabric

Date: 2026-10-11. Classification: inspected integration authority and isolated implementation contract; no live charges or production deployment.

## Verified lineage (not an instruction to reopen a merchant account)

- Existing MUSITU Paynow integration ID **26343** and server-owned merchant credentials belong to the pre-existing MUSITU payment stack. Never publish integration keys or an API secret.
- Existing shared Cloudflare payment components: `mft-phase8-external-authority` (authenticated server-priced payment authority) and `mft-paynow-transport-gateway` (Paynow transport). FMI product-specific isolated billing component: `mft-fmi-billing`. FMI public edge had service binding `FMI_BILLING`; its exact FMI plans are FOUNDING at USD 49 / 30 days and PRO at USD 149 / 30 days.
- Prior FMI checkout reference `FMI-MTYO41LA-CD6240DEB118` demonstrated a Paynow-created checkout, not a certified settled FMI fee. FMI user FREE/paid status must not be inferred from that pending flow.
- A separate actual real-money E2E certification for MUSITU AXIOM appears in repo `evansmusitu/mft-axiom-build`, branch `fmi-revenue-certification-20260913`, file `docs/MUSITU_AXIOM_REAL_MONEY_E2E_CERTIFICATION_20260913.json`: USD 19 / paid / one activated and metered entitlement, under strict idempotent settlement verification. Different product, **not MMF revenue**.
- Chemistry later reused these same shared payment authority/transport components with an **isolated product catalog and entitlement logic** at `payments.mftintelligence.com/chemistry/*`. Its dedicated product handler is the architectural precedent, **not an MMF payment route**. See repo branch `chemistry-commerce-live-20260906` workflow `chemistry-commerce-live-deploy.yml`.

## Implemented in MMF isolated branch

`src/commercial/fmi-paynow-reuse.mjs` captures the actual two shared service names and distinguishes FMI-only billing. It offers a strict MMF-only draft for a separately reviewed one-time USD 99 readiness assessment, an exact-host official Paynow checkout URL validation, and an Ed25519 SPKI/SHA-256-fingerprint-pinned verification **contract** for a future MMF-specific authoritative settlement attestation. This attestation is *new*, not claimed to be currently supported by the existing Phase-8 authority; its production bridge must be verified separately.

No old FMI subscriptions can settle MMF. No raw Paynow key enters MMF. The implementation refuses to enable sending or payment initiation even if runtime flags are set. All tests are offline, with synthetic keys/claims. No browser-paid status, redirect callback, or unrelated provider payment can create a paid service state.

## Required before live MMF customer payment

1. Independently establish the currently live shared authority/transport version, merchant eligibility for the MMF service, and exact integration contract. This environment cannot reach Cloudflare/Paynow live management or read current secrets; historical repo proof cannot substitute current readback.
2. Approve legal seller identity, proper tax invoice and the exact MMF one-time SKU/price and customer contract. No unsolicited payment link.
3. Create a **new isolated MMF-specific product billing bridge** that uses existing shared Cloudflare service bindings to authority and transport, with isolated tenancy/DB and pending/paid/cancelled state. No modification to FMI customers, existing checkout handlers, product subscriptions or customer entitlements.
4. Implement an **actually supported and independently verified** signed-settlement evidence endpoint/receipt. If the authority cannot issue the designed receipt format, adapt the contract under review and add fresh failing tests before enabling it. Verify provider-signed reconciliation, exact tenant/order/amount/currency and idempotent retries; avoid exposing poll URLs, API keys or customer identities.
5. Test a consented dedicated MMF checkout only after approval, produce genuine provider settlement evidence, verify that unpaid is NOT paid, and confirm no mail-sending entitlements can be acquired from a preparation assessment.
6. Keep `MMF_COMMERCE_ENABLED` and all customer sending flags OFF until independent acceptance and release. This is NOT production payment activation or revenue certification.

### Product separation

Paynow merchant integration **reuse** is established architecture. **MMF SKU billing and settlement validation are NOT yet wired live**. Existing checkout proofs do not justify marking `verifiedPaymentCollection` for MMF as verified. It stays unverified until the new product binding and legal/commercial release are evidenced. No second merchant registration is required based on the currently documented arrangement.
