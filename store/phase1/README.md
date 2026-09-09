# MUSITU Store Phase 1

This directory is the bounded implementation of the MUSITU Store foundation. The canonical public entry point is `https://payments.mftintelligence.com/store`.

Security invariants:
- `catalog.json` is the cross-platform source of truth and is detached-signature verified by the Android client.
- The Android MUSITU Store client verifies catalog signature, APK SHA-256, package id, and APK signing certificate before invoking Android's package installer.
- The F-Droid adapter is a signed simple-binary repository generated from exact developer-signed APK bytes.
- The SideStore/AltStore adapter is generated from the canonical catalog and an unsigned IPA that SideStore re-signs for the user's Apple account.
- Distribution state never implies Premium entitlement or payment settlement.
- No private signing key is committed to this repository.
- Rollback is denied unless a signed catalog explicitly authorizes an emergency rollback target.

Private signing continuity is held only in encrypted operator escrow outside GitHub. Public trust material is committed separately.
