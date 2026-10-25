# LIFELINE MT5 — existing owner/agent edge input size-bound checkpoint, 25 October 2026

**Scope:** LIFELINE source-only owner gateway and agent bridge. No provider mutation, billing or account authorization; no Windows/MT5 pairing or broker orders; protected main untouched. This is the existing legacy owner/agent route hardening, **not** a deployment of the private stateless alternative.

## Finding and fix

`infra/cloudflare/index.mjs` previously used `request.text()` before checking `TextEncoder().encode(raw).length > 65536`, so the runtime buffered an entire potentially hostile request before rejecting it. Its declared `content-length` precheck did not bound data if the header was absent or false. Add `infra/cloudflare/bounded_body.mjs` with an incremental 65,536-byte limit on the actual stream. On excess, call `reader.cancel()` without awaiting a potentially stalled cancellation and issue the unchanged 413 response. Validate declared content length syntax and magnitude; apply fatal UTF-8 decoding; malformed inputs receive 400. JSON validation, signed agent HMAC, pinned Cloudflare Access owner JWT, restricted MCP operations, cutover gating and Modal upstream behavior remain unchanged.

The source-only `infra/cloudflare/test_bounded_body.mjs` adds five unit tests. `infra/cloudflare/test.mjs` also adds a legacy gateway integration case asserting oversized streamed agent data is cancelled before Modal fetch, requiring the `jose` dependency in GitHub CI. The existing `lifeline-mt5-bridge-ci.yml` edge-security job runs both suites on pushes to the isolated branch.

## Local evidence

- **RED** before replacement: legacy `Request.text()` demonstrated buffer exhaustion (200 x 2,048-byte chunks) and no stream cancellation; prior code could only reject *after* buffering (inline Node 22 reproduction, exit 1).
- **RED** prior to new helper implementation: standalone unit test failed to import missing module, exit 1 (scaffold confirmation, not itself a behavior regression).
- **GREEN**: `node --test test_bounded_body.mjs` -> **5 pass / 0 fail**.
- **GREEN**: `node --test test_bounded_body.mjs alternative/test_alternative.mjs alternative/test_config.mjs` -> **17 pass / 0 fail**.
- **GREEN**: `python3 -m unittest -q test_provider_preflight.py` -> **8 pass / 0 fail**.
- **GREEN**: Windows `python3 -m unittest -q test_agent.py test_poller.py test_native_mcp.py test_mcp_host_observer.py` -> **61 pass / 0 fail**.
- **GREEN**: Modal `python3 -m unittest discover -s . -p 'test_*.py' -q` -> **36 pass / 0 fail**.
- Full `node --test test.mjs` was **not executable locally** without `jose` in the isolated npm cache. The signed Bridge CI job is responsible for verifying the actual `index.mjs` integration, and must be checked after commit; a green source-check-only workflow is not sufficient.

## Constraints and next gate

- Current frozen branch before this change `f5d6041daa60f51e7e65c4b3eb2741c70264a300`, draft PR #30; GitHub source readback, CI and a new SHA-256 checked handoff must be completed separately.
- Cloudflare Workers Free entitlement and effective $0 spending cap remain unverified; 11 existing D1 databases on the last authenticated read-only audit, no new database allowed. The D1-free private status Worker is **not deployed**, legacy Modal connection stays disconnected, and Windows-native MT5 MCP host is not paired.
