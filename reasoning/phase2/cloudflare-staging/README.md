# AXIOM — Cloudflare Hyperdrive staging database preflight

**Status: PRE-DEPLOYMENT ONLY, NOT A PRODUCTION CONNECTION OR BILLING GATE.**

This independent, fail-closed read-only diagnostic tests an eventual staging-only **Cloudflare Workers → Hyperdrive → Neon PostgreSQL 17** connection. It does NOT make the Phase 2 Node.js API Workers-compatible, provision billing caps, certify a private network, install schema, or permit paid provider calls. Keep release issue [#74](https://github.com/evansmusitu/mft-axiom-build/issues/74) **NO-GO**.

## Current blocker

The existing dedicated Neon staging database has `block_public_connections=true`. The owner confirmed they use **Cloudflare Workers only**, without a Tunnel, VPC, or private server. Standard Hyperdrive requires a reachable database and uses Cloudflare's **shared outbound public IP ranges**. Hyperdrive's credentials validation will fail until Neon becomes reachable. **This PR does not open Neon or deploy a Worker.**

Before changing connectivity:

1. Obtain a security-reviewed, time-bounded **staging-only network exception** with monitoring and rollback, or install separately authorized private networking. Shared Cloudflare source ranges alone are NOT sufficient client identity; do not assume dedicated fixed egress IPs or allow 0.0.0.0/0.
2. Prepare an approved migration-owner path and apply the pinned `reasoning/phase2/sql/postgres.sql` to the dedicated staging DB. Confirm the three `axiom_provider_spend_*` tables. Never run migrations using the runtime role.
3. Provision a dedicated **non-superuser, least-privilege** PostgreSQL `read_write` runtime role scoped to the staging database/schema; audit PUBLIC grants and manage the password only through approved secrets. Do not use `neondb_owner`.
4. Configure a dedicated staging Hyperdrive origin with PostgreSQL TLS `verify-full` (with the correct CA chain/hostname), **query caching DISABLED** and a conservative origin-connection limit. The Hyperdrive origin's TLS mode cannot be attested by merely inspecting the Worker's connection string.
5. After real credentials/network are approved, replace the placeholder `HYPERDRIVE` ID in `wrangler.jsonc.example` in a **separate operator-controlled deploy config**. Keep `workers_dev:false`; no routes or cron are provisioned by this example. Set `STAGING_DATABASE_PROBE_ENABLED` only for a deliberate, restricted staging scheduled-event check.
6. Independently verify both the TLS origin configuration and access perimeter, then perform actual billing-denial/concurrent-reservation tests on **multiple real PostgreSQL connections and worker replicas**. The Phase 2 `pg.Pool` code and `node:http`/filesystem migration dependencies need separate Cloudflare compatibility and security review; a preflight check cannot establish that.

## Diagnostic contract

- `fetch()` always returns HTTP **404**. No SQL health endpoint, credentials or database results are publicly exposed.
- `scheduled()` does nothing unless `STAGING_DATABASE_PROBE_ENABLED === "true"`.
- With a deliberate staging trigger, one per-invocation `pg.Client` connects via the injected Hyperdrive binding and runs **one static SELECT** for database name, current role, and presence of three billing tables. No SQL is user-controlled.
- Missing binding, incorrect role/database, missing tables or SQL failures fail closed. Logs contain only `AXIOM_STAGING_SCHEMA_BLOCKED` or `AXIOM_STAGING_SCHEMA_PRESENT_NOT_PRODUCTION_READY` — never raw errors, SQL results, passwords, or connection strings.
- Even if schema-present, `productionBillingEnforced` is **false**. Provider adapter registration, tenant/vendor budget policies, invoice reconciliation and deployment attestation are **separate gates**.

Offline tests (using fake DB clients; no real Neon connection):

```bash
cd reasoning/phase2
node --test tests/hyperdrive_staging.test.mjs
```

Source: [Neon and Hyperdrive](https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/), [network ranges](https://developers.cloudflare.com/hyperdrive/configuration/firewall-and-networking-configuration/), [TLS modes](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/), [query cache](https://developers.cloudflare.com/hyperdrive/get-started/), [per-event client lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/).
