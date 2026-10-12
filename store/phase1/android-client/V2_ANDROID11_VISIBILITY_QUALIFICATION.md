# MUSITU Store V2 — Android 11 package visibility qualification

**Status: QUALIFIED ON AN ISOLATED ANDROID 11 / API30 EMULATOR ONLY.** No production release authorization, customer-device certification, or generic unrestricted publisher visibility is implied.

## Root-cause-driven red → green evidence

- **Initial crash:** Granting Store's per-source install authorization could terminate instrumentation. Split Android11 qualification into five independent instrumentation processes controlled by an OS-visible UI host, rather than retaining a fragile single process.
- **Installer failure:** GitHub Actions 38152659182 and 38153322114 exposed a real `FileProvider` read denial inside Android 11 `InstallStaging`, displayed as “There was a problem parsing the package.” The candidate bridge now carries a scoped `ClipData` URI grant, explicitly limits read permission to the OS-resolved system installer and provides a scoped revocation method. Keeping the Store process alive while staging also mattered.
- **Visibility failure:** GitHub Actions 38154279666 demonstrated the user-approved APK was installed, but `PackageManager.getPackageInfo` returned `NameNotFoundException` because Android 11 hides non-queryable packages. This is not an APK-installation failure. An exact **debug-only** `<queries><package android:name="org.musitu.fixturealpha"/></queries>` declaration enables visibility of the disposable fixture. Release manifest has no fixture query.
- **Green evidence:** [GitHub Actions 38204265223](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38204265223) at source commit `049dcd20951d763c7bb276661bc2d2c1287f64a6` completed **SUCCESS**, emitting:
  - `MUSITU_STORE_TWO_INDEPENDENT_TEST_SIGNERS=PASS`
  - `MUSITU_API30_TEST_PACKAGE_VISIBILITY_DEBUG_ONLY=PASS`
  - `MUSITU_API30_SOURCE_PERMISSION_INITIAL_OFF=PASS`
  - `MUSITU_API30_APK_CANCELLATION_PREVENTED_INSTALL=PASS`
  - `MUSITU_STORE_V2_API30_PACKAGE_VISIBILITY_PASS stages=5 failures=0 errors=0 skipped=0`

## Exact qualified behavior

An Android 11 API30 emulator installed a genuine fixture APK signed by a disposable publisher key. The verification sequence was five independent Android instrumentation tests: (1) initial denied source permission, (2) re-request after user backs out, (3) explicit Settings permission followed by a separate OS APK installer, (4) cancellation proving no install and a new approval attempt, and (5) readback of the installed package ID, versionCode and signing SHA-256. The test host exercised visible Android Settings and package installer controls; it never used privileged `pm install`, `appops set`, or blanket `QUERY_ALL_PACKAGES`.

A separate CI gate verified that the disposable fixture package query appeared in the merged **debug manifest** but **not** in the merged **release manifest**. The shipping Store's V1 `StoreCore.java` and `MainActivity.java` hashes remained unchanged.

## Security and remaining limits

The Android11 V2 bridge's installer-only APK URI grant needs product lifecycle wiring and independent security review before any rollout. The debug visibility entry is **not a production approach to unbounded publisher discovery**; Android package visibility for a fully dynamic marketplace still requires a lawful, least-privilege architecture and policy review. No customer hardware, real publisher onboarding, live root-signed V2 catalog, commercial entitlements, payment processing, public Store installation routes or competitive superiority is established.

**AXIOM:** Phase 1 stays **RUNNING**. Phase 2 stays **PENDING**. PR #26 remains draft and must not be merged or deployed without separate authorization.
