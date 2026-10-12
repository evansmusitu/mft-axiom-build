# MUSITU Store V2 — Truthful installed-application cards (isolated)

**Governance:** Phase 1 RUNNING. Phase 2 PENDING. This is a stacked, non-production draft candidate; no Store V1 production, protected main, signed APK, Cloudflare deployment, frozen OpenAI submission or PR #1 is modified.

## Important Android 11+ user-facing contract

Android restricts which installed packages an ordinary app can inspect. The Store must *never* turn a hidden/absent `PackageManager` result into “Not installed.” Only direct OS package identity, current signing certificate and installed version observations can establish that an app is verified installed. The root-signed V2 catalog remains authoritative for publisher ownership.

| Android verification state | Exact UI meaning | Can review through normal Android OS installer? |
| --- | --- | --- |
| `UNKNOWN_VISIBILITY` | Install status unavailable — Android may hide this app | Yes, only with OS approval |
| `VERIFIED_INSTALLED` | Verified installed — Android signer and version checked | Yes, review update/reinstall |
| `REJECTED_SIGNER` | Blocked — installed signer conflicts with signed catalog | No |
| `REJECTED_PACKAGE_IDENTITY` | Blocked — installed package identity conflicts | No |
| `REJECTED_DOWNGRADE` | Blocked — newer installed version would be downgraded | No |
| PackageManager inspection error | Could not verify Android installed-package status | No |

This is not a claim to query all user-installed software. No `QUERY_ALL_PACKAGES` permission is requested. The Android11 disposable-fixture package declaration remains debug-only; shipping release builds do not enumerate arbitrary publishers. The Store never treats local receipts or downloaded metadata as proof of installation.

## Test plan

1. A real Android API24 emulator renders two root-signed test-publisher application cards with **status unavailable** and two enabled normal-OS review actions, without saying “Not installed.”
2. A real Android API30 emulator uses independently signed disposable APKs, source permission approval, cancellation and a second per-APK OS installation approval. After PackageManager confirms installed package ID, signer SHA256 and version, the root-signed app card must show **verified installed** for the first publisher and **status unavailable** for the uninstalled/hidden second publisher.
3. JVM tests must verify fail-closed UI on signer, package, version and inspector conflicts.
4. Original signed Store V1 main code must remain immutable. No live V2 install routing or publish action is authorized.

## Open release gates

The preview is not production-facing. Need genuine enrolled commercial publishers, hosted root-signed V2 catalog with revocation and trusted time, carefully scoped signed-apk delivery, robust URI-grant lifecycle cleanup, physical-device and Android API variation qualification, legally compliant general package visibility, commerce, Windows support and independent approval before any production rollout.
