# MUSITU Mail Fabric — real-source-grounded, encrypted, OFFLINE shared Paynow candidate

**Date:** 2026-10-11. **Scope:** isolated `product/musitu-mail-fabric-isolated-20261009` only. **NO Cloudflare deployment or merchant capability.**

## Exact evidence and source lineage

The owner-held recovery key decrypted the authenticated, ciphertext-only GET-backed snapshot of exactly two shared Workers. Original source/settings are preserved separately in the AES-GCM sealed rollback snapshot (`MMF_SHARED_PAYNOW_SEALED_RESTORE_20261011_B60F8B34.zip`). This patch candidate was constructed **in process memory** from the exact normalized JavaScript of that snapshot, with fail-closed pinned source digests:

- `mft-phase8-external-authority`: original canonical SHA-256 `66b9386b9e5966dd4a27d2498e9eb4048e806321ea5ff63b827e6b82b7539df3`.
- `mft-paynow-transport-gateway`: original canonical SHA-256 `293a32510bb0722f5301f8e63ca368ecc79c6bd5b7ab20d415742d9bdda103a3`.

`src/commercial/mmf-real-source-additive-candidate.mjs` rewrites only the existing default export dispatch. The original `handleRequest` functions, legacy `export`s, existing FMI/Axiom/Chemistry handlers, and all preexisting configuration remain unchanged byte-for-byte. Incoming non-MMF paths are delegated to the original legacy dispatcher. Only the three exact MMF-specific private paths are intercepted, with independent MMF-only env token references; token values never appear in GitHub or artifacts.

The new guarded handler provides **synthetic stage probes only**. It refuses access unless *all* four commerce/mail/live flags are the literal string `false`, and `MMF_PRODUCT_STAGE_ONLY=true`, `MMF_PRODUCT_STAGE_TENANT=mmf_stage_20261011`, and the appropriate MMF-only token is configured independently of FMI/Chemistry/Axiom and the other MMF role. It enforces explicit POST, bearer token, bounded JSON, exact closed schema and product/tenant ID. A success response **never** authorizes payments, transactions, live provider polling, customer emails, refunds, settlement, billing entitlements or live deployment. It does **not** establish distributed replay safety, provider trust, commercial merchant permission or cloud Worker installation.

## Actual-backup execution qualified locally

Both real backed-up modules passed JavaScript module compilation, decryption and cryptographic candidate sealing. The module's new interceptors were executed in an isolated VM with outbound network forbidden. For each Worker: original and patched GET unknown-path responses were byte-for-byte identical, MMF stage-only POST returned the explicit no-commerce probe, and unset flags returned 503. Two-role compiled and staged candidate SHA-256 were independently reverified by decrypting the **candidate ciphertext**; no plaintext source was written to disk, published or uploaded.

The candidate ciphertext is `MMF_SHARED_PAYNOW_OFFLINE_ADDITIVE_PATCH_CANDIDATE_B60F8B34.sealed.json` and the sanitized proof is `MMF_SHARED_PAYNOW_OFFLINE_ADDITIVE_PATCH_MANIFEST_B60F8B34.json`. **The private recovery key is never in GitHub/Drive/this handoff.** The ciphertext remains useless without the separate owner-only key; encrypted source alone does not grant merchant permissions.

## Absolute production gates (still BLOCKED)

1. Fresh GET inventory/digest compare before integration. Any live drift halts; never upload the stale plaintext candidate.
2. Independent security review of actual Worker source, request/tenant protection, merchant/provider API isolation and existing FMI/Axiom/Chemistry behavior.
3. Secure provisioning and distinct custody of `MMF_AUTHORITY_BRIDGE_TOKEN` and `MMF_TRANSPORT_BRIDGE_TOKEN` plus nonexportable preexisting Cloudflare secrets and tested restorable rollback.
4. A distinct release authorization from the independent production approver before **any shared production Worker mutation**. The owner's engineering authorization is not the independent approval.
5. Verified Paynow merchant/product eligibility, legal and tax readiness, real payer consent and provider reconciliation before any real provider initiation or commercial entitlement.

**No shared production Worker mutation, no real payments, no customer emails and no DNS changes were performed.**