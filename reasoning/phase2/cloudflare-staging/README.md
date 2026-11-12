# AXIOM — Cloudflare Hyperdrive staging database preflight

**Status: PRE-DEPLOYMENT ONLY, NOT A PRODUCTION CONNECTION OR BILLING GATE.**

This independent, fail-closed read-only diagnostic tests an eventual staging-only **Cloudflare Workers → Hyperdrive → Neon PostgreSQL 17** connection. It does NOT make the Phase 2 Node.js API Workers-compatible, provision billing caps, certify a private network, install schema, or permit paid provider calls. Keep release issue [#74](https://github.com/evansmusitu/mft-axiom-build/issues/74) **NO-GO**.

## Current blocker

The existing dedicated Neon staging database has `block_public_connections=true`. The owner confirmed they use **Cloudflare Workers only**, without a Tunnel, VPC, or private server. Standard Hyperdrive requires a reachable database and uses Cloudflare's **shared outbound public IP ranges**. Hyperdrive's credentials validation will fail until Neon becomes reachable. **This PR does not open Neon or deploy a Worker.**

Before changing connectivity:

1. Obtain a security-reviewed, time-bounded **staging-only network exception** with monitoring and rollback, or install separately authorized private networking. Shared Cloudflare source ranges alone are NOT sufficient client identity; do not assume dedicated fixed egress IPs or allow 0.0.0.0/0.
2. After independent operator/security approval, apply the reviewed base `reasoning/phase2/sql/postgres.sql` and **separate** `reasoning/phase2/sql/provider_spend_protected.sql` migrations, then the explicitly reviewed `reasoning/phase2/sql/provider_spend_definer_handoff.sql` to give both functions a dedicated non-login, non-admin owner. Verify the two function signatures, strict search paths, owner role and `PUBLIC` revocation before granting runtime access. The owner handoff is not part of ordinary schema initialization. Never execute these migrations as the runtime role or as a workaround for blocked staging networking.
3. Only after approved origin/network, schema and privilege review, provision a dedicated **non-superuser, non-owner** runtime role with **no direct SELECT or DML** on any of the three provider-spend tables. Its only billing authority must be explicitly approved `USAGE`/`EXECUTE` on the two protected `axiom_spend.reserve`/`settle` SQL RPCs from stacked draft #104; broad `read_write` and direct table `SELECT`/`UPDATE` intentionally fail the preflight. Audit PUBLIC grants and owner memberships, use approved secret storage and never use `neondb_owner`.
4. Configure a dedicated staging Hyperdrive origin with PostgreSQL TLS `verify-full` (with the correct CA chain/hostname), **query caching DISABLED** and a conservative origin-connection limit. The Hyperdrive origin's TLS mode cannot be attested by merely inspecting the Worker's connection string.
5. After real credentials/network are approved, replace the placeholder `HYPERDRIVE` ID in `wrangler.jsonc.example` in a **separate operator-controlled deploy config**. Keep `workers_dev:false`; no routes or cron are provisioned by this example. Set `STAGING_DATABASE_PROBE_ENABLED` only for a deliberate, restricted staging scheduled-event check.
6. Independently verify both the TLS origin configuration and access perimeter, then perform actual billing-denial/concurrent-reservation tests on **multiple real PostgreSQL connections and worker replicas**. The Phase 2 `pg.Pool` code and `node:http`/filesystem migration dependencies need separate Cloudflare compatibility and security review; a preflight check cannot establish that.

## Diagnostic contract

- `fetch()` always returns HTTP **404**. No SQL health endpoint, credentials or database results are publicly exposed.
- `scheduled()` does nothing unless `STAGING_DATABASE_PROBE_ENABLED === "true"`.
- With a deliberate staging trigger, one per-invocation `pg.Client` connects via the injected Hyperdrive binding and runs **one static SELECT** for database name, current role, and presence of three billing tables. No SQL is user-controlled.
- Missing binding, incorrect role/database, missing tables or SQL failures fail closed. The query also checks PostgreSQL role administration/superuser/BYPASSRLS flags, `neon_superuser` membership, membership in **any elevated PostgreSQL role**, membership in the **owner role of any central billing table**, and **table/column `SELECT` and DML privileges over all three protected billing tables**, and database/schema `CREATE` privileges. A runtime role that can assume billing-table ownership is unsafe even if its own role flags appear harmless. A matching role **name alone is never sufficient**. Missing privilege-audit fields fail closed. Logs contain only `AXIOM_STAGING_SCHEMA_BLOCKED` or `AXIOM_STAGING_SCHEMA_PRESENT_NOT_PRODUCTION_READY` — never raw errors, SQL results, passwords, or connection strings.
- A protected SQL-RPC check now also requires both exact `axiom_spend.reserve` / `settle` signatures; `SECURITY DEFINER` with a non-login, non-admin, non-runtime-member owner and fixed `pg_catalog,pg_temp` search path; no `PUBLIC` function execution; verified runtime `EXECUTE` on both functions, `USAGE` but not `CREATE` on the protected schema. Any missing or unsafe evidence raises `STAGING_PROTECTED_RPC_INVALID` (emitted only as a generic scheduled failure). **These are read-only SQL catalog checks, not deployment-approval receipts.**
- Even if schema-present, `productionBillingEnforced` is **false**. Provider adapter registration, tenant/vendor budget policies, invoice reconciliation and deployment attestation are **separate gates**.

Offline tests (25 cases using fake DB clients; no real Neon connection):

```bash
cd reasoning/phase2
node --test tests/hyperdrive_staging.test.mjs
```

Source: [Neon and Hyperdrive](https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/), [network ranges](https://developers.cloudflare.com/hyperdrive/configuration/firewall-and-networking-configuration/), [TLS modes](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/), [query cache](https://developers.cloudflare.com/hyperdrive/get-started/), [per-event client lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/).


**Protected SQL dependency (draft, unmerged):** The SQL-RPC migration is explicit and separate from generic schema initialization. No operator may provision a runtime user with direct accounting table grants as a workaround. Independent function-owner, ACL, Hyperdrive TLS/cache, origin and release evidence must precede any real staging query. Offline success—including simulated protected-SQL function catalog responses—does not establish production spending enforcement, exact privileges or Hyperdrive origin TLS; independent PostgreSQL 17 integration is separately exercised on #104.

## PostgreSQL 17 catalog integration (disposable CI only)

The offline fixture tests cannot catch PostgreSQL catalog SQL syntax or effective role-grant errors. CI therefore runs a **separate** PostgreSQL 17-alpine service and a new `postgres-catalog-gate` job, in addition to the 25-case fake-client `offline-gate`.

Run `node --test tests/hyperdrive_staging.postgres.test.mjs` from `reasoning/phase2` with independently provisioned ephemeral PostgreSQL 17 credentials in the test environment. Never supply production credentials.

The test creates an isolated throwaway database with fake provider-spend tables, two inert SQL function signatures, a separate NOLOGIN definer and a restricted runtime login. It executes the **real** static readiness SQL through a real `pg.Client`. It tests a clean PASS and then each negative permission independently, restoring PASS after each revocation:

- Direct accounting-table `SELECT`.
- Protected function `EXECUTE` granted to `PUBLIC`.
- One of the required runtime function execution grants missing.
- Runtime `CREATE` on the protected schema.
- A protected function owned by an administrator LOGIN role.
- **Unrelated third-party role** granted `EXECUTE` to the protected function, even when the runtime's own effective grants are otherwise unchanged.

The protected function ACL permits execution only to its independently reviewed owner and the named current runtime login. This is a **read-only privilege audit**, not tenant authorization inside the functions or a deployed Worker inventory.

The test functions are intentionally inert and separate from the protected budget migration in stacked draft #104. Passing this check does **not** prove that the live SQL bodies are deployed, transaction-safe, tenant-authenticated or invoice-reconciled. No Cloudflare/Neon network is contacted. **Release NO-GO.**

## 2026-11-12 G1 strict origin TLS evidence (draft #239)

The operator may set G1_REQUIRE_ORIGIN_TLS=true only for a closed, approved
scheduled staging diagnostic. The fixed catalog SELECT now reads pg_stat_ssl
for the current PostgreSQL backend PID, checking origin_tls_active and
origin_tls_version. Strict mode refuses missing/false TLS and versions below
TLS 1.2 with STAGING_ORIGIN_TLS_UNVERIFIED. Public fetch() remains HTTP 404;
the scheduled result logs generic success/failure only, and always reports
productionBillingEnforced=false.

CA and DNS/SAN hostname verify-full at the private Cloudflare VPC origin are
NOT demonstrated by pg_stat_ssl.ssl=true; independent real Cloudflare, AWS
and Neon native control-plane receipts are mandatory. No live SQL, Worker
deployment, public ingress exception, password, database role or provider
spend is authorized by this source-only diagnostic.

See docs/acceptance/2026-11-12-g1-private-neon-cloudflare-operator-acceptance.md
for the G1-only operator network route, owner/time/cost authorization, least
privilege SQL, cross-worker atomicity captures and independent signatures.
**G1 remains NO-GO until genuine signed live evidence exists.**
