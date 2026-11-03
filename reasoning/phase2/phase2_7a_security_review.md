# Phase 2.7A Security Review

Phase 2.7A provides atomic per-tenant outstanding-job admission capacity, not fair scheduling or external cost quotas.

- Policy authority is operator configuration; model providers, workers and API request bodies cannot set the capacity.
- SQLite combines identity lookup, capacity count and job insertion in one BEGIN IMMEDIATE transaction.
- PostgreSQL serializes concurrent dispatch with policy row FOR UPDATE, and synchronizes quota bootstrap with admission through quota-mode table locks.
- Exact existing job identity replays at capacity without consuming another slot; differing requests require additional capacity.
- Capacity counts PENDING and LEASED, not terminal jobs. Tenant ID scopes both policy and count.
- Registry activation is transactional and monotonic, rejects unknown tenants, duplicates, invalid limits and incompatible configuration.
- The quota-enabled marker is mandatory for production enforcement; the legacy unconfigured mode remains available for migration, without any production capacity guarantee.
- The operator and database admin are trusted; unkeyed policy record hashes do not resist an attacker with unrestricted SQL admin control.
- Weighted fairness, max-concurrent leasing, provider spending controls, remote workers, rate limits and commercial/profit outcomes are deferred.

Completion requires exact-head CI, MR-native CI, non-squash merge with retained feature branch, and post-merge CI.

## Important concurrency finding: exact replay behind the capacity lock

The first PostgreSQL implementation selected an existing job before taking the tenant quota row lock. Two concurrent identical dispatches could each see an empty job table, then serialize, with the second incorrectly failing capacity instead of replaying the first committed job. A deterministic regression held the tenant quota row lock while submitting two identical requests; its RED pipeline `3015196578` failed at `TENANT_QUOTA_EXCEEDED`. The fix moves policy acquisition and row locking ahead of the existing-intent lookup and checks capacity only after that lookup. Re-run full exact-head conformance and PostgreSQL before MR eligibility.
