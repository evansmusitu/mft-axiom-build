# MUSITU WhatsApp Phase 1 v1.3.0 — Tenant Runtime Safety Gate

Date: 2026-10-13. Scope: isolated private development candidate. Existing AXIOM and MAIL FABRIC production systems unchanged.

## Why this change matters

The live isolated Neon PostgreSQL 17.11 database's **sole owner role has `BYPASSRLS`**, and synthetic two-tenant owner queries previously saw both tenants despite `FORCE ROW LEVEL SECURITY`. Metadata-only checks could therefore be falsely reassuring. The earlier Neon booking exclusion/idempotency proof is genuine but does not establish tenant isolation.

## New reviewed software contracts

1. `qualifyPostgresTenantReadIsolation({pool,expectedRole,tenantProbes:[tenantA,tenantB]})` opens three read-only transactions on a single leased, non-bypass client. It explicitly clears the transaction-local tenant setting and checks all tenant rows (no caller-supplied WHERE filter). Expected visibility: unset=0, A=one A, B=one B. It rolls back every scope, rejects leakage/absence and discards clients on failed rollback. Use only in a **pre-seeded, clean two-tenant sandbox**, not on real customer data.
2. `qualifyPostgresRuntimePrivileges({pool})` inspects **effective grants** instead of grants listed for the role alone. It rejects schema/database CREATE, missing required SELECT, unexpected table or column INSERT/UPDATE/REFERENCES, and all DELETE/TRUNCATE/TRIGGER. The only allowable inserts are bookings, draft approvals and offline outbound preparations. It never invokes a customer-facing side effect.
3. `createQualifiedPostgresRepository(...)` now requires metadata qualification, effective grant qualification, and two-fixture behavioral qualification. It cannot be instantiated from RLS metadata alone.
4. The already-isolated PostgreSQL 17 qualification script invokes all three guards after seeding two synthetic tenants.

## Evidence provenance

- Read-only probe: focused TDD missing-behavior test reproduced, 5 focused tests green.
- Effective grants: focused TDD missing-behavior test reproduced, 2 focused tests green; a separate column-level overgrant red/green test caught a security gap.
- Independent package verification: see `VERIFY_V13.log` and source manifest; counts are determined from fresh executable results.

## Blockers, not masked by tests

- Provision a genuine non-owner, `NOBYPASSRLS` role on an approved private PostgreSQL service. The attached Neon app exposed only a privileged role; role creation attempts were blocked by the authorization layer. **Do not modify the owner role to weaken security, do not bypass those controls.**
- Run all seven migrations under migration ownership on an isolated PostgreSQL service and execute the full PostgreSQL 17 CI qualification script under segregated runtime and ingress identities.
- Then independently qualify live Keycloak, authorized Meta test WhatsApp, AI model, AXIOM service identity, real browser deployment and disaster recovery.
- Provider WhatsApp sends, payments, customer email, production deployments and public signup remain disabled. **Phase 1 and production are NOT complete.**
