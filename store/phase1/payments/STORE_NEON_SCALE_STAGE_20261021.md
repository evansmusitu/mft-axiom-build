# MUSITU Store V2 — isolated Neon Scale staging acceptance (2026-10-21)

## Owner decision and financial boundary
Owner explicitly chose **use the existing Neon Scale plan** after the
Cloudflare D1 Free tier enforced quota 7406 and the initial Neon Free-tier
alternative was found to be unavailable in the connected organization.
Neon Scale is usage-billed: this is not a $0 Free-tier deployment.
Do not upgrade the organization, enlarge compute, add replicas, seed real
customer/app/payment data, or launch live transactions without separate approval.

## Verified dedicated Neon resources
- Connected org: `org-frosty-morning-97872293` (**Scale v3**).
- New independent project: `twilight-recipe-57687554`,
  **MUSITU Store V2 Isolated Neon Staging 20261021**.
- Project default staging branch: `br-lively-moon-b5tru1gb`,
  `store-v2-staging`.
- Dedicated database: `musitu_store_v2_staging`.
- Dedicated database owner role: `musitu_store_v2_stage`.
- Region: `aws-us-east-2`; PostgreSQL 17.
- Compute limits: minimum **0.25 CU**, maximum **0.25 CU**,
  `suspend_timeout_seconds=0`, for conservative scale-to-zero costs.
- Migration source: `store-neon-postgres-schema.sql` on the isolated branch.
- Live Neon SQL readback: **4 tables**, **3 safety policy triggers**,
  **1 unique provider-poll-url index**; all four Store tables contained
  **0 rows**; no Axiom billing/usage tables found in this database.
- No existing other Neon project/database/branch was modified or deleted.

### External evidence
The source-schema fix and full offline acceptance ran on disposable GitHub
Actions PostgreSQL 17 at
https://github.com/evansmusitu/mft-axiom-build/actions/runs/39554570686
(**SUCCESS**). Source payment gate also passed:
https://github.com/evansmusitu/mft-axiom-build/actions/runs/39554570720 .
Actual Neon staging migration was applied via Neon connector, **one verified
Store-only DDL statement at a time**, after independent new DB 0-table
qualification. Successful migration is evidenced by the read-only Neon
table/trigger/index/data inventory; CI alone would not prove that.

## Integration boundary
- `store-neon-db-adapter.mjs` implements D1-shaped SQL parameterization,
  row-count evidence and noninteractive SERIALIZABLE batch semantics,
  backed by `@neondatabase/serverless`.
- Neon serverless driver requires `transaction(...,
  {isolationMode:'Serializable', fullResults:true})`, not `isolationLevel`.
  The driver option regression was corrected after consulting the
  official Neon driver API.
- No DATABASE_URL / PostgreSQL credentials are in GitHub, code, CI or chat.
- Neon staging is **NOT attached to a live Worker or Vercel app**. The
  Cloudflare D1 provision workflow must NOT be retried; its D1 quota
  blocker is bypassed architecturally for Neon, not lifted on Cloudflare.
- Store checkout flag **OFF**, callback certification **OFF**, no Paynow
  integration key, no payment authority, no public route and no active
  application consumers. Zero customer charges, payouts or entitlements.

## Next restricted execution gate
Private Store backend integration requires provisioning a Store-only
Cloudflare Worker or Vercel deployment and securely attaching the
dedicated Neon connection string as a **platform secret** (never a
Git-tracked file or client-side variable). Only the owner or an authenticated
secrets-management connector should copy credentials between providers.
Then run read-only internal schema probes, endpoint request denial tests
and isolated integration tests **while checkout/callbacks remain disabled**.
Public route and real merchant/payment authorization remain separate gates.

Reviewer program: **Phase 1 RUNNING**, Phase 2 PENDING.
Keep Store PR #27 OPEN/DRAFT/UNMERGED, frozen PR #1 and protected main.

## Privileged Neon role safety discovery

A dedicated prospective runtime role `musitu_store_v2_runtime` was created
**inside this new Store branch only**. Independent PostgreSQL role readback
showed that the Neon role-creation API assigned membership in
`neon_superuser` with CREATEDB, CREATEROLE and BYPASSRLS. Attempts from the
staging owner to revoke `neon_superuser` or set NOLOGIN were **permission
denied**. Therefore this role is **NOT** least privileged and must **NOT**
be used by a billing Worker. No application uses it and its connection
password was not exported, committed or attached to any environment.
A secure runtime role needs Neon provider/admin privilege correction or
separately approved role cleanup; no claims of least-privilege production
qualification are made. Neon deletion tools require separate owner approval.

