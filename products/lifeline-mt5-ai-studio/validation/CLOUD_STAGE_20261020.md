# LIFELINE v0.4 — Native Bridge + Cloud Staging Qualification

Date: 2026-10-20. **Isolated development; no public deployment, live trading or paid compute.**

## Independently verified

- Native MetaEditor/MQL5 Windows signing and compilation: GitHub Actions run 39472075489.
- Signed outbound Windows agent, tenant-scoped queue, HMAC-replay denial, signed receipts: source import run 39487699351, matrix security run 39487846099 (**Windows, Linux and Cloudflare JS tests all passed**).
- Modal existing credential read-only verification **PASS**, without creating a new Modal service: run 39487938616, job `modal-identity-readonly`.
- Neon organization is on Free plan. Created an entirely separate LIFELINE project `frosty-rain-34922526`, branch `br-fancy-recipe-b5pm4jcf`, database `lifeline_mt5_stage`.
- Applied tables `lifeline.agent_jobs`, `lifeline.agent_nonces`, `lifeline.research_receipts` with ENABLE and FORCE row-level security and per-tenant policies. `lifeline_executor` is an intentionally **NOLOGIN, NOBYPASSRLS, unprivileged** role with RLS-limited grants.
- Real Neon RLS acceptance as `lifeline_executor`: with session tenant `test_tenant_A`, one of two synthetic test rows was visible, tenant B was invisible (zero rows), and an attempted cross-tenant INSERT was rejected by row-level security.
- The Neon project is not attached to any application or exposed publicly via a custom service.

## Fail-closed issues

**Cloudflare:** exact account ID `93f395f5121954671f92fffa453d6b61` read-only API call returned HTTP 403 in run 39487938616. No production Worker/Access/DNS changes were made. Do NOT reuse another Cloudflare account; qualify exact access before deployment.

**Neon privileged role:** the Neon API's automatically created `lifeline_runtime` role unexpectedly had `BYPASSRLS`, `CREATEROLE` and membership in `neon_superuser`. A revoke/alter attempt was blocked by Neon permissions. This role is **UNSAFE for a customer runtime and MUST NOT BE USED**. Its initial generated password was rotated, not configured in any application. The separate SQL-created `lifeline_executor` is RLS-safe but has NOLOGIN; provisioning a secure restricted LOGIN identity is required before Modal gets a DATABASE_URL.

**Persistent Windows:** the GitHub-hosted Windows machine remains temporary. No broker credentials, prices, orders, public dashboard or permanent agent have been connected.

## Remaining critical sequence

1. Obtain Cloudflare read-only identity confirmation for the exact account, configure private Access with correct issuer/audience and automated negative-auth tests.
2. Obtain a truly non-BYPASSRLS LOGIN role for the dedicated Neon project without granting it neon_superuser membership, install least-privilege credentials in Modal Secrets, test live Neon transaction RLS through the runtime identity.
3. Deploy isolated **private** Modal ASGI behind proxy authentication after checking budget and resource caps. Deploy Cloudflare Access JWT Worker only after valid access and security gates. Configure private Vercel preview.
4. Pair an owner-approved Windows host to the outbound HTTPS agent; allow probe-only traffic until source validation, signed binaries, trusted isolation and broker-demo approval. Historic market testing is still unverified.
5. Keep PR #30 **draft and unmerged**; never change protected main or PR #1. No public ChatGPT listing or live broker operations.

## Integrity

Repository branch `product/lifeline-mt5-fivecloud-isolated-20261020`. Verifiable source archive also saved privately to Google Drive folder `LIFELINE_MT5_AI_STUDIO`, file ID `1Q6Fwb6YadQeUp79a_TqStnJ4uX1yk-ou`. SHA256: `757b21f67a3102a5a5bd22be29201f3c8ca98509d93c1686b17e0f36d225ec5a`. Secrets never included.
