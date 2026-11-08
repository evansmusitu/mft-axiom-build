# MUSITU AXIOM — actual hosted PR77 synthetic OAuth D1 rollback and complete 89-statement acceptance — 8 November 2026

**Status: HOSTED SYNTHETIC PASS + INDEPENDENT READBACK PASS. NOT PRODUCTION OAUTH MIGRATION. NOT RELEASE.**

## Cryptographic and source provenance

- Exact reviewed PR77 source commit `4bb938d679a384cc2e499c09569a55c6b880a5fb`.
- Exact reviewed 89-statement plan SHA-256 `6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a`.
- Fixed reviewed code/test/fixture/runner checkout commit `6f22dd0a2bfe468246359f3f72f46b538adfb05f`; Cloudflare ExecutionContext wrapper bug was first observed RED, then repaired GREEN in PR153; earlier PR151 and PR154 never invoked the D1 migration.
- Separate authenticated no-D1 workers.dev routing canary PR156 run `42472815090` PASS, temporary Worker removed GET404. This unblocked the final attempt.
- **Only target D1**: `1eff7a3d-b22b-4264-a0b8-196edf70074f` (`axiom-pr77-synthetic-only-20261108`) in owner alternate Cloudflare account `c954f0c842a486d0388c05b19cd21e47`.
- Protected recovered staging D1 `e36972b3-850d-4273-b934-2fa67587d9f1` only identity-checked. Protected production OAuth D1 `504029cc-f9a5-495e-818f-63c6144b4ea4` in a **different** account was not queried or modified by this migration test.

## Actual hosted provider evidence — PR158
- Live GitHub Actions run `42474084999`, job `128711387206`, **SUCCESS**.
- Immutable checked-out code verified, reviewed 89-statement plan regenerated, **41-statement synthetic fake-identity fixture** passed SQLite tests, Worker authentication/negative tests passed BEFORE Cloudflare token injection.
- New run verified both D1 identities, synthetic target initially empty, Worker script name free and namespace correct.
- One expiring authentication-bearing temporary Worker was uploaded to the isolated alternate account. Authenticated health completed after one transient HTTP404.
- D1 `batch()` accepted all **41 synthetic seed statements**. Recorded baseline schema digest SHA256 `e6547545f074a8d6c35f7ba66cb3ccb3e545317640a22f413a13677ca26cd23c`.
- Exactly one **48-statement** D1 `batch()` consisting of the **FIRST 46 reviewed PR77 statements** and two deliberate CHECK-failure statements returned `intended_constraint_abort`. Follow-up readback verified the original schema digest was unchanged and foreign keys remained clean: **actual hosted atomic rollback PASS**.
- Exactly one full **89 reviewed SQL statements** in a single D1 `batch()` returned `FULL_89_SYNTHETIC_BATCH_ACCEPTED`, with one matching version-2 marker, zero FK violations and no leftover guard.
- Temporary owned Worker deleted HTTP200 and independently GET404; no uncontrolled endpoint or customer data was left deployed.
- Operator safe JSON receipt SHA256 `7c4159d7cfaf6d4a5a22911925ed5e83a825b3a197a30c4f781d7e1c3089991e`.
- GitHub artifact `13614089529` ZIP **1,898 bytes**, SHA256 `7ac2582854875efbe6ce1cbcb0bf9d8758401c7174cd18e79fb03676fb5dd7ca`, CRC PASS.
- Owner-only private Drive `1os3PvYpvwEvVZh95EZFvyZyKLqUkIQrl` — uploaded and re-downloaded exact bytes/SHA-256 and CRC, `shared=false`, owner ACL.

## Independently initiated provider readback — PR159
- New, separate opened-only GitHub Actions run `42474543414`, job `128712805108`, **SUCCESS**, without reusing migration driver or making D1 writes.
- Read-only Cloudflare GET confirmed exact synthetic target and existing protected original staging recovery D1 names/UUIDs; GET temporary script settings HTTP404 confirmed cleanup.
- Exactly one separate fixed SQL SELECT query returned provider `changed_db=false`, `changes=0`, `rows_written=0`.
- Fresh provider aggregate: **9 user tables**, **1 index**, **21 triggers**, **2 synthetic customers**, **1 identity link**, **1 token link**, **1 code link**, **1 migration version row with exact reviewed v2 plan SHA**, **0 leftover guard objects**, **0 abort-probe objects**, **0 foreign key violations**.
- Safe independent receipt SHA256 `2d3d2004ce99e262e2229ebb423bb2e4f14410aac12c8a20934ffff8bc5fc722`.
- GitHub artifact `13614976273` ZIP **1,150 bytes**, SHA256 `9fcc0bf8992bea85981e23046e8668c2ce8090646c661f0db1eff1f412382c81`, CRC PASS.
- Owner-only Drive `1a-hP76sa7bRuyqSltsapmlBfbRGy5M9h` uploaded/re-downloaded same SHA and CRC, `shared=false`, owner ACL.

## Limitations and release controls

These runs **qualify only synthetic SQL compatibility and transactional rollback** on a disposable Cloudflare D1. An 89-statement hosted acceptance was observed, but the account billing plan and applicability of other production limits were not independently verified; there was no paid upgrade.

Exact production OAuth authenticated snapshot contained **4,612 real rows** and separately passed PR77 SQLite `:memory:` 89-statement apply, idempotency and forced-failure rollback. That is NOT the same as a real production OAuth hosted migration or hosted production-OAuth-specific disaster recovery. Never automatically transfer production OAuth signing keys or tokens to the alternate testing account.

PR83 independent full-stack run `42292436148` deliberately **FAILED** its legacy live-adapter veto, because the old adapter could write sealed customer D1, provision fixtures and accepts broad Cloudflare credentials. The veto is correct and must remain until independently reviewed isolated staging live adapter acceptance.

B27 custody/anti-rollback is still `FAILED_IN_SYNTHETIC_ATTACK`. Real signed IdP customer identity/production ownership, keyless onboarding and website↔ChatGPT continuity, external execution completion/cancellation/final usage, genuine Paynow settlements/invoices/refunds/devices, independent custody/B27, PR83 full-stack live adapter, external reviewers and production rollback/public release are **NOT QUALIFIED**.

PR1, PR77, PR83, PR158 and PR159 are DRAFT and UNMERGED. No production OAuth migration, customer billing action, paid upgrade, production or public MUSITU AXIOM launch was performed. **Release authority false; spending cap USD $0.**
