# Phase 2.10C — protected PostgreSQL spending authority (operator hold)

**DRAFT / NOT APPLIED TO NEON / NO-GO.** Written 2026-11-08. This is a reviewed implementation candidate and a checklist for future independent authorization, **not** an instruction to bypass staging's network block. Production source main remains separate from stacked draft #104.

## Implemented source candidate

- Phase 2.10B tenant and vendor cap tables live in `reasoning/phase2/sql/postgres.sql`.
- **Separate explicit** `reasoning/phase2/sql/provider_spend_protected.sql` defines `axiom_spend.reserve(text,text,text,text,text,bigint,text)` and `axiom_spend.settle(text,text,text,text,text,bigint,text,text)`. They enforce the organization-before-tenant lock order, immutable attribution, request identity and duplicate suppression, budget caps, held reservations, integer bounds, settlement/overage accounting and suspension, within PostgreSQL transactions. Both `SECURITY DEFINER` functions use `SET search_path = pg_catalog, pg_temp`, fully qualified `public` tables, an atomic create/revoke transaction, and **no EXECUTE for PUBLIC**.
- **Explicit owner handoff** in `reasoning/phase2/sql/provider_spend_definer_handoff.sql` creates a fixed `axiom_spend_definer` `NOLOGIN` role, grants only the approved accounting table `SELECT`/`INSERT`/`UPDATE` and schema `USAGE`, transfers the two function owner identities, and revokes temporary protected-schema `CREATE` plus `PUBLIC` execution. This script fails closed when the owner role already exists and must be independently approved before any staging use; it is NOT installed by ordinary schema initialization.
- `ProtectedPostgresProviderSpendLedger` exposes only reserve and settle through these fixed SQL functions, with bounded transaction/lock deadlines, unforgeable accounting instance identity and denial-before-provider-call. The separate operator-admin `PostgresProviderSpendLedger` continues to exist for isolated CI provisioning and legacy tests and **must not** be installed as a production runtime role with table DML.
- PostgreSQL 17 CI creates a temporary **separate database** and non-owner login, grants only procedure execution, checks denied direct DML and role escalation, tests reserve/settle, actual accounting state, synthetic paid-decorator invocation, and denial before a synthetic provider call. This is not a live Worker/Hyperdrive deploy, vendor-billing reconciliation or penetration review.

## Authority separation required before any credential use

| Role | Privileges and boundary | Gate |
|---|---|---|
| Protected migration/operator | Applies schema + vetted migration in a **separately approved** maintenance session, provisions immutable tenant and vendor caps and handles reconciliation; cannot be a paid-serving Worker role | External operator/security authorization required |
| Dedicated **NOLOGIN** function owner | May execute only approved billing-row `SELECT`, `INSERT` and `UPDATE` needed inside the two functions. Must not be superuser, role creator, database creator, RLS bypass, runtime login or public-facing service | Independently review role membership, grants and function ownership |
| Protected runtime login | Exact `USAGE` on `axiom_spend` schema plus `EXECUTE` on the two approved function signatures; no table/column DML, owner membership, schema/database `CREATE` or privileged role membership | Must pass closed read-only #99 preflight **and** exact deployment role attestation |
| External security and finance assessors | Verify TLS hostname/CA, Hyperdrive cache disabled, worker egress inventory, revocation/rotation, concurrency and invoices | Independent signed evidence; not sourced from a test log |

**Proposed operator checklist; do not execute against Neon until independently approved:**

1. Keep `block_public_connections=true` while deciding a time-bounded and risk-approved staging origin/network exception with rollback. Workers-only Cloudflare + shared egress CIDRs are **not** private tenant identity; no credentials may be placed in GitHub comments/CI/plaintext docs.
2. Verify project/branch/database and source SHA. Resolve the runtime login and separate NOLOGIN function-owner identity, check role attributes, `pg_has_role` inheritance, schema ownership, baseline `PUBLIC` grants and default privileges. Do not use `neondb_owner`, `neon_superuser`, `postgres`, or a function-owning login as the runtime.
3. Apply and inspect base billing schema and the **separate** `provider_spend_protected.sql` migration. Then, only with separate operator approval, review and explicitly apply `provider_spend_definer_handoff.sql` using an approved privileged operator session: it creates a dedicated `NOLOGIN` definer named `axiom_spend_definer`, transfers the two functions and limits its billing-table authority to `SELECT`/`INSERT`/`UPDATE` without permanent schema `CREATE`. Fail closed rather than silently reusing an existing role. Deny `CREATE` on any schema in the function's search path. Validate `pg_proc.prosecdef=true`, the exact `proconfig` search path and no `PUBLIC` function execution.
4. Grant only `USAGE` on the protected schema and `EXECUTE` for the two exact signatures to the reviewed runtime role, after verifying and independently recording the owner and DML-grant diff. No automatic `GRANT EXECUTE ON ALL FUNCTIONS`, blanket `GRANT ALL`, owner grants or unrestricted `DEFAULT PRIVILEGES` to the runtime.
5. Verify that runtime cannot `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER`, `REFERENCES`, `MAINTAIN` or acquire **column** DML on any of the three provider-spend tables, cannot assume definer/operator privileges, and cannot directly `SELECT` sensitive billing rows. Test unknown request, mismatched tenant/vendor, duplicate identity, suspended organization, unpriced model, insufficient cap, ambiguous request and SQL failover as **deny-before-vendor**.
6. Only after independently approved origin/TLS/cache/credential and deployment receipts, stage exactly one non-production Worker with no actual paid-provider credentials to verify bind, privilege and negative behavior. Subsequent live vendor/bill tests require their **own** separate cost authorization. Do not claim production readiness.

### Privilege readback template (read-only, no credentials)

```sql
SELECT current_database(), current_user, session_user;
SELECT p.oid::regprocedure::text AS signature,
       p.prosecdef AS security_definer, p.proowner::regrole::text AS owner,
       p.proconfig AS function_configuration,
       p.proacl AS function_acl
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
WHERE n.nspname='axiom_spend' AND p.proname IN ('reserve','settle');
SELECT current_user AS runtime,
  pg_catalog.has_table_privilege(current_user,'public.axiom_provider_spend_budgets',
      'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') AS budget_table_dml,
  pg_catalog.has_any_column_privilege(current_user,'public.axiom_provider_spend_budgets',
      'INSERT,UPDATE,REFERENCES') AS budget_column_dml;
-- Perform corresponding readbacks for organization and request tables.
```

Function `SECURITY DEFINER` authority is dangerous if ownership or search paths are untrusted. Review every grant as an *independent* access-control change; these checks are not a substitute for a privilege/SQL penetration assessment. An application tenant claim is **not** established by a PostgreSQL connection alone; the trusted ingress must independently authenticate/authorize tenant identity and pin account/vendor mapping before these functions may be called.

## Required independent verification and fail-safe rollback

- Pin migration checksum, table-schema hash, reviewed function bodies/owner/ACLs, runtime role and privilege-diff receipts. Ensure `PUBLIC` cannot execute the functions even if some database user can see their names; test role cannot become definer via membership, default grants, object ownership, `SET ROLE`, or indirect function calls.
- Run PostgreSQL 17 duplicate and **cross-pool concurrency** tests; prove row locks and budget ledger survive disconnect, timeout, restart, vendor overages and ambiguous settlement without retrying a potentially charged upstream call.
- Verify every live paid-provider worker/queue/service-binding route through the protected ledger. The pure TypeScript decorator remaining acceptable with a SQLite or legacy admin PostgreSQL ledger in offline tests does **not** authorize production fallback.
- No live schema alteration, role grant, network exception, production deployment, vendor spending or external acceptance has occurred in this PR. To revert an approved staging pilot, first disable paid/Worker egress, preserve immutable accounting rows and receipts, revoke runtime function access, and follow an operator-approved database and network rollback plan; never erase charges to fake a PASS.

**Production release remains NO-GO under issues #74 and #75.** Nothing in this document guarantees trading returns or model correctness.


## November 8 isolated verification checkpoint

In GitHub Actions run `42456063178` at draft #104 head `1a93cfe9f2d2d879405a4a727d5c21499f0b7c7d`, PostgreSQL 17 **20/20**, Phase 2 **268/268**, and Phase 1 **20/20** passed. The RED checkpoint `acbbf682cf3c29d8087d07a5a649925b7f8da7a9` failed precisely on administrator-owned protected functions (19/20 PostgreSQL). GREEN code used only an isolated disposable CI database and a temporary, non-login, non-admin function owner. This does **not** verify production deployment privileges, a live protected owner, or the operator's authority to install roles in Neon.
