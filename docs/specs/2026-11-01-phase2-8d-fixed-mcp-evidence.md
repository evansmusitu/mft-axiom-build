# Phase 2.8D — fixed-tool MCP JSON evidence adapter
Base GitLab main: `12de41bdca982137c69ce2c32a36a6e5ef10aabd`. Issue #20.

The existing authorized evidence:acquire service remains the only gate that may persist external evidence. MCP tools are untrusted upstream data sources, never policies, execution, broker, worker, or signer authority.

## Selected narrow boundary
- Operator registers a pinned HTTPS origin and fixed `/mcp` RPC endpoint, one fully qualified read-only MCP tool name, a unique operation manifest, one permitted bounded string parameter, a tenant allowlist, maximum response bytes, timeout, and optional server-owned credential reference.
- Deny side-effect-like tool names and dangerous verbs. This is a naming guard, not a proof that a remote server's tools are actually read-only. Operators MUST vet remote tool behavior and provision read-only credentials.
- No tools/list, resource discovery, prompts, initialization negotiation, dynamic tool selection, broker operations, unrestricted JSON-RPC methods, arbitrary URLs, caller tenant, or caller-controlled authorization.
- Only exact `tools/call` JSON-RPC method, with deterministic ID domain-bound to tenant+operation+request parameter. Server constructs the JSON; external responses must echo exact JSON-RPC protocol and ID and exactly one text content item containing strict valid JSON. Reject isError, multiple blocks, binary/image/resource outputs, unexpected fields and RPC errors.
- HTTPS origin validated with existing AXIOM origin policy; fixed path and manual redirect denial; request/response bounded, strict JSON UTF-8 and media type, timeout and AbortSignal; resolved secrets only in HTTP headers and not captured body, result or error.
- Existing deterministic mapper and Ed25519-attested ingestion establish the only durable fact provenance. Reasoning replay reads stored snapshots offline.
- Distinct from deployment maturity: MCP server trust, network DNS rebinding, TLS pinning, rate limits, lifecycle sessions, full Streamable HTTP protocol negotiation, IAM/tool ACLs, remote truth, remote side-effect verification, and profit guarantees are not delivered.

## Acceptance
RED missing module, GREEN fixed tool read-only capture, adversarial parameter/tool/tenant, origin/secret/redirect/protocol/content/response-limit denials, signed evidence integration, Phase 2.8D gate, source fingerprint in compatibility matrix, Phase1/Phase2/PG full CI, MR-native and main postmerge checks. Source branch retained and non-squash merge.
