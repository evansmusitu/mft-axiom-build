# Phase 2.7B bounded security review

- Operator-only opt-in activates a monotonic, persisted tenant-fair rotation. No model provider, caller, unverified worker or fact-source claim may choose a queue's priority.
- SQLite uses its existing BEGIN IMMEDIATE claim transaction. Fair selection, lease state and service sequence commit atomically; on error the sequence is rolled back. Reopening the repository does not reset the sequence.
- PostgreSQL takes SHARE on the mode table, then a row lock on the global cursor before selecting FOR UPDATE OF job SKIP LOCKED. Activation takes an incompatible EXCLUSIVE table lock, preventing unguarded claims during mode installation. Locking serializes fair claims and intentionally trades throughput for deterministic order.
- Authenticated worker claims preserve Ed25519 worker authentication, independent server-signed lease capabilities, immutable persisted intents and signed operation receipts. Exact replay returns the receipt before running selection or updating the cursor; failures and idle operations cannot advance fairness.
- Within a tenant, oldest eligible createdAt/jobId wins. Between tenants, the least-recently-served tenant wins. A new tenant has an ordinal of zero and is eligible next. Expired leases remain fenced via increasing epochs.
- Legacy FIFO mode remains unchanged if explicit mode is not enabled. Fairness must be activated before exposing production workers; presence of tables alone is not a fairness guarantee.
- The scheduler persists mutable, unkeyed operational state; SQL administrators are a trusted role. It does not cryptographically attest scheduler choices against privileged database mutation.
- No weighted-fair or resource-based scheduling, tenant concurrency ceilings, transport authentication, provider cost control, latency SLA, deployment/HSM provisioning, side-effect exactly-once, model truth or profit guarantee is claimed.

Verification: SQLite fairness tests, authenticated SQLite signed-receipt replay and cursor invariants, PostgreSQL legacy + authenticated shared cursor, Phase 2.7B gate, all earlier Phase 1/Phase 2/PostgreSQL suites. Final merge requires exact-head pipeline, MR-native pipeline, non-squash source retention and postmerge main pipeline.
