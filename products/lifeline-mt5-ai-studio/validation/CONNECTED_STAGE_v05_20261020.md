# LIFELINE MT5 AI Studio — v0.5 Connected Staging / Honest Delivery Evidence

Date: 2026-10-20. Draft PR #30, isolated branch only. No paid resources knowingly purchased, no broker operations.

## Independent discovery: official MetaQuotes MCP already exists
MetaQuotes now documents native **Terminal**, **MetaEditor** and **marketdata** MCP servers. Native addresses are illustrated as loopback `127.0.0.1:22346/mcp` and `127.0.0.1:22345/mcp` with API-token authentication. Official tools include `compile_file`, `tester_run_backtest`, trading mutations and shell. Thus LIFELINE is NOT first to offer generic MT5+MetaEditor MCP access. LIFELINE's sustainable differentiator must be signed evidence and verified enterprise-safe, isolated orchestration.

Docs: https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities and https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration.

## What passed

1. Windows native compile/test acceptance: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39472075489 . Official installer + native MetaEditor EX5 build; mathematical optimization report (NOT price-history strategy performance). See NATIVE_ACCEPTANCE_20261020.md.
2. Restricted local official-MCP bridge, `windows/native_mcp.py`: exact localhost URL allowlisting, redirects/proxies disabled, bearer token environment/constructor only, JSON-RPC contract, filtered tool discovery, no trading/shell/compilation remotely. 13 offline security/protocol tests passed on both Windows 2022 and Ubuntu 24.04 at https://github.com/evansmusitu/mft-axiom-build/actions/runs/39495426549 . Note: tests were mocked and DO NOT prove communication with live built-in MT5 MCP.
3. Independent Vercel project created: `lifeline-mt5-ai-studio-stage`, ID `prj_qkviXEqdi9n0qxpbRdhVuylvPRq9`; Vercel API explicitly confirmed `ssoProtection.enabled=true`, `deploymentType=all`. Static non-trading operator status page deployment `dpl_3UQvT4xZy4SnmLbL5qr4PjzMHocy` state READY, route `https://lifeline-mt5-ai-studio-stage-h9m50mcjx-evansmusitu.vercel.app`. **Surprise:** despite requesting preview, Vercel returned `target=production`. Access auth remains configured for **all** deployments; do not attach public custom domains or weaken SSO. No backend was attached and no credentials are in the page. Unauthenticated HTTP rejection test was unavailable from the execution environment; Vercel project config is confirmed but live denial not independently probed.
4. Neon isolated project `frosty-rain-34922526`, branch `br-fancy-recipe-b5pm4jcf`, DB `lifeline_mt5_stage`. Restricted SQL role `lifeline_stage_app` was created with LOGIN, NOBYPASSRLS, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, INHERIT, granted member of NOLOGIN `lifeline_executor`. Read-back via pg_roles confirmed these flags. It intentionally has **PASSWORD NULL**, so **cannot authenticate** yet and must not be used as a live app credential. Direct `SET ROLE lifeline_stage_app` from owner was denied, therefore live RLS behavior under this LOGIN role remains UNTESTED. The previously unsafe `lifeline_runtime` is still unsafe and must NEVER be used for customer data.
5. Prior Cloudflare Worker deployment `lifeline-mt5-edge-isolated` succeeded with `workers_dev=false`, `preview_urls=false`, no routes/custom domain, no application secrets. It is intentionally closed, not a functioning customer gateway. See CLOUD_STAGE_20261020.md.

## Not complete / product launch gates

- No **persistent Windows host** (GitHub-hosted Windows runners disappear after each job).
- No real paired official MT5 MCP localhost session (needs owner-permitted Windows terminal/MetaEditor, MCP API token, prohibited Trading and shell capabilities, and broker safeguards).
- No historical market-data trading backtest (existing proof is mathematical optimization).
- Neon `lifeline_stage_app` needs a strong confidential password configured inside secure secret management, a separate proxy-authenticated Modal runtime, and live RLS denial testing as its real LOGIN identity. Never use `lifeline_runtime` (has BYPASSRLS).
- Cloudflare Access protected application issuer/audience, forwarding secrets, anonymous denial tests, and Cloudflare-to-Modal-to-Neon-to-Windows end-to-end are unconnected.
- Static Vercel page is READY and SSO configured; no claim is made of a working AI backend or public product.
- No live trading or public ChatGPT plugin listing is enabled or permitted through the research-only surface.

## Secure next execution path

1. Owner supplies a Windows host or explicitly authorizes recurring Windows hosting costs/Windows licensing. Keep its MetaQuotes MCP endpoints loopback only and secrets off GitHub.
2. Make production-grade Neon LOGIN credential in a secret manager, test RLS with two tenants using that **exact** login (not an impersonated owner), then provision bounded private Modal backend within approved no-charge usage.
3. Create separate Cloudflare Access application and verify valid/expired/missing Access JWT before any Worker routes. Wire read-only status only.
4. Perform authenticated outbound pull/probe/receipt from permitted Windows host; verify at-most-once results; no trading or shell.
5. Independently check unauthenticated Vercel protection before any public promotion. Keep PR #30 draft and main untouched.

No fabricated revenue, trading returns, live client, or public deployment claims.
