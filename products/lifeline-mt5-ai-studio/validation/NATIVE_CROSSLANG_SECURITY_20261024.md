# LIFELINE — native Windows, MCP initialization and tenant-isolation acceptance

Date: 24 October 2026. Scope: isolated GitHub branch `product/lifeline-mt5-fivecloud-isolated-20261020`, draft PR #30; protected main pinned `bc48ab8aed137e61b76e25f113bb29e1efd7b11a`. All changes **source-only** except ordinary GitHub-hosted, disposable CI jobs. No Cloudflare, Modal, Vercel, Neon or Windows server deployment was executed by these commits.

## Verified engineering work

### MCP 2025-03-26 initialization schema

Prior edge/bridge handlers admitted an arbitrary JSON object for `initialize`, even without a negotiated protocol version, capabilities, or client identity.

- RED: [bridge security run 40094844183](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40094844183) and [native gateway run 40094844185](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40094844185) reproduce inappropriate acceptance.
- GREEN: [bridge run 40095041179](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095041179) **26/26 edge tests PASS**, Windows+Ubuntu agent suites PASS; [cross-language run 40095041178](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095041178) PASS; owner-readiness, Five-Cloud, Axiom and Brand CI also pass at source commit `2b45547591aff94bc4636143f48f75d7dc4a19c6`.
- Only the explicitly supported `protocolVersion: "2025-03-26"` with object `capabilities` and bounded `clientInfo.name` / `clientInfo.version` fields is accepted by edge and local backend. Unknown initialization fields or malformed identity are denied.
- This is **not** a claim of universal MCP protocol negotiation for newer clients. It is intentionally restricted to the advertised legacy protocol.

### Genuine GitHub native Windows x64 *cross-language* fixture

- [Native Windows acceptance run 40095181801](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095181801): **PASS** on GitHub Actions `windows-2022`. It ran the real LIFELINE JS edge and real Python FastAPI bridge together over `127.0.0.1` with an offline SQLite queue, synthetic signed Access owner JWT, HMAC-signed agent job, matching signed receipt, negative auth/replay/trade tests and idempotent result.
- Runs **only** on one workflow-file push or an explicitly dispatched workflow, not every source push. This prevents recurring Windows CI-minute consumption.
- This does **not** run a real MT5 process, official native MetaEditor MCP, real Modal proxy authentication or Neon SQL, nor demonstrate a 24/7 Windows host.

### MCP tenant isolation at private Python gateway

- RED: [Windows/Ubuntu gateway run 40095386939](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095386939): **five unsupported tenant-subjects admitted** with otherwise valid shared edge secret. The old `/mcp` handler checked secret presence but did not check that the passed tenant subject was actually enrolled.
- GREEN: [bridge security run 40095464118](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095464118) Windows+Ubuntu+edge PASS, and [cross-language run 40095464120](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40095464120) PASS. The private MCP status endpoint now requires an exact member of the configured stage tenant set in addition to the existing edge secret and Modal proxy authentication boundary.
- No new tenant, database user, or sensitive credential was created.

## External dependencies blocking live connection

Last authenticated Cloudflare metadata: **6/10** binding names configured, **four** sensitive bindings absent: `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET`, `EDGE_SHARED_SECRET`, `AGENT_HMAC_KEY`. Source-pinned agent identifiers have not been independently compared against Modal secret values. Their absence is intentional: a live Modal provider metadata audit found **13 other applications in the same workspace environment** and **44 existing proxy token metadata records**, with **no evidence of per-app isolation on Starter**. A new proxy token could confer access to unrelated apps. Do not create it or disable existing proxy auth as a workaround. Modal support inquiry sent; no positive scope decision verified.

Real Cloudflare→Modal→Neon owner JWT positive/negative tests, secure escrow of existing stage secrets, permanently paired Windows x64 host, actual MT5/MetaEditor local MCP and historical quote backtests still require genuine external acceptance. The `LIFELINE_PRIVATE_BACKEND_CUTOVER` flag remains absent from the real Worker. Trading and unrestricted shell are disabled.

## Cost and release rules

- **$0 out-of-pocket**, no billing upgrades, new cloud resources, paid activation or auto-deployment.
- Signed tests use synthetic keys; no actual payment card data, broker credentials, real customer data, real user messages or live financial orders.
- PR #30 remains **OPEN/DRAFT/UNMERGED**, protected main and other MUSITU projects untouched.

## Next task

Obtain Modal's official confirmation of a dedicated no-cost LIFELINE environment/workspace or a truly app-scoped proxy token, with no unexpected billing exposure. Until provider isolation exists, keep testing off-network and maintain owner-only Cloudflare diagnostics. Never count offline CI as live backend integration.
