# MUSITU Studio V0.3 — Neon Scale migration, gated production conversion
Date: 2026-10-21. Owner approved Neon Scale as the **future production database after successful testing**.
Never confuse this with permission to lose customer data, relax Access, or incur uncapped charges.

## Verified real-provider staging
Neon organization entitlement: Scale (confirmed via connected Neon provider).
Dedicated proof project: `MUSITU Studio V03 Neon Scale - Isolated Recovery Proof 20261021`,
Postgres 17, AWS us-east-2, fixed 0.25 CU, 60-second suspend, six-hour history.
Per-project hard quotas: active_time_seconds=600, compute_time_seconds=150,
written_data_bytes=2,097,152, data_transfer_bytes=5,242,880, logical_size_bytes=33,554,432.
Network access `block_public_connections=true` was independently read back
after each short, supervised synthetic test. This is NOT a dollar-denominated
or account-wide $0 billing ceiling.

Prior baseline synthetic snapshot recovery: `snap-polished-thunder-b574p84y`,
confirmed pre-mutation rows restored to isolated branch, with post-snapshot data absent.

Current Postgres migration: `musitu_studio/neon/0001_enterprise_postgres_schema.sql`
(21 atomic DDL statements; six dedicated tables). On independent Neon proof branch
`br-aged-darkness-b5rcfajm`, actual Neon SQL successfully executed all 21 statements,
confirmed six tables and six PostgreSQL security triggers.
Synthetic-only owner, membership, pending job and immutable audit were inserted.
Four real provider database tests passed:
1) UPDATE of audit denied;
2) DELETE of audit denied;
3) inserting an asset into pending job denied;
4) completing a job without all three assets denied.
The original audit, pending job and empty assets persisted unchanged.

A new **hosted Neon snapshot AFTER the enterprise schema** was created
(`snap-soft-mountain-b5d6gx6h`), restored without replacing the source to
`br-noisy-math-b5xu9qrb`, and read back:
projects=1, jobs=1, audit_events=1, migrations=1, security_triggers=6,
pending_jobs=1. True provider snapshot + schema/trigger/data recovery proven
FOR SYNTHETIC NEON STAGING ONLY. No Studio customer data copied.

## Hard gates before any live Neon traffic / cutover
1. Obtain read-only, authorized export of live Cloudflare SQLite DO from a genuine
   authenticated owner context, without bypassing Access, dumping credentials,
   retaining secrets in GitHub artifacts or accidentally exposing staff identities.
2. Compare source-vs-target counts, hashes and dependency-order imports for ALL
   projects, memberships, jobs, assets and immutable audit events; retain R2 objects
   in their existing protected bucket; test pointers/digests.
3. Rework the V0.3 SQLite-specific statements (`?` parameters, `changes()`,
   conditional audit-in-batch, `substr/date`) into SERIALIZABLE/atomic PostgreSQL
   transactions. Prove that audit and state transitions always commit or roll back
   together under concurrent owners/reviewers and repeated requests.
4. Prove production Cloudflare Worker -> Neon connection using a **documented
   least-privilege private or equivalently protected network path** without broad
   public database exposure, leaked database URLs, or Access bypass.
5. Implement an operator-controlled maintenance/freeze window, deterministic
   import, signed identity continuity, delta reconciliation, cutover verifier,
   and fail-closed rollback to intact SQLite DO if any check fails.
6. Run real signed-Access browser end-to-end project create, submit,
   single-owner explicit approve, authorization revocation, immutable audit,
   R2 artifact reads, and recovery on the staged Neon backend. Confirm exactly
   one genuine authorized owner, no global-superadmin overgrant.
7. Establish account-wide spending approval and provider-backed hard maximum,
   not just project consumption quotas. Neon Scale usage-based bills can occur.
8. Requalify Studio data-recovery SLA for the **actual production** Neon database
   and its real history/snapshot retention; synthetic recovery doesn't migrate
   or back up SQLite Durable Object.
9. Keep CPU/GPU rendering and Modal paid operations source-locked; Neon billing
   cannot prove or control Modal zero-out-of-pocket enforcement.

## Critical status
Owner authorization: YES, conditional on successful end-to-end migration tests.
Neon Scale synthetic schema and hosted restore proof: PASS.
Production live data export/import and private Worker connectivity: NOT PROVEN.
Zero-overage Neon Scale + Modal bill guarantee: NOT PROVEN.
Live V0.3 production DB cutover: **NOT PERFORMED**.
Cloudflare Access, signed owner fingerprint, existing SQLite customer DO, V0.2,
R2, Axiom main branch and paid render locks must remain unchanged.

## Staging-only PostgreSQL transaction adapter and CI

The additive proof at `musitu_studio/neon/neon_pg_adapter.mjs` is a
**testable but NOT DEPLOYED** backend boundary. It uses injected PostgreSQL
clients so its initial regression suite does not need any credentials or
billable Neon compute. It maps bound `?` placeholders to PostgreSQL
`$1,$2,...`, sets the isolated `studio_v03` search path, and performs
each multi-statement Studio batch in one `SERIALIZABLE` transaction.
The SQLite-only conditional audit `WHERE changes()=1` is transformed into
an insert iff the immediately preceding PostgreSQL UPDATE affected one row;
any audit error forces rollback, never a successful orphan approval.
The implementation refuses DDL, stacked queries, missing row counts,
unrecognized conditional audit operations, and unsupported SQLite date
calculations. Tests cover both successful and failed atomic transitions.

**Not a production-ready proof by itself:** no Cloudflare Worker runtime was
switched to this adapter; no real Neon-backed signed-Access job approval
or R2 download has been independently exercised; no secure private
Cloudflare-to-Neon connection has been provisioned. Actual Studio data
export/import with counts and hashes remains pending. In particular,
runtime CPU dispatch stays disabled; its SQLite `date(substr())` query
is intentionally rejected by the adapter until individually migrated
and financially authorized. A role password, database URL or service token
must never be added to GitHub source, Actions logs, browser responses,
or publicly available pages.

## Source-only migration reconciliation — 2026-10-21 continuation

Added `musitu_studio/neon/ledger_reconcile.mjs`. The module does **no**
network or cloud work. Given an owner-authorized complete and frozen
Cloudflare SQLite snapshot and a separate Neon destination readback, it
canonicalizes *all five business tables*, verifies each required column,
unique record keys, role/foreign-key integrity, approval/audit lineage,
completed asset counts, and compares **every row** using SHA-256 HMAC under
a caller-held random 256-bit key. The external receipt contains only keyed
table digests and counts, never project names, actor subjects, payloads,
Staff IDs, raw R2 keys or secret material. A partial export, unmatched
freeze identifier, missing/modified row, missing audit, unauthorized asset,
invalid hash, extra field, duplicate ID, or mismatch fails closed.

The staging-only PostgreSQL adapter now verifies that the conditional audit
job ID is the exact **`WHERE id=?` bound job** of the preceding `UPDATE jobs`
statement; accepting a random preceding parameter (e.g. actor identity) is
not sufficient. It also closes database clients even if initial `connect()`
fails. Tests cover successful approvals, denied/rolled-back mismatches,
failure to connect, forged membership-row authorization, incomplete exports,
malformed rows and audit tampering.

**No Cloudflare customer data has been exported**. A matching HMAC proves
content identity of two supplied complete ledgers **only when the frozen
source is independently authenticated and the destination is separately
read back**; it is not self-sufficient proof that the source is live or that
production routing has changed. Production remains on Cloudflare SQLite
Durable Object, and paid compute remains disabled. This source-only work
should not modify Neon usage, storage, snapshots or public connectivity.

### Private connectivity and costs remain a hard release gate

The currently isolated Neon Scale test project has
`block_public_connections=true`. Neon Private Networking uses **AWS
PrivateLink within an AWS VPC in the same region**; a global Cloudflare
Worker is not by itself such an AWS VPC client. Cloudflare Hyperdrive
connectivity must therefore be separately proven and should **not** be
assumed to provide AWS PrivateLink. Do not silently remove the public
network block to declare production ready, log a connection string, or
replace the existing Access identity guard. Per-project consumption quotas
and Neon Scale's pay-as-you-go plan do not constitute an account-wide $0
billing guarantee. Do not attempt cutover until explicitly testable,
least-privilege secure connectivity and spend safeguards are established.
