# MUSITU WhatsApp Phase 1 — v1.1.0 continuation evidence

Date: 2026-10-13 | Scope: isolated private development, NO production authority.
Base: `MUSITU_WHATSAPP_PHASE1_GOVERNED_CONSOLE_V10_2026-10-13.zip` (v1.0.0, 106 passing local tests).

## Implemented in this increment

1. `src/adapters/meta-webhook-bridge.mjs` — loopback-only Meta-compatible GET challenge, raw signature-checked POST with strict 256 KiB bound, no success ACK on uncertain persistence, injected transactional ingestor. No public listener, no outbound API.
2. `src/adapters/meta-send-protocol.mjs` — pure, offline Graph text-message serializer and HTTP receipt classifier. `ACCEPTED` is NOT `DELIVERED`; uncertain outcomes never trigger automatic retries. No fetch/credentials/send method.
3. `src/postgres/runtime-role-guard.mjs` — mandatory proposed runtime preflight that rejects superuser, BYPASSRLS, unexpected role and non-FORCE-RLS tables. `createQualifiedPostgresRepository` is the safe factory for future production wiring; direct repository constructor remains development-only.
4. `scripts/private-meta-webhook-demo.mjs` — private signed GET/POST protocol smoke, no provider network.

## Real PostgreSQL qualification evidence (connector)

Neon organization: Free plan. A **new isolated** PostgreSQL 17 project was provisioned for WhatsApp qualification. It is unrelated to AXIOM, MMF and FMI projects.

- PostgreSQL server: **17.11**; `btree_gist` and `pgcrypto` available.
- Only the **isolated qualification schema** (`musitu_phase1_qualification`) and two synthetic tenant/booking pairs were created. No `musitu` application migrations were applied and no customer data was used.
- Tables in this qualification schema were configured `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- **Observed security failure:** owner role `musitu_whatsapp_phase1_owner` had `rolbypassrls=true`. SELECT without a tenant context showed two records, and a context scoped to tenant A also showed both tenants. Thus this privileged login bypasses all RLS even when `FORCE ROW LEVEL SECURITY` is set.
- The provider's role creation interfaces were not authorized by the connected execution environment. **Do not bypass these restrictions.** No non-bypass application role was independently qualified.
- No app schema, role grants, concurrent transaction tests, backup/restore, or native PostgresTenantRepository integration was certified.

**RELEASE IMPACT: BLOCKED.** Use a dedicated non-owner/non-BYPASSRLS runtime principal with explicit minimal grants; run the native qualification from a clean, isolated PostgreSQL 17 container/CI job, and verify tenant A cannot read tenant B. Privileged Neon owner credentials must NEVER be used for the SaaS runtime.

## TDD evidence

New tests were first executed with a `NOT_IMPLEMENTED` behavior and failed, then the same tests passed against the implementations. Logs: `TDD_META_BRIDGE_RED.log`, `TDD_META_SEND_RED.log`, `TDD_PG_GUARD_RED.log` and `FINAL_VERIFY.log`.

## Remaining release gates

Native PostgreSQL with least-privilege runtime RLS and concurrency; real OIDC/Keycloak issuer; approved Meta development-app webhook over public TLS; provider-approved consented outbound flow; qualified model gateway; qualified AXIOM app service identity; Next.js production dashboard; human inbox; monitoring/recovery; privacy/security and business approvals.

No real Meta messages, payments, Mail Fabric sends, production branch writes or other MUSITU product changes were made.
