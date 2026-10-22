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

---

## Verified continuation — 2026-10-22 (supersedes the 2026-10-21 snapshot status, not its raw provenance)

The 2026-10-21 paragraphs above describe what had **not yet been done on that earlier date**. Their "metadata only" and outreach-draft statements are historical, NOT the current acceptance classification.

On **2026-10-22** actual exact upstream APK bytes were fetched inside an ephemeral GitHub-hosted runner and inspected with the native Android SDK. The successful [quarantine run 39728907515](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39728907515) checked both actual asset SHA-256s, ZIP archive consistency, `apksigner` native signature and `aapt` package identity, version and declared permissions. The runner retained **metadata-only output**, never third-party APK bytes.

| Upstream release | Exact SHA-256 | Android package | App signer certificate SHA-256 | Declared permissions |
| --- | --- | --- | --- | --- |
| Fossify Gallery 1.14.0 | `cfa321d7467b116741689f8f118b46011c882a4c2359b9320111f87c998af373` | `org.fossify.gallery` | `affdb124d3f4720c2f98dbca9eacba0514fba4306e20a2786c861c3c0d6ff292` | 12 |
| Material Files v1.7.5 universal | `f2e7f028fbddf51d7ee90ace27a1ae4b247511e12514d1def6c9e52435feac40` | `me.zhanghai.android.files` | `873b9b60c77cf7f3cd5fae66d0fe112c4a86973e118ee8a29c346c4c673c97f0` | 13 |

The Android manifest of Gallery declares `MANAGE_EXTERNAL_STORAGE`; Material Files declares `MANAGE_EXTERNAL_STORAGE`, `QUERY_ALL_PACKAGES` and `REQUEST_INSTALL_PACKAGES`. These are **review flags**, not a malware diagnosis or automatic rejection. Both official repository metadata report a GPL-3.0-family license; independently verify all notices, corresponding source, dependencies, branding and platform obligations before relying on any redistribution permission. No publisher can be impersonated or automatically enrolled on that basis.

Verified earlier owner-authorized invitations had already been sent to Fossify, Open Camera and Material Files; the later Gmail search found **no genuine replies**. Do not resend duplicate requests. A Paynow Store-specific compliance inquiry was also sent and remains unanswered as of this evidence check.

**Acceptance remains: 0/3 independently verified participating publishers, 0/2 independently accepted third-party Store applications.** Native signature and exact byte validity are not malware clearance, legal approval, independent human reviews, physical-device qualification or production-release authority. No app was published, no external binary retained and no commerce enabled.
