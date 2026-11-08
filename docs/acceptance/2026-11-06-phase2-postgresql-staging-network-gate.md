# Phase 2 PostgreSQL staging — private connectivity and billing gate (2026-11-06)

**Status: STAGING PROJECT CREATED; APPLICATION CONNECTIVITY BLOCKED; NOT A PRODUCTION ACCEPTANCE.**
This is a public-safe change record. It contains no Neon project ID, database credential, connection URI, private endpoint, tenant/customer data or privileged account details. It tracks G1 and G2 in the [external acceptance contract](2026-11-06-phase2-external-evidence-contract.md) and [release issue #74](https://github.com/evansmusitu/mft-axiom-build/issues/74).

## Independently verified platform inventory (read-only connector/API)

| Control | Observed | Consequence |
|---|---|---|
| Staging platform | New isolated Neon PostgreSQL **17** project in an approved US East staging region | Not connected to customer production |
| Staging DB | Dedicated `axiom_phase2_stage` database; branch `main` exists | Only database creation verified, not schema installation |
| Connection perimeter | `block_public_connections=true` | SQL and scoped role provisioning fail with `blocked network`; protection **remains enabled** |
| Private networking | `block_vpc_connections=false` setting | **Not** proof of any VPC endpoint, routing, identity, TLS or private runner |
| Compute and quotas | 0.25 CU maximum; idle suspension after 60 s; conservative consumption quotas | Usage can still incur charges; quotas do not prove financial cost ceilings |
| Runtime database role | Not yet provisioned; a request to create scoped `read_write` role was denied, with **no changes** | No database application credential exists from this operation |
| SQL schema/ledger | **NOT INSTALLED / NOT VERIFIED** | No central spend enforcement can be claimed |
| Application stack | GitHub main remains separate from stacked draft Phase 2.10A [PR #76](https://github.com/evansmusitu/mft-axiom-build/pull/76) and Phase 2.10B [PR #81](https://github.com/evansmusitu/mft-axiom-build/pull/81) | Public Cloudflare/D1 deploy workflows are not proof that Phase 2 uses this PostgreSQL instance |

The project is intentionally empty of AXIOM tenant and provider-credential data. Its operational identity belongs in a restricted evidence vault, not this public document.

## Workers-only hosting discovery — 2026-11-06

The operator confirmed the existing Cloudflare estate is **Workers only**, with **no Cloudflare Tunnel or private server/VPC**. Consequently **there is no demonstrated private network path from Cloudflare to the Neon instance**. Do not mistake Cloudflare Workers, Workers VPC availability or Hyperdrive's connection pooling for a private tunnel.

Current official Cloudflare documentation:
- [Cloudflare Workers Neon database integration](https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/): standard Hyperdrive or Neon serverless driver can connect when Neon is publicly reachable and credentials allow it.
- [Hyperdrive getting started](https://developers.cloudflare.com/hyperdrive/get-started/): standard Hyperdrive requires a publicly accessible PostgreSQL-compatible database, and Node.js driver compatibility must be configured.
- [Private database over Workers VPC](https://developers.cloudflare.com/workers-vpc/examples/private-database/): private PostgreSQL requires a Cloudflare Tunnel attached to the private network containing the DB.
- [Hyperdrive private VPC integration](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/): VPC Service + Tunnel connection; not automatically provided by a Workers-only estate.

**Decision pending security authorization:** (A) install an independently verified private reachability path with appropriate network owner approval, maintaining public blocking; or (B) stage only an explicitly authorized, narrowly controlled internet-reachable Neon endpoint using Hyperdrive, strict TLS/credential/role controls, and formal exception+rollback. For (B), assess Workers/Hyperdrive egress and Neon IP allowlisting limitations rather than assuming a dedicated fixed Cloudflare egress IP. Neither option is approved simply by this document. Do not silently toggle `block_public_connections`.

**Application runtime dependency:** The current Phase 2 code is a Node.js application with `node:http`, `node:fs`, PostgreSQL transaction pooling and trusted startup procedures. Hyperdrive compatibility with `pg` is **not equivalent to deployment compatibility of the complete Phase 2 service on Workers**. Require source-anchored review of Worker runtime boundaries, transaction pooling semantics, schema migrations executed outside HTTP request workers, and all provider entrypoints before deployment.

**Current state:** No private route, no Internet access exception, no schema install, no scoped runtime role or deployed central ledger. Fail closed.

## Selected staging connection design — Cloudflare Hyperdrive with restricted Neon egress

On 2026-11-07, the operator delegated selection of a secure connection consistent with the confirmed **Cloudflare Workers-only** estate. The chosen **staging-only** design is a **cache-disabled Cloudflare Hyperdrive binding** to the existing dedicated Neon PostgreSQL 17 staging database, using an authenticated **least-privilege role** and TLS certificate verification. This is the practical supported connection in the existing stack, **but not private networking**: the destination must become Internet-reachable before Hyperdrive can connect.

**Security preconditions before any database network change:**

- Provision the restricted database role only in the dedicated staging database, with the smallest necessary SQL grants and a password/secret exclusively in an approved secret manager; review and correct any overly broad PUBLIC grants. Do not use the default owner/superuser as the Hyperdrive application role.
- Permit database origin traffic only from vetted Cloudflare egress CIDRs rather than every public source. Those IP ranges are **shared by Cloudflare services and customers**, not a tenant-dedicated allowlist. They supplement, but cannot replace, PostgreSQL authentication and TLS.
- Use a Hyperdrive origin connection with certificate validation (prefer `verify-full` with correct verified Neon CA/hostname). The dedicated staging binding must set `caching.disabled=true` for all billing, authentication and mutable budget state; Hyperdrive's default SELECT caching must not serve stale spend balances.
- Cap origin pool connections/transaction timeouts; independently test PostgreSQL row locks, transaction semantics and reconnect/restart behavior from Cloudflare Workers. The Phase 2 `pg` driver is potentially compatible with Hyperdrive, but the whole Phase 2 Node HTTP process is **not yet verified as a Worker runtime**.
- No production traffic, customer data, provider billing credentials, or real paid model calls while wiring. Keep an explicit time-bounded staging exception/rollback procedure, with security approver, access-log review and prompt reblocking when not needed.
- Enabling `block_public_connections=false` is a **material security control change** and must only happen after the necessary allowlist/role/TLS/Hyperdrive preparations and an explicit network-access authorization, not merely because this connection method was selected. There is **no such completed approval or network change documented** at this checkpoint.

**Network allowlist prepared, not activated:** The Neon staging project's network allowlist was configured with the **15 IPv4 and 7 IPv6 CIDR ranges** published by Cloudflare at [ips-v4](https://www.cloudflare.com/ips-v4/) and [ips-v6](https://www.cloudflare.com/ips-v6/), and confirmed by a fresh Neon API read to coexist with `block_public_connections=true`. The list applies only to this isolated staging project; the database is **still inaccessible from the public Internet**. Cloudflare CIDRs are shared, not unique to this AXIOM application, and will require periodic reconciliation. A scoped role, properly verified TLS connection, audited security exception, secret routing and successful Hyperdrive connection must exist **before** opening access.

**Current execution status: DESIGN SELECTED / NETWORK NOT OPENED / NO HYPERDRIVE BINDING / NO SCHEMA / NO BUDGET GATE.** Stage stays closed and fail-closed.

Reference: [Neon + Hyperdrive](https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/), [Hyperdrive firewall / shared egress ranges](https://developers.cloudflare.com/hyperdrive/configuration/firewall-and-networking-configuration/), [Hyperdrive TLS modes](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/), [Hyperdrive cache correctness](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/), [Hyperdrive PostgreSQL transaction pool](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/).

## Required private-connection work — **blocked pending approved network authority**

1. Design and independently approve a **private** network path from an authenticated staging application/runner to Neon PostgreSQL. Verify actual VPC endpoint association, private DNS, routes, ingress and egress, TLS certificate validation, database authentication and least-privilege role assignment. `block_vpc_connections=false` alone is insufficient.
2. Keep `block_public_connections=true` unless the security owner explicitly approves a narrow, logged, time-bounded exception and rollback plan. Do **not** open the database to all public IPs as a workaround and do not publish tokens, credentials or URLs in GitHub.
3. Identify the pinned Phase 2 revision containing `reasoning/phase2/sql/postgres.sql`, `initializePostgresSchema(pool)`, `PostgresProviderSpendLedger`, vendor-organization cap and trusted provider-adapter factory. The stacked draft PRs are not part of production `main`. Review and promote code through tests/approvals before any production wiring.
4. From the approved authenticated private deploy runner, create a migration-owner connection, transactionally apply the pinned `reasoning/phase2/sql/postgres.sql` migration using `initializePostgresSchema(pool)`, and compare the resulting schema/table/constraint manifest to the approved source digest. Do not use application runtime credentials for migration administration.
5. After schema creation, create/verify a scoped non-superuser `read_write` billing runtime credential for that one database/schema; store it only in an approved secret manager, with rotation, TLS, least-privilege and role audit. The runtime must not own migrations, public grant administration, or cross-environment databases.
6. Before enabling a paid OpenAI/Anthropic endpoint, wire **every** compile/explain entrypoint and replica to the real PostgreSQL `PostgresProviderSpendLedger` and mandatory trusted budget adapter factory. Explicitly provision the pinned upstream vendor cap and tenant/model limits through an authorized administrative path; deny missing/unknown budgets and unsupported price schedules.
7. Independently test a missing organization cap; missing tenant cap; nonregistered tenant; adapter bypass; concurrent reservations from *two separate* PostgreSQL pools and worker replicas; duplicate request replay; overage suspension; unknown/ambiguous bill retention; rollback, restart and failover. Check that denial occurs **before** any external paid provider call.
8. Verify read-only ledger evidence and end-to-end deployed host/worker inventory, exact git SHA, binary digest, DB endpoint identity (private), network/TLS attestation, role grants, alerts, invoice reconciliation, audit/incident/backup/restore/DR receipts. A synthetic test or successful Neon project creation cannot satisfy this gate.

## Safe read-only verification queries (run only through approved private access)

```sql
SELECT current_database(), current_user, current_setting('server_version');
SELECT to_regclass('public.axiom_provider_spend_budgets') AS tenant_budget_table,
       to_regclass('public.axiom_provider_spend_organizations') AS vendor_budget_table,
       to_regclass('public.axiom_provider_spend_requests') AS request_table;
SELECT COUNT(*) AS tenant_budget_rows FROM public.axiom_provider_spend_budgets;
SELECT COUNT(*) AS vendor_budget_rows FROM public.axiom_provider_spend_organizations;
```

The latter two queries are **only valid after the schema has actually been installed**. An empty table is not evidence of an approved nonzero budget. No staging exercise may use production provider credentials or customer data.

## Acceptance decision

**BLOCKED / NO-GO:** Neon PostgreSQL staging exists but there is no trusted private SQL connection, no installed schema, no scoped runtime role, no authenticated Phase 2 deployment, no real vendor invoice reconciliation, and no external security sign-off. The original public GitHub `main` remains unchanged. No profitable trading signal or profit guarantee follows from these controls.
