# LIFELINE MT5 AI Studio — Private Operator/Agent Hardening v0.8

2026-10-21. **Only isolated research staging is accepted.** No broker login, orders, shell access, public MCP, public customer access, MFA bypass, paid Windows hosting, or merge.

## Verification evidence

### 1. Cloudflare Access identity is NOT a Neon tenant
- The Cloudflare Worker now **requires** a configured `ACCESS_OPERATOR_SUB` value, pinned to the owner subject from a verified, correctly signed Access RS256 JWT with the exact issuer and audience. If it is missing, the edge returns 503 and forwards nothing.
- Only the pinned identity can operate the single `AGENT_TENANT`; the trusted `x-lifeline-subject` forwarded to Modal is the fixed configured tenant, NOT the JWT `sub` and NOT a client-provided header.
- Tests verify wrong owner (even with correctly signed JWT), missing identity pin, wrong audience, expired JWT and header spoofing all fail closed. Valid owner can access status but cannot call order execution.
- Tests passed in cross-platform bridge CI run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39557300141 .
- The **real** Cloudflare Access app continues to have DENY-ALL, no owner enrollment and **no Worker route**. This new `ACCESS_OPERATOR_SUB` is NOT yet provisioned because a verified MFA owner identity is not available. Updating source and mocking signed JWT is not proof of a live MFA-authorized login. NEVER set it to a test subject in production.

### 2. Queued execution has hard safety and cost caps
- Both SQLite reference bridge and live Neon `PostgresQueue.enqueue` enforce **8 active jobs** and **250 total retained jobs per tenant/agent**. PostgreSQL uses a transaction-scoped advisory lock to serialize capacity decisions.
- Public operator stage admits only `probe`, denies attempts to submit trade operations, and returns **HTTP 429** on queue quota.
- Receipt operations MUST match the original signed job operation and tenant in the stored row. Explicit schema, outcome, result type, timestamp, and `trading_enabled=false` constraints apply.
- Stale claimed tasks refresh signature age while retaining original nonce and durable claim, so recovery will not re-execute a native operation.
- Windows, Linux and edge offline tests passed: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39557594331 and https://github.com/evansmusitu/mft-axiom-build/actions/runs/39557594281 .

### 3. Fresh real Neon integration regression is PASS
- Re-deployed the existing **isolated** proxy-auth Modal app `lifeline-mt5-analytics-isolated`, using its established Modal-only secrets; existing secrets were NOT re-generated.
- Internal Modal-only function `verify_private_neon_receipt_binding` connected via the RSA-sealed Neon restricted role, ran a signed job via real Neon, and confirmed all of:
  - valid signed test probe fetched;
  - out-of-tenant operator status rejected;
  - replayed HMAC request rejected;
  - a **validly signed but wrong-operation receipt** rejected;
  - the genuine probe's signed completion receipt committed to Neon.
- All five checks returned `true`, while `live_trading=false` and `host_persistent=false`.
- The Modal cost gate recorded **billed_cost=0** immediately before this run. Free credits/meter can change.
- Independent GitHub Actions run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39557904660 **SUCCESS**. No agent tokens, private keys, DSN, HMAC or Modal proxy tokens printed.
- The original bootstrap workflow attempted to re-create a Secret and failed on a later unrelated code push (run 39557904361), before deploying or mutating the previously established Secret. Its trigger has since been changed to manual-only. The regression workflow is the authoritative success proof.

## Fresh Vercel guest access denial (the *exact latest preview*)

GitHub Actions run https://github.com/evansmusitu/mft-axiom-build/actions/runs/39558218550 **SUCCESS**.
An HTTPS request to the latest protected preview deployment `dpl_3cQimHkLi3ts9ayLRCtPCZKeSggS`, without cookies or following redirects, returned **HTTP 302** to authentication (not HTTP 200 content). Deployment remains a protected status preview with no native trading controls. No production hostname was promoted and no Cloudflare route was created.

## Status of independent cloud services

- GitHub native Windows runner: real vendor-signed MetaEditor compiled MQL5 into EX5. A mathematical calculation Strategy Tester report exists; **not a market-history backtest**.
- Vercel: protected private status UI deployment READY, SSO all deployments. No client-side AI trading route.
- Cloudflare: isolated unrouted Worker and separate explicit DENY-ALL Access app.
- Modal: private proxy-auth research service and validated restricted signed queue.
- Neon: dedicated `frosty-rain-34922526` with tenant FORCE RLS and `lifeline_stage_app` low-privilege real login.
- Windows: **no continuously running machine**, no real localhost MCP pairing, no historical market data or broker demo account.

## Still blocked by real-world prerequisites

1. Owner needs to complete Cloudflare Access MFA enrollment so the **actual signed user subject** can be pinned, and independent positive/negative JWT checks can be performed before assigning any hostname/route.
2. Owner needs to supply an owned/approved persistent Windows x64 host or explicitly fund a Windows VPS. Zero-dollar budget does not authorize a purchase or 24/7 host rental.
3. The full routed Cloudflare→Modal→Neon→Windows persistent path, real built-in MT5 MCP session, and history-backed demo testing are not verified. Do not advertise customer-ready capabilities, profit returns or live trading.

All work remains on isolated draft PR #30. Protected main and other MUSITU resources unchanged.
