# MUSITU Connect — synthetic tenant deactivation contract

**Assessment: 23 October 2026. Local-only engineering evidence, not a hosted
Cloudflare staging qualification or customer offboarding authorization.**

## Why this operation exists

A real enterprise product needs an operator-controlled way to stop an
organization from creating new requests. Merely suspending the tenant leaves
active credential records in the registry. The preparatory
`deactivateOfflineTenant({env,tenantId})` operation in
`connect/customer_provisioning.mjs` closes that gap for **synthetic test
tenants only**.

This function has no HTTP route, no admin login, no production Worker import,
no customer access or customer-facing delivery. It refuses to run unless
`CONNECT_CUSTOMER_PROVISIONING_MODE` equals the exact
`isolated-synthetic-only` string. Do not configure this flag on production.

## Exact data behavior

Given an existing tenant ID, a single D1 `batch()` transaction:

1. Sets that tenant's status to `suspended`.
2. Revokes **all** of its nonrevoked credentials, including credentials for
   both Mining scopes.
3. Returns only the synthetic tenant ID, suspended status, and number of
   newly revoked credential records.

A repeat of the same operation is idempotent (zero additional revocations).
It does not modify other tenants. Missing tenants return a sanitized 404.
Missing D1 `batch()` support, unexpected database errors and untrusted
configuration return sanitized fail-closed responses.

**The historical usage-event trail and quota records are intentionally
retained. This is NOT privacy-law data deletion.** Storage retention,
data-subject requests, contractual requirements and required audit retention
must be resolved by legal, privacy and operations owners before deploying a
real lifecycle process. Do not assume revocation alone completes offboarding.

The `batch()` boundary matters: deactivation must not leave a tenant
suspended while a failed second database operation leaves credentials
active. The local test suite intentionally aborts credential revocation
through a test-only D1 trigger, verifies the complete transaction is
rolled back, and confirms another tenant remains untouched.

## Reproducible offline verification

Run the pinned nonproduction CI job
`MUSITU Connect local D1 runtime contract (non-admission)`.
Its local-only Miniflare/workerd D1 suite includes:

- Atomic suspension/revocation, quota and history retention.
- Denial of newly issued credentials and previously held credentials.
- Cross-tenant isolation and repeated idempotent deactivation.
- Fail-closed behavior for missing tenant, disabled mode, missing batch.
- An intentionally failed revocation which rolls the suspension back.

The initial disabled seam failed the two new synthetic deactivation tests
as expected in GitHub run `39897059135`. After implementation, run
`39897155827` passed the expanded local D1 contract. Run
`39897258090` passed **6/6** local D1 tests, including the forced
transaction rollback probe, and **14/14** reference SQLite tests plus
**4/4** local Worker request tests.

The test harness is local. No hosted D1 instance was contacted. These
assertions do not establish global latency, cross-region consistency,
real-world identity validation or automated compliance with deletion
obligations.

## Remaining release blockers

The controlling document is
`qualification/musitu_connect_beta_release_gate.json`.

Real customer offboarding still requires administrative authorization,
identity-bound approval, authenticated audit records for the change,
support escalation, a deletion/retention procedure approved by legal,
backups and replication cleanup, evidence of revocation propagation, and
independent hosted D1/staging qualification. Customer beta admission,
customer publication, ChatGPT plugin publication, production migration,
and production methane predictions all remain explicitly **blocked**.

Existing authorized Connect-to-Axiom production computation is unchanged.
