# LIFELINE native MCP handshake acceptance — 26 October 2026

Source branch: product/lifeline-mt5-fivecloud-isolated-20261020. This checkpoint fixes the local Windows MetaTrader/MetaEditor MCP client. **No live terminal, broker account, cloud service, customer, or order has been connected.**

## Test-driven correction

Official MetaTrader MCP configuration uses separate authenticated loopback MCP endpoints for terminal (127.0.0.1:22346) and MetaEditor (127.0.0.1:22345). Existing LIFELINE `windows/native_mcp.py` sent JSON-RPC `initialize` and immediately requested `tools/list`; it did not emit `notifications/initialized`. The MCP 2025-03-26 lifecycle requires this notification after initialization and before normal requests.

Fix: accept only the expected negotiated protocol version, send the ID-less initialized notification with the established bearer and session, and mark the client initialized only after a successful empty response. Keep exact loopback-only endpoints, HTTP proxies/redirects disabled, output byte caps, informational tool allowlist, and all trade/shell/file-write denials.

RED before code fix: three targeted tests failed for missing notification, incompatible version accepted, and rejected notification ignored.
GREEN after fix: 20/20 local native handshake/observer tests passed; full Windows Python suite 64/64. Unchanged Modal Python 36/36 and stateless Cloudflare tests 12/12 passed. These are mocked protocol and offline checks, **not live MCP pairing**.

## Requested capability gates

- Direct ChatGPT MT5 operation: not connected. Remote tool remains read-only status; local Windows enrollment and secure bridge verification remain mandatory.
- Live MetaEditor MCP: handshake source corrected and CI-bound; no actual owner Windows `tools/list` response yet.
- Always-on Windows: none verified. GitHub ephemeral runners cannot establish availability.
- Broker-history backtests: native CLI runner exists, but no attributable broker demo history, verified report and run conditions.
- Live charts/prices: no owner-side authenticated feed or freshness proof.
- Autonomous optimization: math/synthetic CI cannot substitute for genuine historical strategy reports.
- Cloudflare private Worker: zero-D1 stateless status implementation remains source-only; account Workers Free entitlement and hard $0 gate unresolved.
- Broker orders: explicitly disabled, including remote MCP passthrough; not a requirement for safe research mode.
- Public SaaS: no customer/tenant publication authorization; identity, cost, security, commercial and host gates remain.

Next live acceptance requires owner-controlled, vendor-signed Windows x64 MT5/MetaEditor, local MCP tokens entered **only on the host** (never in chats/CI), no-trade/Web-disabled/shell-disabled settings, loopback-only listeners, `python Verify_LifelineNativeMCP.py` one-shot positive/negative test, and separate uptime proof for 24/7 claims.

Primary vendor configuration: https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration
