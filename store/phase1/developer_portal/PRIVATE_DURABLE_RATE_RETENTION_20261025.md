# MUSITU Store V2 — private operator-only quota retention candidate (25 October 2026)

**PRIVATE CANDIDATE ONLY. PHASE 1 RUNNING. NOT DEPLOYED OR A RELEASE GATE WAIVER.** This supplements, and does not supersede, `PRIVATE_DURABLE_RATE_GATE_AND_REVIEWER_SCOPE_20261025.md` and the authoritative whole-product handoff. Signed Store V1, main, PR #1 and #27, and PR #32 draft remain protected.

## Problem, boundary, and proof

The durable PostgreSQL request gate enforces per-minute actor and publisher quotas with immutable identity and revocation verification. Its `portal_rate_windows` table deliberately stores each minute's counters. Without a retention operation the table and index can grow without limit, leading to unbounded private staging resource use.

The private candidate adds `store_publisher_private.prune_portal_rate_windows(p_batch_size integer)` to the existing rate-gate candidate SQL. It always computes the cutoff using **the PostgreSQL server clock**; it deletes only windows **older than the current minute minus two**, keeping the live minute and the immediately preceding minute safe from a racing request started near rollover. At most **1000** rows may be removed per invocation. It uses a fixed search path, bounded row selection, `FOR UPDATE SKIP LOCKED`, and denies `PUBLIC` execute privilege. It does not grant any production roles or schedule any jobs; only an independently provisioned, audited maintenance role may be explicitly authorized later.

`postgres-rate-retention.mjs` provides a deliberately small, **non-HTTP** caller for a separately trusted parameterized PostgreSQL query. It takes only a bounded batch size, passes a parameterized function call, and refuses invalid result shapes, out-of-range counts, or database outages. No cutoff, time clock, scope, tenant, deletion filter, token, endpoint, credentials, or grants can be supplied through its API.

Red phase: four Node tests against an unimplemented stub failed as expected. Green phase: all Node tests (including the four new tests) pass. `postgres-rate-retention.regression.sql` tests batch limits, repeated cleanup, preservation of active and previous-minute rows, invalid sizes, and `PUBLIC` execute denial inside a transaction ending in `ROLLBACK`. GitHub CI executes it on a disposable PostgreSQL 16 service after the other security schemas. **No local PostgreSQL server is installed in this environment; until the independent disposable CI succeeds, SQL validity and behavior remain unverified.**

## Operational and security boundaries

- Do **not** deploy the candidate to the existing live Neon staging project or Vercel. No operator cleanup job exists or is scheduled.
- Before any production use: independent DBA/security authorization, RLS and service-role review, grants scoped to a separate maintenance identity, privacy/data retention/legal acceptance, monitoring and alerting, operator audit, recoverable backups, and PostgreSQL concurrency load verification.
- Never give the regular portal API role permission to execute `prune_portal_rate_windows`; never expose it as an HTTP route. The current function is a candidate with no service grants.
- This cleanup applies only to **quota counters**, NOT submissions, private quarantined APK bytes, rights evidence, signed reviews, account records, exports, receipts, refund information, or live customer data.
- The operator must repeat a bounded batch operation as necessary; there is no unbounded deletion operation or user-defined retention cutoff. Removal of expired quota counters does not release a publisher's or person's *current* quota.
- No genuine publisher (0/3), third-party app (0/2), payment, signed APK malware verdict, live IdP, private portal deployment, or Store V2 release authority can be inferred from these tests.
