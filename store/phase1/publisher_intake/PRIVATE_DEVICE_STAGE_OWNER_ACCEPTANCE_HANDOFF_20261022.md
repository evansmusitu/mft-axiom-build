# MUSITU Store V2 — protected signed-in acceptance + owner Android hardware evidence (2026-10-22)

**Current classifications:**
- Signed-in Vercel stage test: `AUTHENTICATION_REQUIRED_NOT_YET_COMPLETED`
- Browser anonymous denial: `PASSED` from independent GitHub Actions (GET and POST returned HTTP 401)
- Android isolated probe APK integrity: `PASSED`
- Actual Android physical install/launch: `OWNER_ACTION_PENDING`
- Actual Store V2 installer hardware acceptance: `NOT_TESTED`

## Vercel real-browser attempt

A real interactive Browser Use session requested only `GET https://musitu-store-v2-neon-stage-20261021-e7twfq0bj-evansmusitu.vercel.app/api/stage`.

The real browser navigated to `https://vercel.com/login` (HTML Login – Vercel, final HTTP 200) and had **no existing authenticated owner session**. It did not sign in or bypass deployment protection. No protected stage JSON was returned.

To complete owner-witnessed stage acceptance: the legitimate Vercel project owner logs in **on their own phone** via the direct protected URL; then obtains the JSON response and reports only `ok`, `code` and commerce-disabled booleans. Expected positive stage canary: `code=stage_db_connected_disabled`, all payment/checkout/entitlement/payout flags false. If the response is `stage_database_unreachable` or 503, record the real failure and do not override flags. Do not share passwords, cookies, SSO tokens, Bypass secrets or deployment-protection cookies.

## Actual compiled and verified offline Android acceptance candidate

- Private source: `store/phase1/device-acceptance`
- Build commit: `c8da8791e080e8211da7ec276b382ea12c3692e3`.
- GitHub Actions run: `39733390947` **SUCCESS**.
- Artifact ID: `12406321226`.
- App APK: `MUSITU_Store_V2_Offline_Device_Test_ONLY.apk`
- Package: `com.musitu.store.v2acceptance` (deliberately unlike signed V1 `com.musitu.store`).
- APK byte length: **10097**.
- APK SHA-256: `34e22eb78002cf3c44479b78b292b641304be3930886eb127c1f26f5a3301a46`.
- Actual debug signer cert SHA-256: `f6cd3cfe27cb68e06560fbd40265c55b8bb57862ab6fe6714967cd5c7243f493`.
- Real Android `apksigner verify`: **PASS**.
- Real `aapt` manifest package identity and declared permissions: **PASS; 0 permissions**.
- AndroidManifest.xml and APK ZIP checksums: **PASS**.
- Container independently reverified artifact ZIP integrity and APK bytes against separate JSON evidence.
- Private connected Google Drive copy (shared=false): `1UPMXdbK0s0OV-rKfIOZrV2MZRjQ4Pdmz`, under folder `1EbS_qedk6k00bxAllhTH_aZGtYDZuTvH`.

**Critical:** This is a no-permission, offline *Android device witness probe*, **not a Store V2 installer, not a production Store V1 replacement, and not a legitimate third-party application candidate.** The source APK was debug signed with an ephemeral CI key. It only shows an offline package-signing and OS-install receipt which the device owner can voluntarily copy, with Android SDK, manufacturer/model, package ID, timestamp and signer certificate hash; it never transmits records.

## Exact owner phone procedure

1. Download exact verified APK from ChatGPT attachment or authenticated private Drive ZIP. If using ZIP, extract the `.apk` first.
2. Confirm the installation candidate is called **MUSITU V2 Device Test**. Do **not** install anything that claims to replace an existing `MUSITU Store`.
3. Permit the one installation through Android's normal prompt if you choose; **never disable Play Protect** or bypass a malicious-app security warning.
4. Open `MUSITU V2 Device Test`, observe the explanatory text, tap **Copy receipt (manual, offline)**, and paste the receipt into the private chat. A screen capture is optional, but no unrelated private data.
5. Uninstall the isolated app when done, and disable temporary unknown-app installation permissions again.

The physical Android evidence remains **UNVERIFIED** until the owner's device produces evidence of actual installation and launch. It does **not** cover Store V2 multi-publisher installation, real third-party APKs, purchase logic or production V1 regression.

## Protected invariants

No production alias, no checkout/entitlement/payment/payout activation, no Store V1 native source modifications, no external publication rights, no PR merge. `PHASE_1=RUNNING`; `PHASE_2=PENDING`.
