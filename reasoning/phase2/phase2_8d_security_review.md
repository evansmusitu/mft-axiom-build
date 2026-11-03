# Phase 2.8D bounded source security review — fixed MCP evidence

Canonical base: main `12de41bdca982137c69ce2c32a36a6e5ef10aabd`. Issue #20.

## Validated boundaries
1. A worker key, model output or remote MCP tool cannot authorize `evidence:acquire`. Existing API authorization is before registry acquisition, with tenant-owned and server-owned tool configuration.
2. The only request is `tools/call` under a fixed HTTPS origin and `/mcp` path; no arbitrary JSON-RPC method, list/read resource, prompt, dynamic tool, arbitrary headers, extra parameters or caller-controlled tenant.
3. The tool name is immutable, syntactically restricted and screened for obvious mutating verbs. A hostile remote MCP server might still execute a side effect in a read-named tool. **Read-only transport naming is not proof of remotely enforced read-only semantics.** Secure deployment must inspect/register the exact remote tool and provision least-privilege remote credentials.
4. Server credentials come from `SecretResolver` only and are sent as HTTP headers. The request body, persisted captured evidence and returned exception do not contain secrets. Redirects and secret-echoed upstream bodies fail closed.
5. A strict JSON-RPC envelope must echo the server-derived id, protocol and contain one text content block with `isError:false`, valid bounded JSON, and no unknown fields; caller/model cannot treat additional content as authority.
6. Transport and response bytes are bounded; full-response deadline aborts even after initial HTTP headers. Stream timeout flaw: regression RED `08378491`, pipeline 3015401450 — 229/230 Phase-2 pass, delayed body incorrectly accepted. GREEN fix `f6b67cd2` extends timeout through stream capture. Exact-head verification is required.
7. Existing signed fact ingestion, nonces, atomic acquisition persistence and network-free replay remain independent of MCP server claims.
8. The adapter source fingerprint is included in the strict current compatibility matrix.

## Deployment nonproperties and residual risk
- Not full MCP Streamable HTTP negotiation, sessions, notifications, server push or tool discovery; require stateless fixed `tools/call` MCP-compatible provider behavior.
- Operator must enforce fixed DNS, egress allowlist, TLS, proxy restrictions, remote read-only identity and limits. HTTPS config alone cannot prove no DNS rebinding or remote data exfiltration.
- A provider may fabricate plausible values; signed attestation records the configured adapter's claim, not independent truth. Provenance and deterministic replay cannot guarantee model correctness, financial returns or source honesty.
- A reader implementation may allocate resources before abort; production client and remote server resource budgets must be configured separately.
- No vendor-specific HSM/KMS, broker execution, end-user UI, operator deployment or trading-profit guarantee is claimed.

No unresolved Critical or Important issues are asserted until fresh complete source-head, MR-native and postmerge-main verification.
