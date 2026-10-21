# MUSITU Store V2 — real upstream Android release candidate provenance (2026-10-21)

**Classification:** verified upstream RELEASE METADATA ONLY. These are genuine,
existing third-party public release artifacts, but the APK bytes were **not
downloaded, independently hashed with apksigner, malware-scanned or granted
distribution authorization** in this action. Neither author is presently a
confirmed MUSITU Store pilot publisher. No marketplace listing, app transfer,
native installation, licensing certification or production root signing
is authorized.

## Fossify Gallery — upstream official release

- Verified upstream project: https://github.com/FossifyOrg/Gallery
- Public GitHub release: https://github.com/FossifyOrg/Gallery/releases/tag/1.14.0
- Release timestamp: 2026-10-10T15:46:01Z
- Asset name: `gallery-29-foss-release.apk`
- API-reported artifact size: `38538363` bytes
- GitHub-release API-reported SHA-256: `cfa321d7467b116741689f8f118b46011c882a4c2359b9320111f87c998af373`
- Public upstream license designation: GPL-3.0 (verify exact repository LICENSE and bundled dependencies, source-offer and attribution requirements).
- Current evidence state: **UPSTREAM_RELEASE_METADATA_SEEN**; author opt-in email sent; no reply or participation.

## Material Files — upstream official release

- Verified upstream project: https://github.com/zhanghai/MaterialFiles
- Public GitHub release: https://github.com/zhanghai/MaterialFiles/releases/tag/v1.7.5
- Release timestamp: 2026-09-20T06:28:21Z
- Official *universal* APK asset name: `app-release-universal.apk`
- API-reported APK size: `13747821` bytes
- GitHub-release API-reported SHA-256: `f2e7f028fbddf51d7ee90ace27a1ae4b247511e12514d1def6c9e52435feac40`
- Note: separate `app-release-fdroid.apk` asset exists; SHA-256 `2fe900bf43d725b655008d438f5ca46d0da0f301e3784403b5b96c3fc2df6e8a`. **Do not mix them or assume identical signing certificates**.
- Public upstream license designation: GPL-3.0-or-later. Upstream README explicitly warns that replacing APK signing identity disrupts upgrade compatibility.
- Current evidence state: **UPSTREAM_RELEASE_METADATA_SEEN**; author opt-in outreach send was denied, a private draft is saved, no confirmed reply.

## Mandatory independent upgrade to actual eligible release

Each item must go through all of the following *before any Store listing*:

1. Retrieve APK directly from the exact publisher-owned official release URL to a nonpublic quarantine; reject HTTP redirects to unexpected hosts and any unexpected byte count. Recalculate SHA-256 locally, compare to listed expected checksum. Log without raw personally identifying metadata.
2. Inspect signature with Android SDK `apksigner verify --print-certs` and `aapt dump badging`, verify package ID/version/signer against authenticated upstream release and exact source; inspect APK permissions and run malware/vulnerability/static/security checks.
3. Separately verify GPL and bundled licenses, attribution, source-code availability and trademark/branding. A public GPL release may be legally redistributable when its conditions are met; this **does not equal** written consent to be represented as an enrolled MUSITU publisher.
4. Obtain authentic developer opt-in if the project will be represented as an official Store partner; verify party rights and operator-held identity review; obtain two independently pinned human identity/security signatures and secure evidence custody. Do not send personal IDs or signing keys by email.
5. Test original signed APK on a **real approved Android test device** with genuine OS user consent, update/signature compatibility, revocation and malware containment, with independent witness.
6. Receive owner release decision after security/legal evidence and commercial controls. Do not set money-processing flags automatically.

As of this report: **two real upstream release manifests identified, zero APK bytes independently inspected, 0/3 independent publishers admitted, 0/2 third-party Store applications accepted.** Paynow merchant approval has been confirmed by the owner, but Store-specific funds flow is not activated.

No external APKs are committed to GitHub, Neon, Vercel, Drive or customer device.
