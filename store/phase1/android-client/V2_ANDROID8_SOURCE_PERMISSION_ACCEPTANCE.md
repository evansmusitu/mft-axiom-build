# MUSITU Store Android 8.0 / API26 source permission qualification

**Scope:** isolated engineering candidate stacked on draft PR #24. No shipping app, production signing keys, protected main, live deployment, or frozen review integration changes.

## Two separate OS approval gates

On Android 8.0+ the application installer is required to respect two different user decisions:

1. **Source authorization:** the user authorizes the MUSITU Store app itself under Android's `Install unknown apps` permission screen. Until the user does so, `V2AndroidInstallBridge.requestInstall()` must return `USER_APPROVAL_REQUIRED` and direct the user to `ACTION_MANAGE_UNKNOWN_APP_SOURCES` without opening the package installer.
2. **Individual APK approval:** even after authorizing the source, the OS system installer must show an explicit installation confirmation for each selected verified APK. Only after an actual user-facing `Install` action should the fixture be installed.

`V2AndroidApi26PermissionTest` confirms both separate user decisions against real Android 8.0 Settings and package installer surfaces. It also independently verifies the final package name, version code and signing certificate via Android PackageManager.

The CI constructs two genuine but **disposable fixture APKs** under separate ephemeral test signer keys, verifies signatures, and copies the APKs into the Store's private test files. No public V2 signing infrastructure or real customer installer path is involved.

## Genuine red evidence

GitHub Actions run **38142471537**, Android 8.0 emulator, completed **failure on the expected missing step**: the source-authorization toggle remained off. The assertion `user has not yet approved this Store as an installation source` failed after the OS Settings screen was located. This is expected: simply opening Settings is not equivalent to granting permission.

## Green acceptance

A new isolated run after `toggle.click()` must pass this exact sequence:

- `canRequestPackageInstalls() == false` before approval.
- A real Android Settings toggle is present and initially unchecked.
- The test explicitly taps it; Android reports `canRequestPackageInstalls() == true`.
- The user returns from Settings.
- A separate system `Install` dialog is displayed for the root-signed and hash-verified selected APK.
- The application is absent until this second confirmation.
- UIAutomator taps the second confirmation. PackageManager then returns the **exact signed catalog package ID, versionCode and certificate SHA-256**.

The CI must finish **SUCCESS** and emit `MUSITU_STORE_V2_API26_SOURCE_PERMISSION_PASS tests=1 failures=0 errors=0 skipped=0`. A queued, failed or cancelled run is **not a pass**.

## Remaining release gates

This is emulator UI automation, not an actual customer's human consent or a physical phone test. Android 11+ dynamic package visibility, cancellation, retries, updates, download recovery, publisher onboarding, root-signature/expiry policy, server distribution, Windows, payments and a signed production V2 catalog remain unqualified. Phase 1 remains RUNNING; Phase 2 must stay PENDING.
