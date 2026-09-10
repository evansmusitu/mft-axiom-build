# MUSITU Store Phase 1 — Physical Device Certification Protocol

Date: 2026-09-09
Revised for live Store 1.0.1 production identity: 2026-09-10

This protocol is the remaining customer-device gate for MUSITU Store Phase 1. It does **not** authorize Phase 2 and it does **not** change the signed catalog.

## Immutable production identities

- Store URL: `https://payments.mftintelligence.com/store`
- Current Store Android APK: `https://payments.mftintelligence.com/store/bootstrap/MUSITU_Store_1.0.1.apk`
  - package: `com.musitu.store`
  - version: `1.0.1` / versionCode `10001`
  - bytes: `1679572`
  - SHA-256: `b755210f303ebb6d22a3177bb21e5ebae2e076901021ee62ca2fe6ab0f14af82`
  - signer SHA-256: `43695b6103d7ab57e89166c9a537f1810b7e33053e20332b1d4e7e2e1c612671`
- Retained Store rollback APK: `https://payments.mftintelligence.com/store/bootstrap/MUSITU_Store_1.0.0.apk`
  - package: `com.musitu.store`
  - version: `1.0.0` / versionCode `10000`
  - bytes: `1687882`
  - SHA-256: `71391bf614cc1186cbe1fda17e9e626aad71d96dbf26807228b73bd2ea99b2f8`
  - signer SHA-256: `43695b6103d7ab57e89166c9a537f1810b7e33053e20332b1d4e7e2e1c612671`
  - this retained object is rollback-only and must not be used for the current fresh-device certification.
- Chemistry Android APK:
  - package: `com.musitu.chemistry`
  - catalog release: `1.3.0` / versionCode `10200`
  - sealed Android package versionName: `1.3.0-frontier-u-rc1`
  - bytes: `5892286`
  - SHA-256: `4ba442122d9c86a0c3cef660334fe337c6ea9ae6fe853c964b5e94961245babd`
  - signer SHA-256: `d4455ac3ec74a6d7cd7993ca640f554a83bba95dfd01ef508f7637b6bc72c0d8`
- iOS IPA: `https://payments.mftintelligence.com/store/ios/MUSITU_Chemistry_1.3.0.ipa`
  - bundle: `com.musitu.chemistry`
  - version: `1.3.0` / build `10200`
  - bytes: `3640968`
  - SHA-256: `426d2dc05e2fc8846a7582324d953bbdd2a256f170f8db2b5a956bc1c51cc962`
  - minimum iOS: `15.0`
  - native installation requires SideStore/user-account re-signing; the PWA is a separate fallback path.

## Evidence rules

1. Use a real physical device, not an emulator/simulator, for a physical-device PASS.
2. Start from a device on which the target MUSITU app is not installed, or explicitly uninstall it before the recording begins.
3. Use the current production Store URLs and identities above. Do not sideload a locally rebuilt substitute and do not certify the retained 1.0.0 rollback APK as the current Store release.
4. Record the device OS version and model, but do not expose account passwords, recovery codes, API keys, or signing secrets.
5. Keep the recording continuous across download, system installer prompts, first launch, and the post-install verification step whenever the platform permits.
6. A failed installation, crash, signature/package conflict, blank first launch, or Store/catalog verification failure is a certification failure. Do not mark it PASS because another installation path works.
7. Installation state is never proof of Premium entitlement. Commerce/entitlement testing is separate.

## Android physical-device gate

### Fresh Store bootstrap

1. Confirm `com.musitu.store` and `com.musitu.chemistry` are not installed.
2. Open `https://payments.mftintelligence.com/store` in the normal browser.
3. Follow the Android install path and download `MUSITU_Store_1.0.1.apk` from the production Store route.
4. Approve Android's normal APK installation prompt. If Android requires the user to enable “Install unknown apps” for the browser, perform only the normal OS flow and return to the same downloaded APK.
5. Launch MUSITU Store from the installed application icon.
6. Required first-launch observations:
   - `MUSITU STORE`
   - `MUSITU Chemistry`
   - signed catalog resolves successfully
   - `Version 1.3.0`
   - `Verified publisher: MUSITU`
   - Chemistry is shown as `Not installed` before Chemistry installation.

### Store-mediated Chemistry install

1. In MUSITU Store, tap `Install` for Chemistry.
2. If Android requires “Install unknown apps” permission for **MUSITU Store**, enable only that app-specific permission through the standard system screen and return to the Store flow.
3. The Store must download the production Chemistry APK and reach its own verified state before handing the APK to Android's installer.
4. Approve Android's package-installer confirmation.
5. Launch MUSITU Chemistry from the resulting system/Open action or app icon.
6. Required observations:
   - installation succeeds without package/signature conflict;
   - first launch reaches the actual Chemistry experience, not a storefront or rescue page;
   - no immediate crash or blank unrecoverable surface;
   - return to MUSITU Store and refresh/reopen it;
   - the Store now reports Chemistry as `Installed · up to date` and offers `Open`.

### Android recovery

After the fresh install PASS, separately exercise:
- Store reopen after process kill;
- Chemistry reopen after process kill;
- `Check for updates` while already current;
- `Repair / Reinstall` only if the tester is prepared to complete the Android installer flow again;
- a temporary network loss followed by Store reopen, verifying the client fails closed rather than installing an unverified release.

## iPhone physical-device gate

1. Confirm MUSITU Chemistry is not installed.
2. Open the production Store on the iPhone and verify iOS routing identifies the SideStore/native path and PWA fallback accurately.
3. For the native test, use SideStore with the production source `https://payments.mftintelligence.com/store/ios/source.json`.
4. Install the exact MUSITU Chemistry 1.3.0 IPA through the user's normal SideStore/user-account re-signing flow.
5. Launch the installed native app.
6. Verify bundle/product identity in the user-visible installation and that the actual Chemistry learner experience opens successfully.
7. Close/reopen the app and verify it remains usable.
8. Separately verify the browser/PWA fallback from `https://payments.mftintelligence.com/chemistry/app/` without representing it as the native SideStore install.

## iPad physical-device gate

Repeat the iPhone gate on an iPad. A successful iPhone test does not automatically certify iPad layout/installation behavior.

Required additional observation: the Chemistry UI must remain usable in the iPad viewport and supported orientations without a blocking layout failure.

## Desktop/PWA customer-device gate

On at least one normal desktop OS/browser combination:

1. Open `https://payments.mftintelligence.com/store`.
2. Confirm the Store recommends the browser/PWA carrier rather than claiming a nonexistent native `.exe`, `.msi`, `.dmg`, or Linux package.
3. Open MUSITU Chemistry.
4. Install the PWA using the browser's normal install mechanism where supported.
5. Launch the installed PWA from the OS/browser app surface.
6. Reopen it after closing all windows.
7. Verify the offline shell/recovery page after the application has cached successfully.

## Final Phase-1 gate

`fresh_device_phase1_complete` must remain `false` until the required physical/customer-device evidence is reviewed and accepted.

A final Phase-1 certification record must include, for every required surface:
- platform and OS version;
- device/model class;
- production URL used;
- product version installed/opened;
- PASS/FAIL for download, install, first launch, reopen, and recovery checks;
- recording/screenshot evidence references;
- any failure details without reinterpretation or concealment.

Only after those gates pass may a later signed/authorized release-state process consider changing the fresh-device completion status. Phase 2 remains separately unauthorized until explicit authorization is given.
