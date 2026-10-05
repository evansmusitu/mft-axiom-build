# FA-10 — Deep Context & System Graph

Status: EARNED_IMPLEMENTATION_GATE

## Frozen gate
FA-10 is limited to code/runtime/data/infra/traces/requirements/evidence retrieval and dependency graph. The hard gate is: **Retrieved data cannot elevate authority.**

## Implementation
The vNext implementation adds:
- `deep_context_security.js`: seven-domain schema, provenance/trust normalization, plaintext-secret rejection, instruction-injection diagnostics and nested authority-like-field detection;
- `system_graph.js`: deterministic System Graph builder, dependency-cycle checks, tamper verification, authority-envelope invariance proof and verified browser-local retrieval;
- `deep_context_adapters.js`: projections from already-earned Project, Research, Observability, Evidence and Developer metadata without replacing their source stores;
- `deep_context_store.js`: Project-permission-scoped browser-local node/edge/event ledger with append-safe identities and SHA-256-linked events;
- `deep_context_ui.js`: additive Developer-surface Deep Context view with earned-local-context sync, seven-domain coverage, verified local retrieval and inert user-context indexing.

Every node and edge carries `authority_effect: NONE`; retrieved/indexed content carries `instruction_authority: NONE_RETRIEVED_DATA_ONLY`. Authority-like material inside context is retained only as diagnostics. Graph retrieval returns references, scores, provenance/trust and injection flags; it does not return a new grant or mutate the governing envelope.

## Pre-commit failures preserved as regressions
Two defects were found before the repository implementation commit and converted into tests:
1. plural/nested authority keys such as `tool_scopes` were initially not flagged by the diagnostic detector;
2. the earned-store adapter initially contained a nullish-coalescing precedence syntax error.

Both were repaired before repository write. The isolated implementation harness then passed 16/16 tests and all implementation modules passed syntax checks. That local result is retained as development evidence only; the earned implementation gate below is based on the independent repository verifier.

## Independent repository verification evidence
FA-10 was independently repository-verified on exact commit `e23b67cc83e8cb2b03722f5fdd833f2c880a6c32` by GitHub Actions run `34948003221`, job `104311911105`, conclusion **SUCCESS**.

The raw verifier log proves:
- cumulative vNext deterministic suite: **52/52 PASS, 0 FAIL**;
- selected earned legacy regressions: **45/45 PASS**, consisting of Project 7/7, Research 6/6, Research Quality 4/4, Observability 6/6, Agents 7/7, Developer 7/7 and Evidence candidate-truth regressions 8/8;
- all seven Deep Context domains are represented: `code`, `runtime`, `data`, `infra`, `trace`, `requirement`, `evidence`;
- malicious retrieved instructions remain inert diagnostics and cannot change the authority envelope;
- authority-delegating graph relations, cross-project context leakage, dependency cycles, node/edge/authority tampering and retrieval from an unverified graph fail closed;
- Project, Research, Observability, Evidence, Developer, Agent and Mission Control source-authority files were unchanged from sealed FA-09 head `fe57fda84bddfb1475d1fab46e61701a5e780941`;
- `mcp/`, `auth/`, `chatgpt-app-submission.json` and `submission/` were unchanged from sealed FA-09;
- Deep Context syntax and vNext UI wiring passed;
- FA-10 modules introduced no direct `fetch`, WebSocket, XHR, EventSource, `sendBeacon` or `window.open` transport path;
- UI execution mode remained `CONTEXT_READ_INDEX_ONLY_NO_ACTION` with `production_authority:false`;
- the CI token exposed only `Contents: read` and `Metadata: read`;
- checkout used `persist-credentials:false`, and the workflow had no repository-write, deployment, package-write, pages-write or OIDC-write permission;
- `git diff --check` passed.

The Evidence Phase-13 regression suite passing here does **not** earn Phase 13. It specifically preserves the existing fail-closed truth that Phase 13 remains unearned pending authenticated external review and seal.

The Actions runner emitted a tooling warning that `actions/checkout@v4`, `actions/setup-node@v4` and `actions/setup-python@v5` target deprecated Node 20 internals and were forced by GitHub to Node 24. This warning did not fail any gate step; project tests themselves ran under Node `v22.23.2` as configured.

## Boundary
FA-10 introduces no external retriever, direct external transport, remote code execution, production executor, secret broker, deployment authority, candidate promotion, evaluator-threshold mutation or autonomous authorization. Existing Research, Observability, Evidence, Developer, Project, Agent and Mission Control authorities remain the source of truth.

## Sealing requirement
A sealing-document commit must pass the same repository gate again before it is treated as the final sealed FA-10 branch head.

## Claim boundary
This earns only the FA-10 final-product implementation gate. It does not certify external retrieval, production execution, remote/cloud context ingestion, production workload isolation, independent external security, Phase 13/14/15, Wolfram parity, global superiority or any external comparative claim.
