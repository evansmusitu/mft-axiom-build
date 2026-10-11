# MUSITU Mail Fabric — live shared Paynow product scope, READ-ONLY

This authorization-preserving audit queries the **existing** shared Cloudflare payment authority, Paynow transport gateway, and FMI billing Worker using **GET only**. It never reads customer databases, invokes Paynow, creates checkout, fetches merchant secret values, or mutates any Cloudflare resource. The Cloudflare token is inherited from the existing GitHub owner-authorized deployment environment; the audit does not copy it to MMF Worker bindings.

It compares the observed source SHA-256 hashes with the previously proven 2026-10-11 baseline and checks whether **distinct MMF-specific capability names and route candidates** have actually been installed. This is an inventory of observable declarations, **not** authorization to invoke them. A changed production hash, even if legitimate, marks the baseline unverified until independently reconciled.

## Required product-scoped future contract

- **Authority** `mft-phase8-external-authority` remains the sole holder of the existing Paynow merchant integration key and settlement signer. Explicit MMF-only `sign-initiate-mmf` / `verify-callback-mmf` operations must enforce exact MMF product, tenant, immutable server-approved price, random order reference, expiry, non-replay, and no cross-product entitlements; separate `MMF_AUTHORITY_BRIDGE_TOKEN` must be installed and tested.
- **Transport** `mft-paynow-transport-gateway` must authenticate a separate `MMF_TRANSPORT_BRIDGE_TOKEN` and a new **MMF-only initiate contract**. Transport may call the existing merchant only after commercial approval; never use existing FMI/Chemistry tokens as a substitute.
- **Callback** must verify Paynow SHA-512, followed by an **independent, bounded** empty POST to the allowlisted Paynow status URL. Signed payment evidence must bind MMF tenant/order/reference/amount/provider and must never grant email sending. Refund/reversal must be reconciled against previously recorded settled reference and timestamp.
- **Billing** `musitu-mail-fabric-payment-private-stage-20261011` persists MMF-only records in its dedicated SQLite Durable Object. The independent `musitu-mail-fabric-paynow-private-authority-stage-20261011` is a no-credential, route-disabled synthetic-test adapter, **not** the real live Paynow authority.

**Hard release blocks:** merchant's MMF product authorization, independent production security qualification, legal seller/pricing/tax invoicing, and separate approval to initiate real customer transactions or send email. Even if every route and binding exists, `eligibleForPaidActivation` remains **false** without those approvals.

## Evidence

GitHub Actions `mmf-paynow-live-product-scope-readonly-20261011.yml` is bound to the isolated branch and uses the existing **read-only** Cloudflare account token. The CI artifact `mmf-live-paynow-product-scope-readonly-20261011` contains **sanitized** capability booleans, missing-implementation names, source-drift Worker names, timestamp, and explicit denial of paid activation. It contains no raw code, merchant secrets, credentials, order references, customers, or messages.

Local TDD: 4 focused red tests (`NOT_IMPLEMENTED`), then 7 focused green tests across the pure auditor and GET-only adapter; full regression and syntax checks must pass before commit. No customer-facing release is made by this audit.

## Reproducibility of live source snapshots

The first live audit returned hashes that differed from the historical snapshot for all three shared Workers. That is **not by itself evidence of an actual deployment change**: Cloudflare may return a changing multipart representation or embedded metadata. The audit therefore performs two separate GETs for every script and reports `sourceReadbackStableAcrossReads`. An unstable raw response forces `verifiedExistingMerchantStack=false`, and reported baseline mismatches must **not** be represented as proven new production code. Even stable source content that differs from the baseline requires manual reconciliation of script representation, source identity, and deployment history.

The Cloudflare live test on October 11 at 13:09 UTC confirmed `sourceReadbackStableAcrossReads=false`. That proves raw source digests must **not** be interpreted as production code drift. A later audit suppresses the `changedSharedWorkers` list in this situation. Four MMF-specific route/binding capability requirements remain absent. No live payment operations were authorized or performed.
