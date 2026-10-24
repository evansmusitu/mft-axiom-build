# LIFELINE Local MetaQuotes MCP — Owner-Side Read-Only Acceptance

Requires an owner-authorized **Windows x64** machine with signed MetaTrader 5 and MetaEditor binaries. This command never provisions or purchases Windows hosting.

1. Open MetaTrader 5 and MetaEditor on the private Windows computer. In **Tools → Options → AI Assistant**, set **Trading = No Trading**, **Web = disabled**, and **Dangerous shell operations = disabled**. In **Tools → Options → MCP** enable the internal MCP server and generate the separate server bearer keys. Ensure terminal binds **127.0.0.1:22346**, MetaEditor **127.0.0.1:22345**. Do not bind 0.0.0.0 or expose ports.
2. Set the environment variables `LIFELINE_TERMINAL_MCP_TOKEN` and `LIFELINE_METAEDITOR_MCP_TOKEN` **on Windows privately**. Do not paste the tokens into ChatGPT, a GitHub issue, Drive, a browser address, or a ZIP archive.
3. Run `python Verify_LifelineNativeMCP.py` from the directory containing `native_mcp.py`. It uses the native JSON-RPC `initialize` and `tools/list` methods, restricts discovery to reviewed informational tools, and checks rejection of an invalid bearer. It prints **booleans only**, no native reply body or paths.
4. Run `pwsh -File Test-LifelineHost.ps1` only after configuring private agent pairing and a protected HTTPS route (the route is currently **not live**). Do not override `-AllowUnpaired` and call the machine production-ready.

MetaQuotes' official instructions: https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration . The vendor confirms its native MCP servers also expose unrestricted trading and shell functions depending on settings; therefore the local observer does **not** proxy their full functionality. The MetaQuotes settings are separate from LIFELINE's own deny-by-default tool allowlist.

**Current evidence boundary:** this observer is unit tested with simulated responses but has NOT yet connected to a real locally enabled official MCP server. Native compilation using GitHub Actions succeeds separately. The customer-facing Cloudflare Access owner is not enrolled, the Worker is unrouted, and no persistent Windows execution host is owned or connected.
