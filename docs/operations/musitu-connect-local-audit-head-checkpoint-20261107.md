# MUSITU Connect — local audit terminal-head checkpoint (2026-11-07)

**Disposition:** Source-only local SQLite integrity improvement. It does not qualify customer admission, hosted Cloudflare D1, Neon, a deployed Worker, mine-specific prediction, or external audit evidence.

## Threat and bounded implementation

The existing `RUN_RECORDED` genesis binding and per-event SHA-256 links detect changed, missing-genesis, or internally broken audit history. They do **not** detect a deletion of just the final valid event, because the shorter prefix is still a valid hash chain. The preceding audit-write fix therefore could append to a shortened, otherwise consistent chain.

`connect/persistence.py` now creates a separate local `run_audit_heads` table and transactionally persists the `(event_index, event_hash)` for every run. New-run creation commits the run row, initial audit events, and terminal checkpoint together. Normal later append and idempotent ingest operations update the terminal checkpoint in the same transaction as the audit event. An existing head must match the previous event index and hash; an inconsistent or missing head fails closed. `verify_audit_chain` also requires the terminal checkpoint to match the final verified event. The existing public methods reject further writes with `RUN_AUDIT_CHAIN_INVALID` when the checkpoint or event chain is invalid.

**Legacy-store behavior:** the new table is created non-destructively on open, but existing stored audit rows are **not automatically assigned a terminal head**. Such runs fail verification and idempotent writes until a separate, approved and independently attested migration process exists. Automatically trusting the final row of an old history would silently accept a prior suffix deletion. No existing database was migrated as part of this feature-branch change.

## Regression verification

`tests/connect/test_audit_head_checkpoint.py` uses only disposable local SQLite and covers:

- Deleted final event rejected, even though all remaining event hashes match.
- Deleted final ingest-completion event rejected, and idempotent ingest does not extend the shortened history.
- Missing or modified checkpoint rejected; reopen does not invent a replacement checkpoint.
- Valid checkpoints survive process reopen and permit normal append.
- Simulated checkpoint insert/update failures roll back the run/audit transactions rather than committing partial writes.

Before implementation, the first two scenarios produced expected failed assertions (`verify_audit_chain` returned true for a shortened chain). After implementation, all checkpoint tests and relevant persistence/runtime regressions passed locally. The full Python discovery run exceeded the local execution limit and is **not** counted as passed. The exact committed SHA must also pass GitHub CI before qualification is reported.

## Security limits and gates

This checkpoint is **inside the same SQLite database** as the event chain. An actor able to rewrite the entire database can modify the event rows and checkpoint consistently; this is **not an external immutable anchor**, write-once storage, or independently attested forensic record. The implementation does not prove protection against full-DB replacement, loss of the entire database, or a hostile database owner. Independent immutable evidence storage and a controlled legacy-database migration would require separate design and authorization.

No live credentials, hosted D1 or Neon writes, public Connect publication, production deployment, customer beta admission, model retraining, frozen-threshold adjustment, or methane-prediction promotion are authorized or performed. The authorized general-purpose production Connect-to-Axiom arithmetic path remains untouched.
