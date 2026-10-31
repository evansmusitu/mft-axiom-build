# MUSITU Store V2 Phase 1 — independent private developer review security evidence, 2026-10-23

**Original scope remains authoritative:** Secure, real multi-publisher Android/web/initial Windows Store, independent identity/right checks, genuine publisher/app acceptance, real money/refunds/entitlements and customer support before a separate public release decision. Stage one **RUNNING**, phase two **PENDING**. This document does NOT authorize release, payments, external APK distribution or publisher admission.

## High-value defect removed — developer cannot self-review using a second valid JWT

Existing stronger private, not-yet-deployed `store/phase1/developer_portal/portal.mjs` already requires cryptographic P-256 JWT verification, pinned issuer/audience and reviewer role plus verified recent MFA. Work remained **in this canonical implementation**, not in a competing developer API.

1. Added adversarial regression in `portal.test.mjs`: an application author's signed, valid, fresh MFA token claims `developer-actor-1`; a second signed, valid reviewer-role JWT with the **same `sub`** must not create an identity review.
2. [RED GitHub run 39894812188](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39894812188) proved the original genuine failure: received **HTTP 202**, expected **HTTP 403**.
3. Patched the controller to verify original submission `actorId` from the **trusted repository** and require distinct subject before recording a review. Missing submitter provenance fails closed.
4. Original negative body-validation semantics retained. Controller and backend contract [GREEN run 39895585827](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39895585827): **19 tests passed / 0 failures**. This includes role impersonation, self-review, bad JWT, stale MFA, cross-tenant reads, forged approvals, oversized inputs and scoped idempotency.

## Durable PostgreSQL dual-review protection proven on real database

- Existing private migration `store/phase1/developer_portal/postgres-review-journal.candidate.sql` is still **NOT applied** to user's live Neon project. Added `private_reviews_no_self_attestation` trigger in private reviewer schema. It rejects any reviewer whose `reviewer_subject` equals `submitting_subject`, independently of token presentation and API policy.
- [RED GitHub run 39895054922](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39895054922) independently proved real PostgreSQL 16 initially **accepted** self-review when it should reject.
- Added actual trigger and kept the existing unique `(submission_id,reviewer_role)` / `(submission_id,reviewer_subject)` and immutable evidence triggers.
- [GREEN run 39895269383](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39895269383): **SUCCESS** on actual disposable PostgreSQL 16; denied author self-review, same-human two-role replay, submitted APK metadata UPDATE and evidence DELETE, and verified exactly two independent reviewer records. Transaction ROLLBACK + readback: **0 submissions, 0 review notes**.

## New real repository adapter (not a deployment)

`store/phase1/developer_portal/postgres-repository.mjs` implements the canonical `repository.create/read/addReview` interface with:
- Parameter-bound, independent owner-supplied `query(sql,params)` (no global credentials, no database creation, no production network calls);
- `sub-` + CSPRNG 128-bit random submission IDs;
- Atomic publisher-bound idempotency, comparison of SHA-256 **request digest** on replay, conflict on mutated request or reused package/version;
- Parameterized tenancy-scoped lookups and compare-and-append reviewer evidence, no overwrite/delete operation;
- Explicit states `REVIEW_REQUIRED` only; no production publication, signing, payment, entitlement or payout API.

New repository tests were first deliberately red in [run 39895477497](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39895477497), then green within [run 39895585827](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39895585827). **The adapter tests use injected fake SQL responses; real PostgreSQL integration was tested separately at the schema/trigger layer. No claim is made that a fully wired Node/PostgreSQL portal or live external IdP has been qualified.**

An unnecessary new `developer-portal/` duplicate candidate was removed, preserving the canonical earlier `developer_portal/` source and its genuine MFA checks.

## Fresh external readback (not invented approvals)

- Fresh connected Gmail query 2026-10-23: **no new replies** from Fossify, Open Camera, Material Files or the Paynow Store-specific inquiry. Already sent invitations were not duplicated. Verified independent publishers **0/3**; accepted third-party apps **0/2**.
- Fresh read-only Neon query from `musitu_store_v2_gateway` on `musitu_store_v2_staging`: **0 products, 0 checkout intents, 0 checkout reviews, 0 customer tokens** and **checkout INSERT privilege=false**. No developer portal SQL migration applied.
- Vercel signed-in private staging positive canary, live merchant payout/refund approval, authorized real buyers, physical device/user acceptance, publisher rights and security approval, actual APK quarantine upload, provider MFA role provisioning, audited DB connection, and independent release signing remain **PENDING**.
- Axiom work plan `plan_4ff9d564fe764ebe843d78df913c7d86`: **PHASE_1 RUNNING**, **PHASE_2 PENDING**.

## Protected invariants

All changes confined to child branch `feature/store-v2-publisher-evidence-pilot-20261021`, draft PR #32. Protected main, signed Store V1 Java hashes, parent draft PR #27, frozen OpenAI PR #1, existing Vercel deployment, Cloudflare, Neon data and public signed Store catalog remain untouched by this work. No actual distribution of publisher-owned APKs, real payments, merchant credentials, entitlement changes, payout, merge or public launch.

**Final classification: `PRIVATE_DEVELOPER_SECURITY_AND_JOURNAL_IMPLEMENTED_UNIT_TESTED_AND_SCHEMA_TESTED`; `LIVE_AUTHENTICATED_PUBLISHER_ONBOARDING=NOT_QUALIFIED`; `STORE_RELEASE=DENIED`.**
