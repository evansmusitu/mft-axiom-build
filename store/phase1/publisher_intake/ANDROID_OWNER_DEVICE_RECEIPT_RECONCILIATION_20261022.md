# MUSITU Store V2 — Android owner receipt reconciliation, 22 October 2026

**Classification:** `RECEIPT_FORMAT_AND_SIGNER_MATCHED_BUT_PHYSICAL_DEVICE_UNQUALIFIED`

This record concerns a receipt supplied in the owner's private ChatGPT conversation. It is not a server-originated attestation, Play Integrity proof, independent physical-device witness, or evidence that the actual Store V2 installer has run. Do not mark physical acceptance as complete.

## Exact source provenance and reproducible checks

- Receipt raw-text SHA-256: `c34b805f812a43c82c4e108cc664fc086fecb6dd96285089829c1f6ebec39ba6`.
- Actual APK rehashed from the existing container file `MUSITU_Store_V2_Offline_Device_Test_ONLY.apk`: SHA-256 `34e22eb78002cf3c44479b78b292b641304be3930886eb127c1f26f5a3301a46`; 10,097 bytes.
- APK independently checked for byte equality against its private GitHub Actions artifact ZIP. Embedded evidence `MUSITU_ANDROID_PRIVATE_DEVICE_TEST_EVIDENCE.json` identified the same SHA-256, signer, package and version.
- GitHub source/build: `c8da8791e080e8211da7ec276b382ea12c3692e3`, [successful workflow run 39733390947](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39733390947), artifact `12406321226`.
- User-reported `packageId=com.musitu.store.v2acceptance`: matches expected.
- User-reported `versionName=0.1-private-test`: matches expected.
- User-reported `signerCertificateSha256=f6cd3cfe27cb68e06560fbd40265c55b8bb57862ab6fe6714967cd5c7243f493`: matches the original build evidence.
- User-reported `observedAtUtc=2026-10-22T06:42:28Z`: valid ISO UTC timestamp (timestamp accuracy not independently attested).
- Other stated receipt fields: correct schema, `scope=ISOLATED_OFFLINE_PROBE_NOT_REAL_STORE_V2`, `appInstalledAndLaunched=true`, `networkPermissionRequired=false`, `actualV2InstallerCertified=false`, `paymentOrPublisherApproval=false`.
- Local bounded receipt/artifact reconciliation: **11 / 11 assertions passed**. This validates *consistency* with the built test APK, not the device's identity or the factual origin of receipt text.

## Material hardware identity discrepancy — unresolved

User-supplied claim: `manufacturer=samsung`, `model=SM-S908E`, `androidSdk=28`.

- Android SDK **28** means Android **9**. Official Android platform mapping: https://developer.android.com/tools/releases/platforms
- Samsung's `SM-S908E` Galaxy S22 Ultra launched with **Android 12**, not Android 9. Official update history: https://doc.samsungmobile.com/SM-S908E/022196220329/eng.html
- This is inconsistent with normal stock-firmware lineage; it may reflect copied or mismatched data, an emulator/virtualized environment, modified system properties, or another explanation. **Do not accuse the owner of fabrication.**
- The test app's receipt is plain text without a remote challenge or a hardware attestation signature, so it is not independently non-forgeable. The model discrepancy requires corroboration even for the basic device witness.

**Required owner follow-up:** on the phone that ran the APK, read **Settings > About phone > Model number** and **Settings > About phone > Software information > Android version**. Provide only the model and Android version (optional screenshot with IMEI, serial and other private fields cropped). Preserve original receipt unaltered. If a genuine custom Android 9 port exists, record its proven provenance separately rather than silently treating it as stock Galaxy S22 Ultra.

## Outcome and non-negotiable gates

- Android isolated test APK build: `VERIFIED`
- Owner receipt schema/expected package/version/signer: `MATCHED`
- Actual owner-reported install/launch: `RECEIVED_AS_CLAIM`
- Real physical Android device acceptance: `UNVERIFIED_MODEL_SDK_CONFLICT`
- MUSITU Store V2 signed multi-app installer certification: **NOT DONE**
- Independent publisher approval, external APK release authorization, marketplace payments and entitlements: **NOT GRANTED**
- Protected signed-in Vercel stage canary: still requires an authenticated positive response
- `PHASE_1=RUNNING`; `PHASE_2=PENDING`. Release and commerce remain disabled.

No signed Store V1 source, protected main, frozen OpenAI PR, payment flag or production release is modified by this evidence record.
