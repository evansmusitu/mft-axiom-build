# MUSITU Store V2 — original Phase 1 continuation: real Android emulator tests, 2026-10-22

**Governing acceptance:** unchanged. Exactly two Axiom work phases, Phase 1 `RUNNING`, Phase 2 `PENDING`. Phase 1 still requires verified independent publishers (minimum 3), independent approved apps (minimum 2), private developer portal and identity/signature/rights review, actual customer-like device installs, Android/web/Windows release quality, verified lawful provider purchases and refunds and entitlements, customer support and explicit separate release approval. Never relabel a CI test as a third-party publisher partnership or a physical customer/device approval.

## Fresh current-turn evidence

| Check | GitHub Actions | Verification result | Limit |
| --- | --- | --- | --- |
| Isolated Android API 24 signed catalog and security runtime | [run 39743975106](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39743975106) | **PASS 7 tests, 0 failures, 0 errors** | Real Android 7.0 emulator; two publisher identities only disposable fixtures; no production release |
| Android API 24 actual signed disposable APKs with user-consent installer UI | [run 39744039029](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39744039029) | **PASS 7 tests, 0 failures, 0 errors**, including 6 APK tests and 1 OS installer-consent test | OS-mediated UIAutomator installation of throwaway packages with ephemeral keys; not a real external publisher, user/customer device, nor public app |
| Android 8.0 unknown-source permission security | [run 39744490618](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39744490618) | **PASS 1 test, 0 failures, 0 errors, 0 skipped** | Android 8.0 emulator; OS per-source permission test and disposable signed APK identities only |
| Android 11 package visibility and cancellation | [run 39744501778](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39744501778) | **PASS 5 stages, 0 failures, 0 errors, 0 skipped** | Android 11 emulator; source permission initially off, cancelled APK not installed and package visibility checked |

An initial [API24 attempt, run 39743459008](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39743459008), failed **correctly**: the workflow ran cross-API Android tests and actual-APK tests without provisioning the APK fixtures. The workflow was fixed at `bf78afd0d409fd265bd487eac81be1bfd6867448` to run **only the scoped API24 runtime class**, while the explicit actual-APK/consent workflow independently covered the stronger installation cases. Its clean rerun 39743975106 is the authoritative API24 core result. No failed tests were deleted or reclassified as green.

The latest proprietary Store V1 `StoreCore.java` and `MainActivity.java` blob checks passed on those runs. All work remained on the isolated child branch; parent draft PR #27, frozen main and OpenAI PR #1 were not merged or modified.

## Third-party provenance and rights: not approved

Authentic, publicly released actual APK bytes for Fossify Gallery `1.14.0` and Material Files `v1.7.5` underwent ephemeral native `apksigner`, `aapt`, ZIP consistency, file-size and SHA-256 checks. [Run 39728907515](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39728907515) has the metadata-only archive; NO third-party APK retained.

Original exact release-tag license files were independently read at:
- https://raw.githubusercontent.com/FossifyOrg/Gallery/1.14.0/LICENSE
- https://raw.githubusercontent.com/zhanghai/MaterialFiles/v1.7.5/LICENSE

Both contain the GNU General Public License **version 3** text. This alone does not settle per-file license exceptions, corresponding-source distribution, attribution, warranty notice, trademark, authorship claims, malware clearance or publisher consent. Do not imply the projects are enrolled MUSITU publishers. No replies were received to the already sent genuine publisher invitations, and no new duplicate email was sent.

**Original unchanged gate: verified independent publishers 0/3, approved external apps 0/2.** No live catalog issuance, no license/legal approval, no security attestation, no production signing, no public redistribution.

## Payment isolation fresh readback

Live read-only Neon query through `musitu_store_v2_gateway` on `musitu_store_v2_staging` confirmed `store_products=0`, `store_checkout_intents=0`, `store_checkout_reviews=0`, `store_customer_tokens=0`, `rolbypassrls=false`, `can_insert_checkout=false`, `can_update_tokens=false`.

Stage remains protected by Vercel SSO and disabled commerce flags. Real Paynow Store merchant credentials, refunds, paid entitlements, human reviewer approvals and payout reconciliation remain unverified. There is NO real customer transaction and NO authorized release.

## Explicit promotion hold

`PHASE_1=RUNNING`. Continue real publisher approval and legal reviews, real-device Android PWA and Windows coverage, secure developer portal, production root custody, authenticated Vercel positive stage canary, payment provider compliance and independent human sign-offs. `PHASE_2=PENDING`; public release, payments, store entitlement and publisher payout **DENIED until actual gates pass**.


### Final independent job readbacks

- [API26 run 39744490618](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39744490618) concluded **success**. Actual log: `MUSITU_STORE_V2_API26_SOURCE_PERMISSION_PASS tests=1 failures=0 errors=0 skipped=0`.
- [API30 run 39744501778](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39744501778) concluded **success**. Actual logs: `MUSITU_API30_SOURCE_PERMISSION_INITIAL_OFF=PASS`, `MUSITU_API30_APK_CANCELLATION_PREVENTED_INSTALL=PASS`, `MUSITU_STORE_V2_API30_PACKAGE_VISIBILITY_PASS stages=5 failures=0 errors=0 skipped=0`.

**Combined fresh result (separate scopes, not double-counted as independent applications or devices):** 7 API24 catalog tests + 7 API24 genuine OS installer/disposable APK tests + 1 API26 permission test + 5 API30 staged scenarios. All corresponding jobs completed with no failed steps. These are ephemeral synthetic applications on real Android emulator OS images, not approved third-party publisher applications. No customer-facing installation authority was granted and no production release flags changed.
