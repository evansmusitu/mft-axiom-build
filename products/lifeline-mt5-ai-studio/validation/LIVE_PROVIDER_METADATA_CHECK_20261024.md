# LIFELINE MT5 AI Studio — Live infrastructure read-only acceptance (2026-10-24)

Scope: **metadata and SELECT-only checks** through connected provider APIs, on the
existing LIFELINE assets only. This is NOT a live Cloudflare→Modal→Neon integration
test, not approval to cut over, and not evidence that a Windows MT5 host exists.
No schema writes, credential extraction, new provider resources or charges authorized.

## Cloudflare and Modal (fresh actual GitHub Actions provider read-back)

- [Fresh Cloudflare/MODAL metadata rerun 40076927002](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40076927002),
  latest job `120829829005` **SUCCESS**.
  Exact Cloudflare account, owner-only Access app and independent MFA policy
  verified read-only; Worker contains **6** binding names, **4** of 7 private
  bindings still missing (`AGENT_HMAC_KEY`, `EDGE_SHARED_SECRET`,
  `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET`).
  The two named private Modal stores and the endpoint metadata exist. No
  token values were recovered; no function run or Worker binding mutated.
- [Fresh workspace proxy isolation audit 40079161052](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40079161052):
  current Modal workspace contains **one environment**, with **13 other live
  apps** alongside LIFELINE and **44 existing proxy token metadata records**.
  $0 billed at the moment of the audit; usage under the bounded preflight.
  These counts do NOT imply existing tokens are exposed or compromised.
  Token isolation cannot be certified on free Starter; **do not generate or
  attach a new shared workspace proxy token to the LIFELINE Worker**.

## Vercel: exact isolated private project

Connected Vercel read-only `get_project` for
`prj_qkviXEqdi9n0qxpbRdhVuylvPRq9` returned:
- Project `lifeline-mt5-ai-studio-stage`
- Latest preview deployment `dpl_BXsFRYvLwgdh5ja4hkcfZkhYce2A`: `READY`
- `ssoProtection.enabled=true`, `deploymentType=all`
- `live=false`: not a public production launch.

Deployment `READY` alone does not prove the UI is authenticated or backed by
an active private Cloudflare/Modal connection.

## Neon: exact isolated database metadata and SQL evidence

Connected Neon read-only project `frosty-rain-34922526`, stage branch
`br-fancy-recipe-b5pm4jcf` is `ready`, DB `lifeline_mt5_stage`.
`get_database_tables` returned **exactly three LIFELINE application tables**:
`lifeline.agent_jobs`, `lifeline.agent_nonces`,
`lifeline.research_receipts`.

Executed SELECT-only PostgreSQL catalog checks (no row data):

```sql
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='lifeline'
  AND c.relname IN ('agent_jobs','agent_nonces','research_receipts')
  AND c.relkind='r'
ORDER BY c.relname;
```

**All three tables returned `rls_enabled=true` and `force_rls=true`.**

```sql
SELECT rolname,rolcanlogin,rolbypassrls,rolsuper,rolcreaterole,rolcreatedb
FROM pg_catalog.pg_roles WHERE rolname='lifeline_stage_app';
```

`lifeline_stage_app` exists and can login; `rolbypassrls=false`,
`rolsuper=false`, `rolcreaterole=false`, `rolcreatedb=false`.

```sql
SELECT tablename,policyname,qual,with_check
FROM pg_catalog.pg_policies
WHERE schemaname='lifeline' ORDER BY tablename;
```

All three tables have one tenant-binding policy each, with both row selection
and writes limited to:

`tenant_subject = current_setting('lifeline.tenant_subject', true)`.

This confirms **current table/RLS catalog configuration**, not that the full
Cloudflare→Modal data flow is currently authenticated or safe from all flaws.
The existing private Modal→Neon restricted-role signed synthetic test was
previously validated, and is not re-executed here.

## Remaining gates

1. Modal provider-supported **per-app proxy credential isolation** on free plan,
   or a legitimate separately isolated LIFELINE-only workspace, with a real
   hard $0 spending cap. Support email sent; response pending.
2. Four remaining private Cloudflare bindings provisioned from authorized
   sources without logging secrets, and independent owner-JWT protected
   Cloudflare→Modal→Neon positive AND negative live acceptance.
3. Genuine permanently hosted native Windows MT5/MetaEditor local-MCP agent
   (GitHub Windows CI runners are not permanent hosts).
4. Independent technical, privacy, financial and public launch reviews.
No public launch, paid operations or trading was authorized or performed.
