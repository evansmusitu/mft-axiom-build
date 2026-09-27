# MUSITU Axiom Frontier Orchestrator Integration — 2026-09-27

## Control boundary

- Frozen OpenAI review snapshot: `d9196774a9fff3150922e2cb681d16e2423651da`
- Sealed main snapshot: `d6a846f6bbe0bccac1758713eb4de167caf07113`
- Integration branch: `frontier/axiom-orchestrator-integration-20260927`
- Integration head at sealing: `d1b9cfc45daa3d9fc7b67477decde6cef6f5a086`
- Base frontier head: `bd43921b5a9f343f8664f6da0918aece9ee87185`
- PR: #8, open, draft, unmerged
- PR #1: open, draft, unmerged

## What was integrated

AXIOM is the control-plane orchestrator for isolated frontier evaluation. External model providers are replaceable execution backends.

The control path is:

`case/work -> AXIOM initial route -> policy envelope -> provider execution -> fail-closed fallback -> result quality -> evidence hash -> evaluation manifest -> routing feedback`

Initial provider selection is deterministic when the caller does not force a provider:
1. quality floor
2. advertised quality descending
3. advertised latency ascending
4. advertised cost ascending
5. provider ID as deterministic tie-breaker

Fallback preserves the original quality, latency, cost, jurisdiction, scope, and policy constraints.

Routing feedback is observation-only. It cannot silently rewrite production routing policy.

## Provider coverage

The isolated provider contract now includes:
- MUSITU AXIOM
- OpenAI
- Anthropic
- Meta
- Google Gemini
- xAI

Remote MCP execution is wired for:
- OpenAI Responses MCP
- Anthropic Messages MCP
- Google Gemini Interactions MCP server
- xAI Responses MCP

Meta remains a baseline model-provider route in this lane; its adapter is not represented as general remote-MCP support.

## Evidence

Each accepted or blocked orchestration result records:
- case ID
- selected provider
- initial-routing basis
- fallback attempts
- minimum quality floor
- quality score and scoring source
- latency
- cost units
- output SHA-256
- evidence SHA-256
- routing regret signal
- promotion status

The existing sealed 30-case corpus remains the evaluation source of truth.

## Security and release boundaries

The integration rejects the known MUSITU production MCP endpoint.

The frontier security gate continues to protect:
- production MCP
- production OAuth
- production deployment payload
- OpenAI submission materials
- reviewer demo
- production deployment workflows

FA-20 production authority remains disabled in v1 and requires its separate human S4 release gate.

## Verification state

### Verified by local reconstruction
- deterministic provider selection
- preferred-provider execution
- quality-floor fallback
- timeout normalization into fail-closed fallback
- unverified-provider denial
- provider identity binding
- evidence-manifest generation
- Google MCP contract shape
- xAI MCP contract shape

### Repository-level status
GitHub combined commit status for the current integration head reports no status entries through the connected GitHub status surface.

GitHub Actions run execution therefore remains an external repository-state item requiring direct GitHub Actions visibility/manual confirmation.

## Live evaluation prerequisites

Live comparative evaluation requires isolated credentials and an isolated HTTPS AXIOM MCP endpoint.

Expected provider secrets:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_GEMINI_API_KEY`
- `XAI_API_KEY`
- `META_MODEL_API_KEY`

Expected model configuration:
- `OPENAI_MODEL`
- `ANTHROPIC_MODEL`
- `GOOGLE_GEMINI_MODEL`
- `XAI_MODEL`
- `META_MODEL`
- `META_MODEL_API_BASE_URL`

The live runner records skipped providers when secrets are absent. No missing provider is treated as a passing comparison result.

## Claim boundary

This integration does NOT certify:
- world-best performance
- general superiority
- Level-5 external comparative superiority
- Wolfram parity
- production cross-provider failover
- unrestricted autonomous self-modification
- production promotion

Independent live evaluation evidence is required before any of those claims can be enabled.

## External API basis

Google's current Interactions API supports remote MCP servers using an `mcp_server` tool with a URL; Google documents the Interactions API as the recommended interface for new Gemini agentic integrations. xAI documents remote MCP support in its Responses API using an `mcp` tool with `server_url` and `server_label`.

## Next promotion gate

The next valid promotion step is not a production deployment. It is an isolated live multi-provider evaluation run against the sealed corpus, followed by independent verification and comparison analysis.
