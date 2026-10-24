# LIFELINE MT5 AI Studio — v0.7 Private Signed Probe End-to-End Acceptance

Date: 2026-10-21. Scope: isolated stage, no public trading or external customers. GitHub PR #30 draft/unmerged; protected main and other products untouched.

## NEW independently passed evidence (LIVE)

**Private Modal → Neon signed job and signed receipt end-to-end: PASS.**
GitHub Actions run https://github.com/evansmusitu/mft-axiom-build/actions/runs/39549416299 (all steps success). Deployed isolated private app `lifeline-mt5-analytics-isolated`:
- Exact existing Modal workspace token and free-credit budget were checked. Modal **billed_cost = 0** at the deployment gate (usage quota may change).
- Created a fresh LIFELINE-only bridge Secret `lifeline-mt5-bridge-probe-20261021` containing test-agent ID, dedicated test tenant, HMAC signing key, and edge-to-kernel secret. None printed or committed.
- Deployed scale-to-zero Modal FastAPI with `requires_proxy_auth=True`; the Neon DSN is obtained by decrypting only the committed RSA-OAEP envelope inside Modal using a separate Modal-only private key.
- Direct **anonymous** HTTP denied; short-lived authorized Modal proxy token authenticated.
- `/operator/probe` persisted a PROBE-ONLY signed job in isolated Neon; `/agent/pull` returned the correctly signed tenant-scoped task; replay of the same HMAC request was rejected; `/agent/receipt` committed an independently signed result and `/operator/status` reported COMPLETED.
- Verified forbidden `order_send` was denied HTTP 403; all tests used synthetic research data and a temporary **non-native** CI agent, NOT a durable Windows terminal. The ephemeral Modal proxy token was revoked immediately.
- Existing `lifeline_stage_app` has NOBYPASSRLS and TLS verify-full + `certifi` CA roots; on every database transaction `pg_queue.py` now asserts the actual low-privilege role plus active RLS on all three tables.
- Authenticated private `/research/neon-readiness` within the already-deployed standalone Modal research app independently passed against the restricted Neon login in run https://github.com/evansmusitu/mft-axiom-build/actions/runs/39548807288 . Anonymous access still rejected.
- Signed *claimed* job recovery fixed to renew timestamps while keeping the exact original nonce and durable at-most-once receipt. This was tested Windows + Linux in run https://github.com/evansmusitu/mft-axiom-build/actions/runs/39548589034.

## Private interface status

- Vercel protected project `prj_qkviXEqdi9n0qxpbRdhVuylvPRq9`.
- Updated isolated status page deployment `dpl_3cQimHkLi3ts9ayLRCtPCZKeSggS` is READY, URL `https://lifeline-mt5-ai-studio-stage-69nmvn0c1-evansmusitu.vercel.app`.
- Project API confirmed `ssoProtection.enabled=true` and `deploymentType=all`. The new deployment had `target=null` and no alias, so this latest version is a protected preview rather than a promoted public stage alias. Earlier guest-denial acceptance was on original protected deployment run 39541336913. **A fresh guest negative-auth probe of this exact preview was not run.**

## Separate verified components retained

- Official MetaEditor Windows signing and genuine EX5 compile: run 39472075489, mathematical optimization only (not a historical market backtest).
- Native localhost MetaQuotes MCP adapter: mocked cross-platform deny-tests, run 39495426549. Actual localhost Terminal/MetaEditor MCP not yet paired on persistent Windows.
- Exact Cloudflare account `93f395f5121954671f92fffa453d6b61` isolated Worker `lifeline-mt5-edge-isolated` remains unrouted. Access app `71c315f0-3cfa-4217-98f1-e31d9ec8a44b` has **deny-everyone** policy, independently verified run 39541665632.
- Separate Neon project `frosty-rain-34922526`, DB `lifeline_mt5_stage`, role `lifeline_stage_app` with FORCE RLS and actual restricted-login verification.

## Explicitly NOT yet completed

1. Cloudflare Access has **no owner MFA allow policy** and **no DNS or Worker custom route**. We must not expose the private Modal app or Worker before identity enrollment, JWT audience/issuer and negative-auth verification.
2. **No 24/7 Windows host** (GitHub Actions hosts disappear after the job). The completed live signed E2E used a temporary Python agent in a Linux CI process for a PROBE, not MetaEditor or MT5.
3. No verified MT5 native MCP request to a running terminal, no broker-demo price-history performance backtest, no verified trade execution.
4. The protected Vercel interface is still a nontrading **status page** with no browser-to-backend API; the private Modal service is not customer-facing.
5. No public ChatGPT plugin listing, real orders, payments, revenue, or enterprise customer readiness.

## Remaining authorizations that cannot be bypassed

The owner must supply or approve a persistent Windows host (or explicitly approve third-party hosting costs), plus Cloudflare Access owner identity/MFA enrollment. The original zero-dollar limit precludes silently renting a Windows machine or paid instance. Trading and unrestricted remote shell remain deliberately unavailable.

**Evidence-qualified statement:** GitHub native CI + private Vercel UI + Cloudflare isolated deny-all Access + Modal private signed probe + dedicated Neon RLS are present. The **private Modal ↔ Neon signed job/receipt loop is live and tested**; the **full five-cloud Access-to-Windows customer loop is NOT complete**.
