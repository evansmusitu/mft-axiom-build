# MUSITU Store V2 — 2026-10-22 private Phase 1 continuation: external gates and real platform CI

**Mode:** evidence-only, fail-closed, isolated child branch `feature/store-v2-publisher-evidence-pilot-20261021`. This document does **not** authorize promotion, third-party redistribution, paid commerce, customer entitlements or publisher payout.

## New real protected Vercel Preview deployment

- Isolated source: `store/phase1/neon-stage/{api/stage.js,package.json,vercel.json}` at authenticated GitHub commit `cb9a53dec525b12f9d8849836369bd35f5a47795`.
- Source blob: `api/stage.js` `cdd25d20b950880d2a0e8c647a9cdafee5ce720a`.
- Target: existing protected project `prj_a9Let6yYukgDv0WyXhIoXXrfFe9h`, **Preview only**, no production alias, no secret copy or disclosure.
- New deployment: `dpl_2AuAAEj5gsoWAwFmDHQM87ruqESP`, host `musitu-store-v2-neon-stage-20261021-e7twfq0bj-evansmusitu.vercel.app`.
- Vercel readback: **READY**; project `ssoProtection.enabled=true`, `deploymentType=all`. Sensitive `STORE_NEON_DATABASE_URL` stays Preview-only; checkout and callbacks certification flags remained Preview-only, never enabled.
- Fresh real **anonymous negative** test from an independent GitHub-hosted network runner:
  - `GET /api/stage` → **401**, no protected canary disclosure.
  - `POST /api/stage` → **401**, no protected canary disclosure.
  - [GitHub Actions run 39731506440](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39731506440).
- **Not yet verified**: authenticated owner request returning `stage_db_connected_disabled` on this new protected deployment. READY + external 401s does not prove a successful authenticated database canary.

## New platform regression evidence (not actual customer release/device acceptance)

| Platform | Actual testing | Fresh job | Scope limits |
|---|---|---|---|
| Localhost Chrome browser/PWA | **69 tests passed, 0 failed** | [run 39731631322](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39731631322) | Real headless Chromium, local Store Worker only; no physical phone or production store URL |
| Windows OS | Actual Windows-2022 `Add-AppxPackage`, signed disposable MSIX native install, signed update `1.0.0.0→1.0.0.1`, downgrade blocked, removal and ephemeral certificate cleanup | [run 39731817774](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39731817774) | CI VM self-signed disposable fixture, **not** third-party publisher/customer device |
| Android JVM | **37 tests passed**, 0 failures/errors/skips; debug build succeeded; JavaScript signed-catalog regression **27 tests passed** | [run 39731823178](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39731823178) | No physical Android hardware, no legitimate signed V2 production registry or V2 install UI; debug APK is not production-signed |

Source preservation assertions for frozen Store V1 `MainActivity.java` and `StoreCore.java` passed in Android and Windows CI.

**Device safety:** Do **not** install a CI-debug `com.musitu.store` build over an existing signed MUSITU Store V1. Their signer identities differ, and these tests do not demonstrate end-user V2 install readiness. A separately scoped, isolated test candidate plus a real device witness are still required.

## Database gateway readback

Authenticated Neon `musitu_store_v2_gateway` role (staging DB only) confirmed **SELECT=true, INSERT/UPDATE/DELETE=false on all four Store tables**, **CREATE database=false, CREATE public schema objects=false**, `rolsuper=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolbypassrls=false`. All 4 Store row counts remain zero. No payment, publisher acceptance or data-modification SQL was executed.

## External partners and native third-party apps

Earlier real upstream APK quarantine passed twice on official publisher assets: Fossify Gallery release 1.14.0, Material Files v1.7.5. SHA-256 bytes, native `apksigner`, ZIP archive and actual `aapt` permissions were verified in an ephemeral runner; no app binary was retained. **These are not malware clearances, publisher permissions or approved Store listings.** Metadata-only artifact: [run 39728907515](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39728907515). Physical Android and real-user Windows tests remain unqualified.

A fresh Gmail search on 2026-10-22 found **no confirmed replies** from Fossify, Open Camera, Material Files or Paynow. Three publisher invitations and one Store-specific Paynow inquiry have already been sent. Do not duplicate. Genuine publisher approvals **0/3**; legally approved external apps **0/2**. Existing general Paynow merchant approval acknowledged; marketplace payout/refund and distinct Store-specific terms unresolved.

## Exit / independent acceptance

`PHASE_1=RUNNING`; `PHASE_2=PENDING`. Axiom's existing private project `musitu-store-global-superiority-20261011` has **no completed external formal evaluation**. Do not relabel CI with disposable signing keys as independent human review. Required for Phase 1: real publisher opt-in and distribution rights; full malware/legal/security approval of exact packages; certified signed V2 developer candidate; owner-led physical Android test and independent Windows test; live signed-in protected Preview stage success; Store-only Paynow testing, legal payout/refund arrangements; separate owner release authorization.

**Never modify protected main, signed V1 release, frozen PR #1 or draft Store PR #27. Remain private with zero public commerce.**
