# MUSITU AXIOM Operator Bridge v1

Status: **isolated private candidate — no production/public authority**

Branch: `frontier/axiom-operator-bridge-20261006`

Base: `07a01aa59e5c8512a074fcb5c4a147d265b1221a`

## Purpose

Expose the already-implemented AXIOM whole-product execution primitives through one private operator surface without changing the frozen OpenAI finance submission, the public Plugin Gate, production MCP/OAuth, `main`, or PR #1.

The bridge is an adapter. It does not invent new execution authority.

## Bound subsystems

- `PlannerStore` — SQLite-durable Work graph, ready-node execution, failure, explicit replanning and history.
- `AgentAutomationLedger` — governed agent registration/delegation and integrity.
- `UniversalArtifactEngine` — versioned artifacts, edits, rollback and export.
- `EvidenceObservatoryLedger` — immutable evaluation definitions and integrity verification.
- `ComputerExecutionLedger` — visible local document/computer sandbox, exact action approval, rollback and tamper-evident receipts.
- `ProviderFallbackRouter` — optional injected provider execution only after separate adapter admission.
- `MCP2026Server` — exact private MCP tool surface.
- `OperatorHTTPApplication` — bearer-authenticated HTTP adapter for the private MCP surface.

## Exposed v1 tools

### Project / Work

- `axiom.project.create`
- `axiom.project.status`
- `axiom.work.create`
- `axiom.work.status`
- `axiom.work.ready`
- `axiom.work.start`
- `axiom.work.complete`
- `axiom.work.fail`
- `axiom.work.replan`

### Agents

- `axiom.agent.register`
- `axiom.agent.delegate`
- `axiom.agent.integrity`

### Artifacts

- `axiom.artifact.create`
- `axiom.artifact.edit`
- `axiom.artifact.rollback`
- `axiom.artifact.export`

### Evidence

- `axiom.evidence.register`
- `axiom.evidence.verify`

### Computer

- `axiom.computer.session.create`
- `axiom.computer.load_document`
- `axiom.computer.propose`
- `axiom.computer.approve`
- `axiom.computer.execute`
- `axiom.computer.rollback`
- `axiom.computer.integrity`

### Provider

- `axiom.provider.status`
- `axiom.provider.execute`

Provider execution is fail-closed. Without an injected, separately admitted `ProviderFallbackRouter`, status is `UNAVAILABLE` and execution is rejected.

## Durability truth

The bridge reports durability rather than overclaiming it.

- Work/plans: **SQLITE_DURABLE**
- project metadata/work index: **FILE_DURABLE**
- agents: **PROCESS_LOCAL_REFERENCE_RUNTIME**
- artifacts: **PROCESS_LOCAL_REFERENCE_RUNTIME**
- evidence: **PROCESS_LOCAL_REFERENCE_RUNTIME**
- computer sessions: **PROCESS_LOCAL_REFERENCE_RUNTIME**

A future promotion may replace process-local reference runtimes with admitted persistent backends. v1 must not label them durable before that evidence exists.

## Computer/browser authority boundary

The current `ComputerExecutionLedger` does not perform external network requests. It operates on explicitly supplied document state and local reversible actions.

The bridge therefore does **not** claim Work-mode internet browsing or external consequential execution.

Real external browsing/provider execution requires a separately admitted adapter with:

1. authenticated provider identity;
2. workload identity binding;
3. bounded network policy;
4. secret-handle isolation;
5. explicit approval for consequential actions;
6. tamper-evident execution receipts;
7. rollback/recovery semantics where applicable;
8. independent qualification before promotion.

## HTTP boundary

`OperatorHTTPApplication` exposes:

- `GET /health` — safe authority/status only.
- `POST /mcp` — requires an exact bearer token and MCP 2026 headers.

The built-in standalone server binds only to loopback. Direct non-loopback binding is rejected. Remote deployment must sit behind a separately reviewed TLS/auth proxy or equivalent private execution fabric.

Bearer credentials must never be committed to Git, evidence artifacts, logs, or chat transcripts.

## Explicitly absent authority

v1 has no authority to:

- alter `main`;
- merge or close PR #1;
- modify the frozen OpenAI submission;
- modify `mcp/musitu_axiom_plugin_gate_v4.mjs`;
- modify `mcp/musitu_axiom_mcp_worker_v2.mjs`;
- deploy production;
- publish externally;
- reveal plaintext secrets;
- bypass external OAuth/account authorization;
- self-certify Level 5, Level 6, Level 7, superiority, or production readiness.

## Qualification

The branch gate requires:

- isolation from base `07a01aa59e5c8512a074fcb5c4a147d265b1221a`;
- exact operator tool schemas with `additionalProperties: false`;
- durable Work surviving bridge restart;
- approval-required computer execution;
- provider execution fail-closed when no router exists;
- real agent registration/integrity;
- real artifact create/export/integrity;
- real evidence definition/integrity;
- MCP list/call execution;
- HTTP bearer rejection/acceptance;
- no production/public-submission authority.

The red→green history is preserved in GitHub Actions:
- first red: missing `operator_bridge`;
- second red: missing `operator_http`;
- green runs must execute the unchanged behavioral contract.

## Next promotion step

Do not merge this candidate into production.

The next isolated step is to attach one admitted durable remote execution substrate and TLS/private-connector identity, then qualify that deployment independently. Only after that should ChatGPT or another client be connected to this Operator Bridge.
