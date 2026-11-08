# MUSITU Connect — sealed ingest digest admission control (2026-11-08)

**Scope:** feature-branch source and disposable local SQLite only. No hosted Cloudflare D1 or Neon mutation, live Worker release, customer credential issuance, beta admission, main-branch modification, or methane-prediction promotion.

## Integrity defect

`RunStore.record_ingest_run` accepted a syntactically valid caller-supplied `sealed_canonical_sha256` without comparing it against the incoming canonical records for a new run. The function could commit `connect_runs`, `run_audit` and `run_audit_heads` rows using a forged or stale digest and return success. A later load/replay would detect the mismatch, but that was too late: an invalid run had already been committed.

The supplied hash is no longer treated as an authority. When present, the store validates the 64-character lowercase hexadecimal digest and independently computes the canonical payload SHA-256 before checking for existing runs or executing any write. A mismatch raises `ValueError("sealed_canonical_sha256_mismatch")`, with no new run, audit or terminal-head rows. Correctly sealed ingests retain the original public API and ledger semantics. A missing optional digest continues to use the existing locally computed SHA-256.

This independent digest computation adds a canonical serialization and SHA-256 pass for ingests that supply a precomputed seal; it is an integrity-versus-throughput tradeoff and must not be hidden in a benchmark claim. Subsequent mutable-row concurrency and full service-level performance require separate qualification; this change does not certify a mine connector, hosted database, or immutable event custody.

## Test-driven evidence

`tests/connect/test_sealed_ingest_digest_integrity.py` exercises: (1) forged well-formed digest rejected before any ledger write, (2) changed mutable canonical row after sealing rejected before any ledger write, (3) a genuine digest still produces a complete, verified run with the expected initial audit and head. Before the fix, the first two tests failed because no `ValueError` was raised; the normal ingest passed. After the fix all three pass.

In the offline copied source workspace on 2026-11-08: `python -m unittest -q tests.connect.test_sealed_ingest_digest_integrity tests.connect.test_persistence tests.connect.test_persistence_storage_canonical_integrity tests.connect.test_run_id_provenance_idempotency tests.connect.test_persisted_json_fail_closed tests.connect.test_mining_adapter tests.connect.test_runtime tests.connect.test_contract` completed 48/48 passing, and selected Node customer/worker tests completed 41/41 passing. Two separately named newer audit modules were absent from that older extracted workspace; an initial broad command experienced test-import errors for those paths, not test assertion failures. The exact current GitHub feature-branch source and wider tests must be verified by GitHub CI after commit.

## Unchanged release and research gates

The existing authorized Connect-to-Axiom **general arithmetic** production capability remains unchanged. No real customer credential, hosted database modification, deployment, PR merge or publication is authorized. Frozen methane history, horizon, stride, hard-warning and score thresholds, four-fold chronological qualification and independent mine-evidence requirements remain untouched. Synthetic/public data and successful general-purpose CI do not qualify methane prediction or customer beta release.
