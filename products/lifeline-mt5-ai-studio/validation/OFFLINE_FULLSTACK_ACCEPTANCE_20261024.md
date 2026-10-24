# LIFELINE — Signed cross-language offline private-bridge acceptance — 24 October 2026

## Engineering changes

An isolated cross-language integration harness now runs the **actual existing** JavaScript Cloudflare edge module against the **actual existing** Python FastAPI staging bridge over a **127.0.0.1-only** HTTP server, using a disposable SQLite stage queue and synthetic keys. The real frontend edge's Modal API destination is intercepted in memory and routed to the fixture. A synthetic, locally signed Cloudflare Access JWT exercises RS256 verification. The fixture provisions no public listener, customer credentials or provider resource.

- `infra/cloudflare/local_stack_server.py`: temporary loopback FastAPI/SQLite fixture with fixed, conspicuously non-production test identities.
- `infra/cloudflare/test_local_full_stack.mjs`: genuine signed Cloudflare owner Access JWT, edge rejection before backend, isolated synthetic probe, agent request signature, signed receipt, replay and idempotency checks.
- `.github/workflows/lifeline-mt5-offline-fullstack-ci.yml`: safe, bounded, source-triggered Ubuntu-only fixture; **no secret references or cloud mutation**.

## Independently verified evidence

- [First fully passing offline cross-language run #40090977948](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40090977948): **PASS 1/1 integrated scenario**, source commit `e9fd3c723204e3f65a9a8f4b322fe2b5a96f1870`.
- [Hardened offline cross-language run #40091145427](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091145427): **PASS 1/1 integrated scenario** with additional negative assertions and idempotent completion, source commit `048c46e9026de6d6930d9f3e015871c97ed2d378`.
- Same commit [signed bridge security #40091145398](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091145398), [Five-Cloud product CI #40091145515](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091145515), [AXIOM reasoning #40091149472](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091149472), [brand guard #40091149466](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091149466): **SUCCESS**.

The integrated scenario asserts:

1. An anonymous owner and a *differently signed-in owner* cannot reach the private bridge.
2. Correct authenticated requests still return HTTP 503 when the independent private-backend cutover flag is absent.
3. A trading tool name is blocked at the edge; the only listed MCP tool is `lifeline_status`.
4. A genuine synthetic `operator/probe` creates exactly one bounded queue job.
5. Incorrect agent HMAC signatures fail at the edge; correct signed HMAC passes the edge and the Python bridge.
6. The Python-created job's signature is independently verified by Node crypto (cross-language canonical JSON/HMAC contract).
7. Replay of identical authenticated pull headers fails at the backend, and the edge strips internal response details.
8. A cryptographically valid receipt with the *wrong operation* is rejected; a properly bound signed receipt completes the job.
9. Idempotent receipt retries are acknowledged without rerunning the operation; the next pull returns no job.
10. The nontrading queue status reflects one completed synthetic task.

## Hard boundaries

This is a **local contract integration**, not a real authenticated owner→Cloudflare→Modal→Neon round trip. The `MODAL_PROXY_KEY` and `MODAL_PROXY_SECRET` strings in this fixture are **obvious fake test constants** intercepted before network access. SQLite is not Neon, localhost FastAPI is not a Modal deployment, and the simulated synthetic probe is **not a Windows MT5/MetaEditor pairing**. The test's in-memory `LIFELINE_PRIVATE_BACKEND_CUTOVER='AUTHORIZED'` is NOT a Cloudflare Worker binding and is not deployed. In the actual private Worker, backend cutover remains disabled.

Latest independently reported deployment state remains **6/10** Cloudflare bindings (four sensitive bindings not installed). A live read-only Modal audit found 13 other applications sharing the workspace environment and no demonstrated app-specific proxy-token scope. **Do not create a workspace-wide proxy token** or attach it to Cloudflare until isolation is legitimately verified. Modal technical support is being consulted; no approval received in this acceptance.

No trades, broker accounts, production customer data, paid compute, Windows VPS, Modal function invocations or actual Cloudflare/Neon provider writes were performed by these new integration tests. Protected main remains untouched; PR #30 is draft/unmerged.

## Next acceptance gate

A dedicated, genuinely app-scoped Modal authentication boundary plus confidential transport of existing LIFELINE stage keys, followed by live owner-MFA Cloudflare→Modal→Neon positive and negative requests **with cost controls**. A persistent trusted native Windows x64 host remains separately required. Do not infer the gate has passed from offline mocks.


## MCP interoperability fix (legacy lifecycle) — test-led implementation

The LIFELINE staging MCP server advertises **2025-03-26**, whose official lifecycle requires the client to send a notification **without an id** after the `initialize` response. A compliant initialized notification must be acknowledged by Streamable HTTP `202 Accepted` with **no body**, not a fabricated JSON-RPC response. Previously, the Cloudflare edge denied the method and the Python bridge rejected any message without an id.

Reference: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/lifecycle.mdx and https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/transports.mdx

- **Red** [run #40091493368](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091493368): legacy notification assertion failed in the Cloudflare edge; Python rejected 202 lifecycle assertion [run #40091493397](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091493397); cross-language offline harness also rejected it [run #40091493367](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091493367).
- **Green** [signed-bridge #40091616074](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091616074): **24/24 Cloudflare tests PASS**, Windows/Ubuntu agent+bridge jobs PASS. [Cross-language offline #40091616041](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40091616041): integrated synthetic signed probe plus legacy lifecycle **PASS**. Owner-readiness contract and Five-Cloud status at source commit `c1790b1393658213d473699b796768302e66bd83` are separately checked.
- Cloudflare allows **only** exact `notifications/initialized` with no id and no unexpected fields, after owner JWT and independent cutover checks; upstream must return `202` with empty body. Other notifications and trade tools remain forbidden.
- The staging FastAPI handler accepts that one notification, denies forged/extra fields, and responds with **202 no content**.
- This is a narrow legacy MCP protocol fix; it is **not evidence of full MCP certification, owner login on the live bridge, or live Modal/Neon cutover**.

Strict $0 scope preserved: no Cloudflare production deployment, no Modal remote functions, no broker/trading, no Windows server, no private credential changes and no release.
