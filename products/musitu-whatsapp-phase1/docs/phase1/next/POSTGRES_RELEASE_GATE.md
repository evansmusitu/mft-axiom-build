# Native PostgreSQL release gate — NOT MET

The private-stage development database is SQLite. Candidate schema migrations are `db/001_private_tenant_core.sql`,
`db/002_faq_draft_rls_candidate.sql` and `db/003_runtime_role_permissions.sql`.
`src/postgres/tenant-repository.mjs` implements transaction-local tenant scope,
role verification, metric/draft reads and booking with a mocked-client unit
suite. `scripts/postgres-native-qualification.mjs` and
`.github/workflows/private-postgres-qualification.yml` define the genuine
PostgreSQL 17 qualification run, but were not executed here.
None of these migrations were executed here: there is no PostgreSQL server, `psql`, or
real application role on this host.

A later qualified step MUST provision an isolated PostgreSQL 17 instance and:

1. Create a separate migration owner and a runtime login that is **not** a
   superuser/table owner and lacks `BYPASSRLS` and schema-creation privileges.
2. Apply `001` and `002` as migration owner; inspect `pg_policies`, `pg_roles`,
   unique constraints and `FORCE ROW LEVEL SECURITY` after executing.
3. Use only transaction-local, verified `app.tenant_id`; reset context on every
   pooled connection. Assert no tenant context returns zero rows and cannot write.
4. Seed UUID tenants A and B via a specifically authorized provisioning role.
   As tenant A's runtime role, attempt reads, updates and inserts against B's
   conversation/FAQ/booking/draft rows; every cross-tenant operation must fail
   or return no rows. Repeat after connection reuse and rollbacks.
5. Launch at least two concurrent transactions against the same resource and
   time range; exactly one booking must commit; check the exclusion constraint
   itself, not just application pre-checks.
6. Probe webhook address binding, unknown/revoked phone, token expiry, duplicate
   inbound/status events, malicious input and pre-existing replay after restart.
7. Exercise encrypted backup/restore on an isolated database and verify no
   duplicate outbound work is triggered on restart.

Until a separate signed test report supplies these results, PostgreSQL RLS is
**DESIGNED BUT NOT TESTED**. No external production database was accessed.
