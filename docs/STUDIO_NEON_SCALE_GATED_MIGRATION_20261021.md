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
