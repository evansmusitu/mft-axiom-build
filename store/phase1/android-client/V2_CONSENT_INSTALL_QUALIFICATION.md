# Store V2 genuine APK user approval qualification — isolated

**Base:** `feature/musitu-store-android-v2-real-apk-qualification-20261011` (draft PR #23).  
**Owner release authority:** none for this branch. No production deploy, publication, or merge.

## What this test is designed to prove

1. The original Store `StoreCore.java` and `MainActivity.java` remain byte-for-byte untouched.
2. Two independently test-signed Android APKs are built and signed on disposable GitHub Actions infrastructure.
3. Android PackageManager parses and independently verifies their package IDs, version codes and signing certificates.
4. The selected APK bytes match the root-signed test catalog and signed publisher delegation.
5. Android displays an **actual system package installation approval control** after `V2AndroidInstallBridge.requestInstall`.
6. Prior to tapping that control, the target package is **not installed**.
7. Android UIAutomator **taps that visible system Install button**, exercising Android's normal approval pathway, without ADB `pm install`, privileged install permissions or hidden APIs.
8. The installed package is read back from Android PackageManager and checked for exact package ID, versionCode and SHA-256 of signing certificate.
9. Regression and genuine-APK isolation tests remain green.

## Red → green criterion

Red run `38140824823`: the test found the Android install control but correctly failed with `NameNotFoundException: org.musitu.fixturealpha` when it attempted to assert installation **without** user approval.

Green candidate: same test must explicitly click the OS consent control before checking the final package. Only a **successful completed CI run** and report marker `MUSITU_STORE_V2_UI_APPROVED_APK_INSTALL_PASS` count as pass.

## Boundaries and next gates

- Uses a **fresh disposable Android 7.0 / API 24 emulator**, and a simulated consent tap. It is not physical-device, real-user pilot or independent commercial publisher evidence.
- Does **not** bypass OS consent requirements.
- No cloud-hosted signed V2 catalog, publisher onboarding or production keys are involved.
- Android 8+ unknown-app-source permission screens, modern Android 11+ package-visibility behavior, genuine release updates, consumer cancellation and revoked publisher handling still need testing.
- This is not connected to MUSITU Store's shipping V1 interface. The production Chemistry Store remains unchanged.
