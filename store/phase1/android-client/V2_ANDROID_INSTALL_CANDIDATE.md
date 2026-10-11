# MUSITU Store Android V2 verified-install candidate

**Scope:** isolated, unsigned development candidate. Existing Store 1.0.3, Chemistry v1 catalog, MainActivity, StoreCore, APK signing custody and live deployment remain unchanged.

## Components

- `V2SignedAndroidCatalog.java`: parses an exact raw UTF-8 signed catalog v2 after P-256 detached ECDSA verification using an operator-pinned public key fingerprint. Checks catalog revision/digest watermark, dates, package ownership grants, artifact URLs and signer delegations. Returns an immutable `Verified` selection containing Android releases for multiple publishers.
- `V2AndroidNativeInstallPolicy.java`: bounded streaming of an authorized APK into `<app files>/downloads/v2`, SHA-256 and length verification, canonical path validation, archive package identity, archive signer identity, versionCode equality, and no unauthorized downgrade.
- `V2AndroidInstallBridge.java`: platform adapter to stage an HTTPS 200 full response, independently inspect its APK identity and signer with Android PackageManager, and invoke the OS installer through the existing private FileProvider. It requires normal user approval and never silently installs applications.

## Security boundary

The root public key, fingerprint and artifact-host allowlist are **trusted application policy**, not request or developer-uploaded metadata. The caller must obtain an authentic root key and **persist the accepted revision and digest transactionally before reusing the result**. A caller passing revision 0 on every launch defeats anti-rollback protection.

`Verified` is issued only after detached ECDSA verification; `Release` cannot be constructed externally. A cached verified catalog must be reverified against its signature and checked for expiry.

Downloading must revalidate the signed metadata and use only HTTPS/CA trust with redirects disabled. The Android package manager remains authoritative for final signature, version compatibility, downgrade restrictions, installer permissions and installation approval. Unit-test `ArchiveInfo` probes are simulations, not Android device evidence.

## Explicit remaining gates

- This code is **NOT wired to the shipping v1 Chemistry activity** and has no new customer-facing installation route.
- No real Android emulator or physical-device installation result is established by JVM unit tests or `:app:assembleDebug`.
- No production or user-signed V2 catalog has been created; tests use ephemeral P-256 keys only.
- Missing: transaction-safe stored revision/digest watermark, securely refreshing registry from production, Android 11+ multi-app package visibility and reconciliation, stable/beta channel resolution, supplier identity verification, revocation and rotation policy, interface for selecting multiple apps, resumable downloads and a tested recovery UX.
- Publisher grants must require independently established package ownership and administrative authorization before root signing.
- A deterministic APK digest does not, by itself, prove APK provenance or safety; malware scanning, review and independent security qualification are separately required.
- Distribution does not imply purchase, paid license, payment settlement or entitlement.

## Isolated verification

```bash
gradle -p store/phase1/android-client --no-daemon :app:testDebugUnitTest :app:assembleDebug
node --test store/core/catalog/signed-registry-v2.test.mjs
```

The GitHub Actions workflow `musitu-store-android-v2-ci.yml` runs these checks. A successful build qualifies source compatibility and unit-level contract behavior only. Android installability and security still require actual device/emulator tests.
