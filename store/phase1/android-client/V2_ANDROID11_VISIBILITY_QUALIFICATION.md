# MUSITU Store V2 — Android 11 package visibility qualification

**Status: BLOCKED, NOT CERTIFIED.** This work is isolated and stacked on draft PR #25. The production Chemistry Store, v1 package identity, public catalog, root signing authority, live Cloudflare service, main and frozen OpenAI submission have not changed.

## What must be proven before claiming Android 11 compatibility

A new Android 11 (API30) emulator with the future Store target SDK installs two independently signed disposable Android APKs only after user approval, using the actual system Settings and OS package installer. Test must prove:

- No source-install permission by default.
- Backing out of source authorization grants nothing and installs nothing.
- Explicit Settings permission is required before the Store can request any package installation.
- User cancels the **first** individual APK installer, and no package appears.
- On retry, the user approves the individual installer.
- After install, PackageManager returns the correct package ID, versionCode and signer SHA-256 **without** granting `QUERY_ALL_PACKAGES` or weakening per-publisher identity constraints.

The CI must complete SUCCESS and output `MUSITU_STORE_V2_API30_PACKAGE_VISIBILITY_PASS tests=1 failures=0 errors=0 skipped=0`.

## Current evidence and technical blocker

- CI run 38143314595: 1 test failed, reported instrumentation process crash.
- CI run 38143694166: again failed on Android 11; test-result XML recorded a failed case and `Process crashed` but did not preserve an Android Java stack trace.
- Follow-up candidate adds fail-closed Android app and instrumentation lifecycle logs with explicit test progress checkpoints, without modifying the tested V2 production-class algorithms.

Do **not** infer the crash was caused by package visibility or alter package permissions before actual crash evidence is available. Do not classify these runs as passing.

## Unqualified beyond Android11

- Physical hardware, seller onboarding, live server V2 signed catalog, payments/entitlements, root-key recovery, secure updates, Windows/macOS/Linux and global commercial distribution remain outside this test.
- API26 emulator qualification passed independently in PR #25, but that does not establish Android11 readiness.
- The existing Store Phase 1 is RUNNING and Phase 2 must remain PENDING.
