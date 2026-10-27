# 27 October 2026 — isolated account Worker inventory and offline research-integrity gates

## Scope / no-spend constraints

Source checkpoint only. No Cloudflare/Modal/Neon/Vercel resources were provisioned, deployed, destroyed or modified by the local tests. No broker order, live MCP host pairing or public SaaS work. Existing D1 read-only evidence from an earlier provider run showed 11 databases; do not assume it is still current. Existing isolated branch remains draft and protected main unchanged.

## New exact-account GET-only capability

`infra/cloudflare/alternative/provider_preflight.py` reads the API path `/accounts/<pinned-account>/workers/scripts` using only GET, in addition to the already pinned account, D1 and subscriptions paths. It emits `workers_script_list_read_status` (authorized snapshot / permission denied / unverified), `workers_script_count_observed` (not a certified exhaustive count), and `stateless_worker_name_observed` (true/false/null). No script names, IDs from other projects, tokens or metadata appear in the output. Even a successful list never upgrades `workers_free_plan_verified`, `hard_zero_dollar_spending_cap_verified`, `workers_script_quota_available_verified` or `provisioning_authorized`. A matching script name is not ownership or deployment-readiness proof.

**RED (pre-implementation):** `python -m unittest -v test_provider_preflight` exit 1: five new Worker-list tests failed; missing observability keys and missing GET path. **GREEN:** 13 tests passed. Re-run the existing GitHub `lifeline-mt5-cloudflare-d1-readonly-preflight.yml` workflow with this source to collect account-specific read-only evidence, and inspect the logs without revealing provider object IDs. Do not infer a Workers plan from account-zone subscriptions.

## Owner-imported research binding

`windows/research_pipeline.py` now computes an unkeyed SHA-256 metadata binding at import time; `walk_forward` and `assess_freshness` reject modified `symbol`, `timeframe`, `claimed_source`, `sha256`, `source_class` and `live_feed_verified` fields. The old bar-only digest let labels/hash be altered without error. **RED:** targeted test failed in six subcases. **GREEN:** research 11/11; full Windows suite 75/75. This prevents accidental relabeling, **not** malicious recomputation or a claim of actual broker authenticity. Tests are based on synthetic CSV only.

## Local regression summary

- Windows/research Python `unittest discover`: **75/75 passed**.
- Modal Python `unittest discover`: **36/36 passed**.
- Cloudflare provider Python preflight: **13/13 passed**.
- Node Cloudflare stateless/stream-bound source tests: **17/17 passed**.
- Account-specific Cloudflare Worker plan/eligibility, persistent Windows x64 host, genuine market-feed subscriptions, real broker history reports, 24/7 uptime and live ChatGPT-MT5 pairing remain **NOT VERIFIED**.

Official docs: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/ and https://developers.cloudflare.com/workers/platform/limits/ .
