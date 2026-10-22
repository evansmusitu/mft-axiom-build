# MUSITU Store V2 — Phase 1 developer portal continuation (2026-10-22)

**Phase 1 acceptance unchanged:** complete lawful multi-publisher Android/web/initial Windows marketplace. At least 3 real verified independent publishers and 2 admitted genuine applications, owner-authorized signing, reviews, security, payments/refunds/settlement, actual device acceptance and independent final approval are mandatory. Phase 2 remains PENDING.

## Changes actually committed on the isolated child branch

- `store/phase1/developer_portal/portal.mjs`: protected, **nondeployed** P-256 ES256 JWT authorization controller with pinned signing keys, issuer and audience, <=15-minute lifespan, MFA, recent authenticated identity, developer-to-publisher binding, separate reviewer roles, bounded canonical JSON, strict HTTPS source/privacy URLs, manifest digest, no raw APK upload, publisher-scoped idempotency, cross-tenant read refusal, reviewer evidence-only responses and unconditional false publication/payment/entitlement/payout flags.
- `store/phase1/developer_portal/portal.test.mjs`: 11 adversarial cases for token forgery/expiry, wrong role/publisher, invalid URLs including local IP, duplicate JSON keys, oversize input, idempotency replay/mutation, scoped read, two distinct reviewer roles, forged approval and real PostgreSQL-shaped 128-bit submission IDs.
- `store/phase1/developer_portal/postgres-review-journal.candidate.sql`: **not applied**. Dedicated separate schema, no seeded identities or apps, append-only submissions and review notes, unique idempotency and two distinct reviewer identities, all public grants revoked.
- `store/phase1/developer_portal/README.md`: system boundary, API contract and explicit production prerequisites.
- `.github/workflows/musitu-store-v2-developer-portal-auth.yml`: private authentication/security CI declared, but do **not** claim it ran.

## Reproduced local test evidence

Native Node.js `node --test /mnt/data/store_v2_dev_portal_work/portal.test.mjs`:
- TDD baseline: 10 tests failed against intentionally not-implemented controller.
- After implementation, a real failing security case showed direct-IP `https://127.0.0.1/` was incorrectly accepted; updated URL verification to reject IP hosts. Oversized requests intentionally return HTTP 413 rather than 400, and the test expects 413.
- Additional genuine failing 128-bit random database submission ID route case (HTTP 404 rather than 200) was fixed by admitting `sub-[a-f0-9]{32}` while retaining existing fixture IDs.
- Final local check: **11 tests passed, 0 failed**. These are offline tests with **ephemeral synthetic keys and an in-memory fake repository**, not authenticated external developer sessions or a production database.
- New GitHub action has **not appeared as a completed run** in the repo's branch-specific Actions list as of this handoff. **CI gate pending**, regardless of passing local tests.

## Directly verified external state

- No actual publisher or Paynow Store-specific approval replies in the owner's connected Gmail follow-up search.
- Publisher opt-in 0/3; admitted independent apps 0/2, immutable.
- Previous qualified Android emulation: API24 signed-catalog runtime 7/7, API24 OS consent/real disposable signed APK 7/7, API26 source permission 1/1, API30 staged cancellation/visibility 5/5. These are **NOT** real human commercial publisher apps.
- The actual private Vercel staging endpoint is protected by owner SSO. Authenticated canary remains unverified; no app owner login is inferred.
- Existing Neon Store staging gateway is read-only with zero Store checkout/customer rows. New developer portal tables have NOT been created or touched.
- Frozen signed Store V1, parent PR #27, OpenAI PR #1, protected main, Paynow credentials, real-money charges and production public catalog are not changed.

## Required integration work after this increment

1. Genuinely authorize separate developer and operator reviewers through audited OIDC issuer, MFA, revocation/rotation and operator-approved subject-to-publisher mapping.
2. Adapt transaction-safe PostgreSQL repository to the supplied schema; test replay, retries, parallel roles, database failures and RLS with an isolated database. Do not deploy in-memory test repository.
3. Build private quarantine upload/API on authenticated publisher session; run true APK binary checks and human/rights approvals before any Store root-signed catalog delegation.
4. Qualify real publisher replies, ≥3 independent publisher legal identities and ≥2 accepted third-party release packages.
5. Finish authenticated staging, actual device/browser/Windows tests, customer support, incident response, live Paynow refund/settlement/entitlement/payout and owner release decision.

**Status:** `PHASE_1=RUNNING`, `PHASE_2=PENDING`, `PUBLISHER_APPROVAL=0/3`, `ACCEPTED_EXTERNAL_APPS=0/2`, `STORE_PRODUCTION_RELEASE=DENIED`.
