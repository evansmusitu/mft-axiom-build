# Owner-authorized MMF Paynow joint source/binding integrity — GET-only

**Scope:** `product/musitu-mail-fabric-isolated-20261009`. This implements the owner-authorized continuation of release-readiness safety qualification; it does **not** interpret the owner's engineering authorization as the independent second-person release approval, merchant eligibility, payer consent or entitlement to initiate transactions.

## Why a joint GET-only check

Prior run 38164771229 compared normalized Worker source payloads to pinned sealed-backup baselines. Later run 38201778364 compared only binding NAME+TYPE metadata to the pinned original Worker settings. They occurred at different times; their separate success does not imply the source and bindings stayed consistent in one observed window.

`src/staging/mmf-joint-source-binding-getonly.mjs` now performs **two complete serial sweeps** over both legacy Workers (8 GETs total: source and settings for authority and transport, repeated). It hashes normalized source via the existing parser, hashes each settings binding's NAME+TYPE (never values) with the existing checker and compares against the previously pinned source and binding fingerprints. It rejects mid-window changes, wrong account, malformed responses and secret-value-bearing binding metadata. If the source or binding baseline differs consistently, the CLI emits only sanitized `DRIFT_BLOCKED` evidence and exits 2. If either repeat differs, the check fails closed with exit 1. A nominal match produces sanitized metadata and exits 0, but all merchant/payment/deployment flags remain **false**.

The associated `MMF Paynow Joint Source and Binding Integrity GET-Only` GitHub Actions workflow uses an existing authenticated, read-only Cloudflare token, one isolated branch, no deploy step, and `contents: read` only. Source code, Worker settings values, access token, private RSA recovery key and merchant credentials are never written to output or artifact. No public endpoint or provider is contacted. This is **not an atomic Cloudflare snapshot**: changes immediately after these GETs remain possible, and the source parser uses a normalized representation. This gate must be repeated directly before a separately approved controlled deployment.

## Non-negotiable blockers still open

1. Independent authorized release approver must sign this exact proposed source/ciphertext digest and restoration plan, distinct from the owner. The owner's blanket authorization cannot substitute for that signature.
2. Paynow merchant agreement must explicitly cover MMF's product and settlement/refund/callback obligations, documented outside code.
3. Secret custody/rotation and non-exportable shared-Worker secret handling must be verified in a non-production/canary rehearsal with evidence. Source/settings-only backup is not a full rollback.
4. Existing FMI, Axiom and Chemistry production routes must receive controlled regression verification before and after any deployment.
5. Real customer payment, refund, DNS change, merchant credential movement, external email and shared Worker write remain out of scope of this engineering-only result.

**Commands from `musitu-mail-fabric`:** `node --test test/mmf-joint-source-binding-getonly.test.mjs`; `npm run check`; `npm test`; `npm run check:phase1` (exit 2 BLOCKED by design).