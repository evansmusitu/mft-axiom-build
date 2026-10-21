# MUSITU Store V2 Phase 1 execution checkpoint — 2026-10-21

## Phase 1 truth

**Technical Neon staging provisioning:** completed and independently read back.
**Isolated protected Vercel code deployment:** created; stage probe fails closed
until an authorized secrets workflow binds an actual least-privileged LOGIN
and Neon connection string. **Real Store payment and commercial Phase 1
qualification is NOT complete**. Axiom reviewer remains Phase 1 RUNNING,
Phase 2 PENDING.

## Actual cloud resources and verification

- **Owner-approved usage-billed Neon Scale** org:
  `org-frosty-morning-97872293`. Project:
  `twilight-recipe-57687554`; branch:
  `br-lively-moon-b5tru1gb`; database:
  `musitu_store_v2_staging`. Compute max 0.25 CU, auto-suspend 0.
- Live PostgreSQL17 schema: exactly 4 Store tables, 3 guard triggers,
  one unique Paynow poll-URL index, 0 tokens, 0 products, 0 checkout
  intents, 0 signed review rows. No Axiom billing tables.
- Runtime authorization architecture: `musitu_store_v2_limited` is
  SQL-created, `NOLOGIN`, not `neon_superuser`, granted only Store read,
  order creation/transition and signed review evidence. New
  `musitu_store_v2_gateway` is SQL-created `NOLOGIN`, a member of
  `musitu_store_v2_limited`, neither superuser nor CREATEDB/CREATEROLE/
  BYPASSRLS. It is **not yet an active login** and no Neon password
  or DATABASE_URL is stored in Vercel. This prevents unauthorized use.
- Avoid `musitu_store_v2_runtime`: an earlier Neon API-created role
  inherits `neon_superuser`; never bind it to the Stage gateway. The
  existing elevated project owner is only for admin migration.
- **Vercel project**: `prj_a9Let6yYukgDv0WyXhIoXXrfFe9h`,
  `musitu-store-v2-neon-stage-20261021` on user-owned Hobby team.
  `ssoProtection: {enabled:true,deploymentType:'all'}`; no Git
  integration and no live public Store route.
- **Vercel deployment**:
  `dpl_ESjZPyiYidGLmcnbYq7WMepn21ZJ` READY. First Vercel
  deployment was assigned **production target despite requesting preview**;
  SSO protection is ALL, and production has **no** Neon DB credential and
  no enabling flags. Its only API is /api/stage; default behavior denies
  operations and returns nonproduction status. Do not treat this deployment
  target as Store commercial production authorization.
- Vercel **Preview-only** environment entries verified:
  `STORE_NEON_STAGING_ONLY=true`,
  `STORE_CHECKOUT_ENABLED=false`,
  `STORE_CALLBACKS_CERTIFIED=false`,
  `STORE_FIRST_PARTY_ONLY=true`. No DB URL or merchant key installed.
- GitHub isolated Store branch commit implementing read-only protected
  stage probe: `ed8f2690832dec0634c6a0844708689cb02f9e7d`.
  GitHub Actions [run 39558426647](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39558426647)
  passed 6/6 negative/positive unit tests. Previous Neon Postgres
  schema and API adapter [run 39555337798](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39555337798)
  PASSED; signed Paynow offline gate `39555337800` PASSED.
  Browser-based production acquisition/payment QA is NOT yet qualified.

## Secure login-binding blocker

A direct automated transfer of a generated Neon database password into
Vercel secrets was **blocked by safety checks**, and has NOT been retried
or bypassed. This is an approved secrets boundary. To complete the
protected internal Stage probe, a verified owner needs to use the
provider's **own authenticated UI** to:

1. Configure `musitu_store_v2_gateway` as a LOGIN with a new
   long random password, preserving `NOSUPERUSER NOCREATEDB
   NOCREATEROLE NOBYPASSRLS` and only membership in
   `musitu_store_v2_limited`.
2. Put the URL for **this exact role** and **this exact database** in
   the new Vercel project's **Preview-only sensitive**
   `STORE_NEON_DATABASE_URL`, not in chat, GitHub or production.
3. Deploy a **protected Preview** and confirm authentic private
   /api/stage GET returns `stage_db_connected_disabled` (no money
   authorizations); direct unauthenticated access denied by Vercel.
   If preview cannot be selected, stop; do not automatically alias.
4. Never configure Paynow keys, enable checkout/callbacks or public
   storefront billing routes during this test.

## Remaining Phase 1 release qualification (independent external evidence)

- Separate lawful Store Paynow merchant integration, provider-specific
  approvals and keys stored privately with correct merchant beneficiary;
  genuine callback plus independent provider poll; independently verified
  financial reconciliation, cancelled/refund/dispute audit.
- Three independent real verified third-party publishers and two authentic
  external downloadable applications, with publisher rights, malware
  scanning, agreements and real device/browser install acceptance.
- Real mobile device verification, accessibility, protected user onboarding,
  support/terms/privacy, regional consumer protection, payment dispute and
  settlement approvals. Simulated/CI checks do not satisfy these.
- Human release authority is separate. No production Store payment,
  publisher payout or official store submission/rollout is authorized.

## Protected boundaries

Store PR #27 must remain OPEN/DRAFT/UNMERGED. Original signed Store V1,
OpenAI frozen PR #1, main, Axiom billing, WhatsApp, MMF and FMI unchanged.
Existing Cloudflare 7406 D1 limit is not fixed but not required for Neon.
