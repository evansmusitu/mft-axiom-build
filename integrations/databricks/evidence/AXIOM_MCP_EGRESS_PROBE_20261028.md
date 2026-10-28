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
