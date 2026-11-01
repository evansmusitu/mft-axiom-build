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

## November 1 follow-up: hosted least-privilege and UUID-v4 proof

The isolated Neon project `morning-bread-51442570` was tested again using
short-lived, explicitly bounded SQL access windows. After **each** window,
the project was read back with `block_public_connections=true`.

**Role permissions:** a new `musitu_connect_qual_runtime` PostgreSQL
`NOLOGIN NOINHERIT` role was granted schema `USAGE` and `EXECUTE`
on only `connect_qualification.admit(text,text,uuid)`. Live PostgreSQL
`has_*_privilege` checks confirmed no direct tenant/credential reads,
event inserts, or quota-counter updates. The role has no login credentials
and is **not** an authorized customer-facing application identity.

**Red/green source-integrity test:** prior to the database fix, the
`admit` function erroneously accepted synthetic UUIDv1
`11111111-1111-1111-8111-111111111111`, creating one immutable audit
event. This is historical test evidence, not customer data; it was not
deleted to manufacture a clean history. The corrected
`infra/connect_customer_neon_qualification.sql` additionally verifies
UUID bytes using `uuid_send` before any event write. Live repeat checks:
a fresh v1 UUID was rejected, an invalid RFC-4122 variant was rejected,
and a valid UUIDv4 was admitted. Only the valid request increased the
new counter: two auditable events total for the dedicated synthetic
`tenant_v4proof` including the earlier red-test record. The original
request-ID failure is therefore covered at the **database** boundary,
not merely by JavaScript prevalidation.

**Automation:** `qualification/neon_pg_contract_test.py` runs against
an **ephemeral PostgreSQL 17 CI service**; it tests SQL role grants,
direct table denial, invalid UUIDs, 16 competing SQL clients for a
3-request daily quota, minute-quota isolation, replay, revocation, and
append-only audit events. The new CI evidence is separate from the
actual hosted-Neon checks and is not by itself a hosted production
or app-to-Neon qualification.

**Still blocked:** production auth role, hosted multi-process concurrency
on a deployed application, approved connection lifecycle, real customer
tokens, operational revocation/rollback, disaster recovery, safety
review, and release authorization. No existing Cloudflare Worker or D1
binding was changed.
