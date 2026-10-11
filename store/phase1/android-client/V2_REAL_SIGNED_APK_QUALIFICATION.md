# MUSITU Store Android V2 — actual APK runtime qualification (isolated)

**Purpose:** Advance Phase 1 beyond metadata-only signed catalog checks and synthetic APK-shaped streams. This is a new stacked candidate based on Android V2 draft PR #22; it does not alter Store production or the V1 Chemistry installer.

## Ephemeral artifacts

The isolated GitHub Actions job builds **two actual Android application packages**, from minimal fixture modules `fixturealpha` and `fixturebeta`. It generates **two distinct throwaway RSA keystores** for these builds on the runner, zipaligns and signs each APK, verifies both packages using Android build tools and removes both private keys. Neither fixture is a publisher account or a publicly distributed application.

GitHub must not retain the private signing keys. Only artifact checksums are uploaded. The test packages are never published to MUSITU Store's live catalog, and no MUSITU production signing key is accessed.

## Emulator acceptance procedure

1. Build and individually sign both minimal APKs.
2. Install only the Store debug application and its instrumentation test runner on a fresh API 24 emulator.
3. Copy the test APKs into the Store's application-private test directory; no public artifact download is attempted.
4. Verify both APKs are parsed by Android PackageManager with different package IDs and different real signing certificates.
5. Create an ephemeral detached ECDSA-P256 root-signed V2 test catalog delegating each package identity to a separate simulated publisher.
6. Use the actual signed V2 catalog verifier and bounded private APK staging to verify exact file digest, size, Android package identity, native signer and version before any OS handoff.
7. Assert cross-publisher APK substitution, signer mismatch and tampering are rejected.
8. Invoke the stock Android installer handoff for a verified test APK. **Do not claim that the user accepted the approval prompt or that installation completed from this assertion alone.**
9. Require both the new real-APK test class and the existing signed V2 emulator test class to pass, with preserved V1 source blob checks.

## Non-goals / remaining qualification

- No real registered third-party publisher has been onboarded. Test publisher identities are fixture identities only.
- No live production-signed V2 catalog or internet delivery endpoint has been produced.
- This does **not** demonstrate physical hardware compatibility, human approval of an installer dialog, completed installation or update via MUSITU UI, payment/entitlement correctness, or Android API 26+ unknown-source consent behavior.
- The test keypairs are intentionally ephemeral, not publisher keys usable in production.
- Package installation must retain Android's user-consent requirements; no bypasses.
- Release gates in AXIOM Phase 1 remain open until all other specified requirements are independently satisfied.

## Evidence

The GitHub workflow is `.github/workflows/musitu-store-v2-real-apk-api24.yml`; it must produce the exact marker `MUSITU_STORE_V2_GENUINE_APK_API24_PASS` to count as a completed qualification, with 6/6 real-APK instrumentation cases and 0 failures. A workflow that is queued, in progress, cancelled or failing does not qualify.
