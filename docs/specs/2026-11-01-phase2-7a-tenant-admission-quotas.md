# Phase 2.7A: tenant job admission capacity

Canonical base: GitLab main `8c1e219fe6bf0729ea370161d92eb450995417b6`; issue #14.

## Threat model
A correctly authorized dispatch must not admit an unlimited number of outstanding jobs for one tenant or cause another tenant's capacity to be consumed. A concurrent dispatcher must not bypass a capacity limit. An idempotent repeat of an existing job is allowed even when capacity is full and must not create additional work or change the original intent.

## Contract
- Capacity is a *server-owned/operator-configured* positive integer maxOutstandingJobs per tenant, never taken from API request or a model.
- Tenant capacity counts `PENDING` + `LEASED`; terminal jobs no longer consume capacity; retries/reclaims never create new jobs.
- SQLite uses `BEGIN IMMEDIATE` admission + count + insert. PostgreSQL locks the tenant's quota row `FOR UPDATE` before count + insert to serialize competing dispatchers, even across processes.
- No configured entry for the tenant under enabled quota mode => fail closed. No quota mode => legacy compatibility, not a production quota guarantee.
- Once a quota record is registered, an attempt to silently change its policy hash is rejected. New policies can only be added at original bootstrap; live policy edits require a separately authorized migration.
- Do not allow policy installation with duplicate tenants, malformed tenant IDs or invalid capacity.
- Registration of all rows and the quota-enable marker is transactional.
- A rejected job creates no job or execution intent, and cannot leak another tenant's details.
- Tenant isolation, immutable dispatch identity, world snapshots, signed runtime semantics, authenticated worker privileges, and the Phase 2.6 compatibility matrix are unchanged.
- This phase does not promise weighted-fair scheduling, per-provider cost accounting, remote worker transport, rate limiting, or commercial outcomes.

## Acceptance
RED -> GREEN tests SQLite and PostgreSQL for over-capacity denial, exact idempotent replay at capacity, terminal capacity release, cross-tenant independence, missing tenant denial, invalid configuration and incompatible reconfiguration; new isolated acceptance gate and current Phase1/Phase2/PostgreSQL suites. A successful source-head CI, MR-native CI, non-squash merge preserving source branch and post-merge CI are mandatory.
