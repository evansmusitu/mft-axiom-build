# Axiom MCP networking feasibility from Databricks — guarded import

Date: 2026-10-28

- Workspace: `https://dbc-3179c56f-a6c7.cloud.databricks.com`.
- Import Actions run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40669356742
- Notebook object ID: `377953653114184`.
- Source SHA-256: `2c0e1758a3cd1736822cae867cd6da24be81a3d441d01882cf06ca8bc86b1948`.
- Private path relative to authenticated user home: `MUSITU_AXIOM_PRIVATE_PILOT_20261027/05_musitu_axiom_mcp_egress`.
- Import did **not** start compute.
- One-time network qualification will POST **only** MCP `initialize` and `tools/list` to https://mcp.mftintelligence.com/mcp without a bearer credential. No `tools/call` request is permitted.
- The run is bounded to one serverless notebook task and a 330-second Jobs timeout; does not provision a persistent cluster.
- The next commit is tagged to execute that one-time probe. The notebook's output must explicitly report success or block/unsupported; no authenticated integration can be claimed from network reachability alone.
- Production Axiom and GitHub main remain unmodified.


## Cross-vantage conclusion — 2026-10-28

**Databricks serverless probe (actual Jobs execution):**
- GitHub Actions: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40669443148
- Databricks run ID: `553907949486459`
- Job log: `MUSITU_AXIOM_DATABRICKS_MCP_EGRESS_ATTESTED`
- `initialize_http=0`, `initialize_supported=false`, `status=BLOCKED_OR_UNSUPPORTED`
- Public `tools/list` was **not** reached and no Axiom tool was executed.
- HTTP 0 here means that Python's HTTP client encountered a network exception or timeout (the probe does not disclose its exception detail). It does **not** prove a particular network policy denial.

**Independent GitHub Actions network vantage:**
- GitHub Actions: https://github.com/evansmusitu/mft-axiom-build/actions/runs/40669665194
- `GET /health`: HTTP 200, curl exit 0
- `GET /.well-known/oauth-protected-resource`: HTTP 200, curl exit 0
- `POST /mcp` initialization: HTTP 200, curl exit 0
- No bearer credential, user data, or Axiom `tools/call` was used.

**Integration implication:**
- Axiom's public MCP gateway is reachable from the GitHub runner.
- Databricks serverless network reachability is **not established**. A trial egress policy is a plausible explanation, not a confirmed root cause.
- The isolated GitHub brokerage route can drive Databricks Jobs/MLflow via `DATABRICKS_TOKEN`; its current Axiom side must remain snapshot-only or unauthenticated discovery until a dedicated service identity and server-side operation allowlist exist.
- The existing Axiom OAuth authorization server has ChatGPT-specific redirect URI validation and does not advertise a client-credentials grant. Do not silently reuse ChatGPT OAuth refresh tokens or personal Axiom API keys for a Databricks service.
- Databricks MCP service registration also needs CREATE SERVICE/CREATE CONNECTION or USE CONNECTION permissions; the read-only Unity API probe confirms 11 built-in MCPs visible but not registration rights.
- No external service or network policy has been created or changed.
- Axiom production main, PR #1, and the public MCP gate were not modified by these tests.

**Owner/administrator-side unlock:**
1. Confirm whether the trial permits an appropriate network policy/allowlist for `mcp.mftintelligence.com`, without a paid upgrade.
2. Provision a distinct, narrowly scoped, revocable Axiom Databricks service identity in an independently qualified private staging gateway; enforce three approved financial tools server-side.
3. Grant Unity Catalog permissions only after the gateway contract and dedicated identity are qualified, and register via a schema-level HTTP connection with credentials held by Databricks.
4. Test `tools/list` plus one synthetic authorized tool call and one forbidden generic-execute call. No sensitive data and no production rollout.

Official Databricks sources:
- https://docs.databricks.com/aws/en/getting-started/free-trial
- https://docs.databricks.com/aws/en/security/network/serverless-network-security/manage-network-policies
- https://docs.databricks.com/aws/en/ai-gateway/register-mcp-service
