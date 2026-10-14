# Phase 1 continuation: PostgreSQL adapter and native qualification harness

Date: 2026-10-13. This work extends the October 12 archived private stage in a
new extracted workspace. It is not a production release or a change to AXIOM,
MAIL FABRIC or the user's connected GitHub repository.

## What is implemented

- `src/postgres/tenant-repository.mjs` is a `pg`-compatible, **asynchronous**
  adapter for tenant-scoped `snapshot`, `listReplyDrafts`, and `reserveBooking`.
  Each call leases one connection, starts a transaction, sets `app.tenant_id`
  using `set_config(..., true)` with a bound UUID, verifies an active member of
  an active tenant, and either commits or rolls back before releasing it.
- Booking uses the PostgreSQL `btree_gist` EXCLUDE constraint in migration 001,
  a resource-existence check, unique tenant idempotency keys, safe conflict
  rereads, explicit PostgreSQL `23P01` handling, and no external side effects.
- Existing private loopback API now awaits asynchronous store methods while
  retaining the previous pinned-JWT and membership protection.
- `db/003_runtime_role_permissions.sql` restricts the proposed runtime role to
  read-only table access plus INSERT bookings; no schema, tenancy, identity,
  payments or message-delivery mutation privileges.
- `scripts/postgres-native-qualification.mjs` exercises genuine PostgreSQL RLS,
  grants, missing session context, cross-tenant denial, concurrent booking
  collision, idempotent restart behavior and privilege isolation on a disposable
  loopback PostgreSQL 17 service. It refuses non-loopback or non-explicit runs.
- `.github/workflows/private-postgres-qualification.yml` is a proposed isolated
  repository CI workflow with ephemeral postgres:17. It has **not** been run on
  GitHub or copied into any MUSITU production repository.

## Evidence this turn

- Recorded RED: 10/10 focused tests failed `NOT_IMPLEMENTED` before creation of
  the PostgreSQL adapter's business behavior.
- Recorded GREEN: 10/10 focused adapter behavior tests passed.
- Recorded second RED: malformed rollback released a client twice; asynchronous
  HTTP endpoint serialized unresolved promise instead of awaiting it.
- Recorded second GREEN: both fixes and 12/12 focused tests passed.
- Recorded third RED/GREEN: malformed pooled connection leak prevented, 13/13.
- For source-check and complete suite evidence see
  `docs/phase1/next/POSTGRES_FULL_VERIFY_20261013.log` after final verification.

## Not proven and non-negotiable gates

`npm run verify` verifies LOCAL code and simulated `pg` client interactions.
It is **not native PostgreSQL qualification**. This container had no `psql`,
PostgreSQL server or Docker at audit time. The native qualification workflow
must run and its specific assertion outputs must be reviewed before converting
`db/001-003` from candidate migrations to production-qualified code.

The PostgreSQL adapter is not yet wired into the signed inbound webhook
pipeline, which still uses private local SQLite; it is not production egress.
Also absent: full Keycloak validation and revocation, approved live Meta app,
actual AI model gateway, production bookings via WhatsApp, customer dashboard,
AXIOM/Mail Fabric production connection, backups/restore, load tests, second
security review, real messages, real money, public traffic or paying customers.

## Recommended reproducibility

```bash
npm run verify
npm run demo:next
# On a fresh, dedicated localhost PostgreSQL 17 CI service only:
npm install --no-save --ignore-scripts --no-audit --no-fund pg@8
PG_ISOLATED_QUALIFICATION=YES \
  PG_ADMIN_URL='postgres://postgres:<test-only-password>@127.0.0.1:5432/postgres' \
  npm run qualify:postgres
```

Native script creates database `musitu_phase1_ci` and roles
`musitu_migrator`/`musitu_runtime`, then drops them. Never run against an
existing server with real customer data or those existing role/database names.
The private CI workflow demonstrates the expected exact environment. Do not
confuse a workflow definition with a successful workflow run.
