# MUSITU Connect — isolated Neon PostgreSQL qualification, 1 November 2026

**Scope:** nonproduction **synthetic-only** database experiment, **not** a release
approval and **not** evidence that the existing Cloudflare Worker has migrated.

## Isolated project identity and security

- Project: `morning-bread-51442570` (`MUSITU Connect Neon Tenant Qualification - Isolated 20261101`)
- Default qualification branch: `br-fragrant-shape-b4egv2ux` (`isolated-synthetic-only`)
- Database: `connect_qualification`; PostgreSQL 17; `aws-us-east-2`
- Newly created for this exercise; no Studio, Store, AXIOM, or existing Neon
  database, customer identity, production token, production binding or project
  was modified.
- Remote SQL qualification temporarily permitted network connections for the
  **empty, new isolated project only**. After testing, the Neon project settings
  were read back with `block_public_connections=true`.
- No raw bearer credentials were generated or stored. Test credential
  fingerprints were synthetic 64-character placeholders.

## PostgreSQL-only database contract exercised remotely

A new `connect_qualification` schema contains `tenants`, `credentials`,
`daily_usage`, `minute_usage` and `events` tables, constrained foreign keys
and quota counters, and the `connect_qualification.admit` SQL function.
The function derives the tenant from the credential digest, enforces expiration
and scope, locks the tenant and credential rows with `FOR UPDATE` before
checking quota limits, derives UTC day/minute from the **database**
`transaction_timestamp()`, and atomically inserts an append-only event and
increments the daily/minute counters in one SQL transaction. A separate
`events_append_only` trigger blocks ordinary update/delete operations.
Schema/table/function access was revoked from `PUBLIC`.

Neon returned these direct, remote SQL outcomes for synthetic tenants:

| Query / test | Observed outcome |
| --- | --- |
| First admission, Alpha, daily/minute quota 1 | `ADMITTED`; daily used 1 |
| Second request for Alpha, parallel submitted | `CUSTOMER_QUOTA_EXCEEDED`; daily used 1 |
| Beta (separate credential, plan scope restricted) risk admission | `ADMITTED`; daily used 1 |
| Beta credential attempting plan scope | `UNAUTHORIZED`; no tenant returned |
| `SELECT count(*)` of accepted events | One event per tenant |
| Daily/minute count reconciliation | Both counter types 1 per tenant |
| `pg_trigger` for append-only | Enabled (`O`) |
| `has_schema_privilege('public', ..., 'USAGE')` | false |

**Limitations:** a concurrent submission through the connector does not prove
independent cross-process racing or exactly-once distributed retry behavior.
No read-only runtime role integration, customer revocation recovery under load,
real HTTP Worker binding, penetration test, network failover test, retained
audit-export policy, or production release evidence was obtained. `SECURITY
DEFINER` functions require dedicated runtime role grants, security review, and
tightened least privilege before application use; there are currently no
customer-facing route integrations. Do not claim D1 qualification by doing a
Neon test, and do not assume existing D1 SQLite SQL is PostgreSQL compatible.

## Independent methane-source discovery

A bounded GitHub Actions workflow
`.github/workflows/musitu-independent-mine-discovery.yml` checks for a
provider-specific `BRIGHTDATA_API_KEY` and SERP zone. It never prints or
archives secret values and makes **at most one** external discovery request,
only if both are present. A similarly spelled `BRICKDATA_API_KEY` is
**not** passed to Bright Data because its provider has not been verified.
All found links are **unverified leads** and the report always says
`independent_methane_model_qualified=false`. No dataset is ingested into the
frozen methane model and none is promoted.

## Boundaries and remaining approval

The existing SQLite/D1 admission module remains an isolated prototype, and
the authorized live arithmetic Worker remains unchanged. Switching the Connect
customer backend to Neon requires a separate reviewed PostgreSQL adapter,
dedicated auth/runtime role, remote isolation and concurrency verification,
lifecycle/revocation tests, rollout/rollback procedure, customer/operations
and legal approvals, and an explicit later deployment authorization. The
frozen LightGBM model hashes and chronological qualification gates are
unchanged; neither Bright Data SERP discovery nor the existing Polish public
development dataset can replace an independent physical mine holdout.
