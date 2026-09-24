# MUSITU Axiom Multi-Provider Frontier

This is an isolated interoperability, distribution-preparation, security, and evaluation lane. It does not replace or modify the OpenAI review snapshot.

## Hard boundaries

- The OpenAI review snapshot remains governed by frontier_review_safe/review_snapshot_manifest.json.
- Frontier staging must use a dedicated HTTPS endpoint and must never equal the current production MCP URL.
- No workflow in this lane deploys the production Worker, OAuth service, production database, KV/R2, DNS, or production secrets.
- The shared provider-neutral contract contains no provider-specific execution assumptions.

## Evaluation

cases/cases.jsonl is the single sealed caseset. Its SHA-256 is emitted by evaluate.py. Provider runs must reuse that exact hash and record model/product version, date, tools, data, constraints, outputs, latency, usage/cost where available, verification, and evidence hashes.

## Distribution

Anthropic: remote MCP connector and Messages API MCP connector are primary routes; an MCPB package is prepared for local Claude Desktop distribution.

Meta: the evaluation lane targets the Meta Model API where available. Meta's official Business Messaging MCP is treated as a separate Meta-provided business-messaging surface, not as proof of a general third-party MCP directory.

MCP Registry: registry/server.template.json is intentionally not publishable until a real isolated staging URL and namespace ownership proof exist.
