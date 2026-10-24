# MUSITU Studio V0.3 — origin-trigger execution and canonical R2 namespace gates

**24 October 2026 — SOURCE-ONLY on Studio experimental branch. Production: NO-GO.**

## Motivation

PostgreSQL ordinary triggers can be skipped if an elevated import connection has `session_replication_role='replica'`. Checking `pg_trigger.tgenabled='O'`, table/event topology and body is necessary but insufficient in a session where origin triggers do not fire. `importFrozenStudioLedger()` now reads `current_setting('session_replication_role')` **inside the SERIALIZABLE import transaction**, after establishing the local search path and **before** any ledger row insertion; it accepts only exact `origin`. A missing/null response, `replica`, `local` or query error aborts and rolls back the transaction. This is not independent proof of the client's role or full PostgreSQL privilege containment. The guard must be complemented by a non-superuser, least-privilege import role and external provider attestation before actual migration.

Studio V0.3 production assets are addressed using `safeObjectKey(job_id, filename)` from `musitu_studio/edge/src/v03_policy.mjs`. The SQLite `assets.object_key` schema allows unconstrained text, so a corrupt export or source metadata could name a different tenant's, V0.2's or traversal-style object reference. `normalizeStudioLedgerSnapshot()` now requires every referenced asset's key to be *exactly* that deterministic V0.3 path. It rejects keys for invalid/non-UUID job IDs, mismatched filenames/jobs, V0.2 prefixes and any extra suffix. The schema and `safeObjectKey` remain unchanged; the migration adapter uses the same centralized production key-generation policy instead of duplicating a namespace rule. This does not prove the R2 object exists or its full bytes match the attested asset hash; provider-backed HEAD + content hashing is still mandatory.

## Reproducible evidence (offline fixture, not a live provider check)

1. Before implementation, added two targeted negative tests and observed both failing (`not ok 16`, `not ok 34`) using Node 22.
2. With the guards implemented and legacy synthetic fixture keys aligned to canonical V0.3, `node --test musitu_studio/neon/tests/*.test.mjs` passed **105/105**, including synthetic transaction rollback and actual isolated in-memory SQLite write-fence tests.
3. Existing offline GLB tests passed **23/23** on Node 22. Complete Edge suite requires its external `jose` dependency and must be rerun by GitHub Actions against the exact pushed commit; local npm installation was unavailable in the current isolated execution environment.

## Non-authorizations

No Cloudflare Worker or live SQLite DO changed; no real owner source export was read; no Neon write/compute/network reconfiguration; no customer R2 read; no staff policy changes; no billing or Modal execution was enabled. The release gate remains **NO-GO** until all live source backup/restore, owner browser acceptance, complete R2/immutable-audit reconciliation, protected private networking, real rollback and enforceable spending conditions are independently proven.
