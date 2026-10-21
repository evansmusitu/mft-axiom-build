# MUSITU Store V2 — Scoped installed-package visibility contract

**Phase:** 1 (RUNNING)  · **Authority:** isolated draft only  · **Production release:** BLOCKED

## Why this is necessary

Android 11 (API 30) filters many installed packages from `PackageManager.getPackageInfo()`. A `NameNotFoundException` may mean *not installed* OR *installed but not visible to this caller*. The Store must not silently conflate these states. The signed catalog controls publisher identities and APK metadata; it does not grant the Store permission to query every installed app.

Authoritative Android references:
- https://developer.android.com/training/package-visibility
- https://developer.android.com/training/package-visibility/declaring
- https://support.google.com/googleplay/android-developer/answer/10158779

## Minimum privacy-preserving policy

`V2AndroidInstalledPackageState.assess(rootSignedRelease, observation)` returns only:

- `UNKNOWN_VISIBILITY`: Android supplied no package record. **NEVER label the app “not installed.”** A first-time install request can proceed to Android's normal user-approved installer. The OS independently adjudicates existing-package signer compatibility and downgrade restrictions.
- `VERIFIED_INSTALLED`: Android returned the exact root-authorized package name, matching current signer SHA-256, and an installed version that is no newer than the root-signed release under consideration.
- `REJECTED_PACKAGE_IDENTITY`: An observable candidate contradicts the catalog package identity or supplies an invalid version.
- `REJECTED_SIGNER`: Installed signing certificate does not match the catalog's authorized signer.
- `REJECTED_DOWNGRADE`: An observable installed version is newer than the selected root-signed release.

`V2AndroidInstallBridge` must obtain observations through Android `PackageManager` itself. Publisher-submitted metadata, locally cached install histories, and downloaded manifest fields may **never masquerade as an OS-installed-package observation**. Any visible signer, identity, or downgrade conflict stops the install request **before** the OS approval prompt.

Neither `QUERY_ALL_PACKAGES` nor implicit launch-intent tricks that approximate broad package discovery are used here. The `app/src/debug/AndroidManifest.xml` query for `org.musitu.fixturealpha` is **test-only** and is excluded from release manifest; it is not a global commercial solution.

## Explicit open product decision

A dynamic, unlimited third-party marketplace cannot simply add arbitrary runtime `<queries><package>` declarations to an already-installed Store APK. Android's manifest policy is build-time scoped. The final marketplace must use a documented, independently approved approach for *permitted visibility* (such as a finite published package set, user-mediated OS actions/receipts, or a separately reviewed permission submission where truly indispensable). Do not request `QUERY_ALL_PACKAGES` merely as a shortcut; Google Play restricts broad inventory access and requires a policy declaration and approval if used.

Do not claim dynamic installed-app inventory, installed/uninstalled statuses for hidden packages, automated updates of unobservable packages, or parity with Google Play until tests and permissions demonstrate them. Retained install receipts are not independently sufficient proof of current installation, signatures, or version.

## Qualification

The focused JVM tests cover an unknown hidden package, a verified package, mismatching signer/package, downgrade rejection, invalid catalog, and OS-mediated continuation for unknown visibility. Android 11 emulator tests additionally inspect the new policy before and after a genuine OS-approved signed test APK installation. Evidence requires fresh green GitHub Actions runs and zero skipped tests.

Unproven: independent third-party publisher onboarding, complete production package visibility and key-rotation policy, signed live V2 registry publication, physical-device compatibility, commercial entitlements, user data retention and payment settlement. Original signed Store v1 remains untouched.
