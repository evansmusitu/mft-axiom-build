# Official MetaTrader 5 / MetaEditor MCP — LIFELINE native adapter (v0.5)

**Important competitive discovery (October 2026):** MetaQuotes already ships **three MCP servers**: MT5 Terminal, MetaEditor and marketdata. Its own documentation lists compilation, Strategy Tester and trading tools. LIFELINE cannot truthfully claim to be the first general MT5+MetaEditor MCP connector.

Our differentiated product is **enterprise tenant isolation, verified provenance of compiled MQL5/EX5 artifacts, reproducible signed research receipts, developer review and controlled orchestration across supported AI clients.** Do not resell MetaQuotes' tools as original APIs.

MetaQuotes documentation:
- https://www.metatrader5.com/en/terminal/help/mcp_and_ai
- https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration
- https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities

## Local-only secure integration

Terminal: `http://127.0.0.1:22346/mcp` and MetaEditor: `http://127.0.0.1:22345/mcp` (default examples; verify actual URLs in the MT5 installation).

In MetaTrader **Tools > Options > MCP**, enable internal MCP server and issue a secure API token; the MetaEditor MCP server has its own local address. In **Tools > Options > AI Assistant**, set Trading = **No trading**, Web = disabled, and **Dangerous shell operations = disabled**. Never share the copied tokens in GitHub, a browser, logs, or a public MCP config.

On the private Windows host, set the token environment variables `LIFELINE_TERMINAL_MCP_TOKEN` and `LIFELINE_METAEDITOR_MCP_TOKEN` in its private secret store. **These are not deployed yet.**

Use `native_mcp.NativeMCP(NativeConfig("terminal", token))` and the metaeditor counterpart to initialize, obtain **filtered** `tools/list`, and call explicitly informational tools. `native_mcp.py` is a local connector, **not** a publicly exposed HTTP proxy. Its outbound client refuses non-loopback URLs, redirects and HTTP proxies; access is fixed to ports 22345/22346. No shell, orders, strategy execution, arbitrary file writes or remote URL fetches.

Native compilation and mathematical Strategy Tester proof already use `Invoke-MT5Native.ps1` with vendor Authenticode and SHA evidence: this is **separate** from the built-in MCP adapter; the native MCP transport has mock contract tests but **has not been paired with running MetaEditor** in CI. Do not treat mock test success as successful real live MCP integration.

## Product constraints

The remote ChatGPT-facing MCP surface remains **read-only stage status only**. It must not proxy built-in MetaTrader tools, especially trade send/modify/close, shell, file mutation or native EA execution.

A dedicated owner-approved Windows machine with MetaEditor and Terminal running is required for continuous operation; ephemeral Windows GitHub Actions is only an acceptance environment. A broker demo with history must be acquired before claiming profitable strategy backtesting, and real accounts/live trading require independent user-side authorization outside any ChatGPT plugin.

## Offline tests

`python -m unittest -v test_native_mcp.py` from this folder. Workflow `.github/workflows/lifeline-mt5-native-mcp-ci.yml` exercises it on Windows and Ubuntu.

Deployment gate: pair authorized Windows host, discover actual native `tools/list`, verify manual account/web/shell restrictions, and run a real read-only `get_workspace_info` call before enabling an operator UI.
