# MUSITU Connect — local run-audit write integrity (2026-11-07)

**Scope:** source-only hardening of the disposable/local `RunStore` SQLite ledger. Not a Cloudflare D1, hosted Neon, customer-admission, deployment, or methane-safety qualification.

## Write boundary

A stored Connect run has a `RUN_RECORDED` genesis event bound to its canonical SHA-256, connector and protocol. `RunStore.verify_audit_chain` also verifies ordered indices, previous hashes, and the event hashes against the stored canonical run. A missing run or missing/malformed genesis is invalid.

Before appending a later audit event, `append_audit_event` now requires both a valid stored run and a valid existing audit chain. Before accepting a duplicate `run_id`, both `record_run` and `record_ingest_run` require that same audit-chain check. Failure raises `RUN_AUDIT_CHAIN_INVALID` **without adding an audit row**. New-run creation continues to atomically insert the run plus genesis (and ingest-completion, where applicable).

## Reproducible negative and positive evidence

The disposable SQLite regression suite is `tests/connect/test_audit_append_fail_closed.py`:

- Changed genesis payload: later event and idempotent replays are rejected.
- Deleted history: a later event cannot start a replacement chain.
- No rejected write increases the audit-event count.
- Untampered audit history still supports valid event writes and idempotent ingestion.

Focused local TDD: four expected pre-fix failures; five post-fix passing tests. The relevant Python persistence/runtime/telemetry subset passed 30 tests. The unrelated offline customer/worker Node contract suite passed 93 tests. Branch CI remains a separate verification requirement for the exact committed SHA.

## Trust boundary and limitations

A local SHA-256 event chain is **not externally anchored**. An actor with sufficient database write access could replace an entire self-consistent ledger; an otherwise consistent final suffix deletion cannot be detected by hash links alone without an independent event-count or checkpoint anchor. This change does not claim to prevent those attacks, to add a database signing authority, to replace backups, or to establish independently audited customer evidence. It only ensures **normal application writes do not extend already-detectably-invalid histories**.

The separately authorized production Connect-to-Axiom arithmetic path and the frozen methane research model remain unchanged. New customer admission, hosted D1 mutation, production deployment, public release, credentials, and production methane prediction remain blocked pending independent authorization.
