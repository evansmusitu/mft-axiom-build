# FA-10 — Deep Context & System Graph

Status: IMPLEMENTED_PENDING_REPOSITORY_VERIFICATION

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

Both were repaired before repository write. The isolated implementation harness then passed 16/16 tests and all implementation modules passed syntax checks. This local result is not the independent repository gate.

## Boundary
FA-10 introduces no external retriever, direct `fetch`/WebSocket/XHR/EventSource transport, remote code execution, production executor, secret broker, deployment authority, candidate promotion, evaluator-threshold mutation or autonomous authorization. Existing Research, Observability, Evidence, Developer and Project authorities remain the source of truth.

## Claim boundary
FA-10 remains unearned until an independent read-only repository gate passes the cumulative vNext tests, selected earned legacy regressions, unchanged-authority checks, no-network/no-deploy checks and the exact authority-invariance adversarial suite. Passing that gate would earn only the FA-10 implementation gate, not production qualification, external security validation, Phase 13/14/15, Wolfram parity or superiority.
