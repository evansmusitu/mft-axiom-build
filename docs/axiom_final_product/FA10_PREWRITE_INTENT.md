# FA-10 — Deep Context & System Graph — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_IMPLEMENTATION

## Frozen source authority
Authoritative final-product program defines FA-10 as:
- Class: Implementation
- Scope: code/runtime/data/infra/traces/requirements/evidence retrieval and dependency graph.
- Gate: **Retrieved data cannot elevate authority.**

Live implementation parent / rollback origin: sealed FA-09 head `fe57fda84bddfb1475d1fab46e61701a5e780941`.

## Implementation intent
Build an additive browser-local Deep Context projection/index over already-earned AXIOM stores and explicit retrieved-context records. Existing Project, Research, Observability, Evidence, Developer, Agent and security stores remain authoritative for their own records.

The System Graph will normalize only seven context domains: `code`, `runtime`, `data`, `infra`, `trace`, `requirement`, `evidence`. Every context node must retain source identity, provenance, content digest, retrieval/as-of metadata where applicable, trust classification, injection flags, and explicit `instruction_authority: NONE` / `authority_effect: NONE` semantics. Dependency/reference/provenance edges may affect context relevance and planning, but may not grant or delegate execution authority.

## Authority-invariance rule
Retrieved or indexed content is DATA, NOT AUTHORITY. Context is prohibited from changing, granting, weakening or overriding any of the following:
- identity/session or workload identity;
- tool/data scopes or capability qualification;
- autonomy, risk class, approval policy or budgets;
- network/egress policy;
- secret/credential policy or credential material;
- production/deployment authority;
- claim authorization, evaluator thresholds or phase status;
- security policy, governance authority or release gates.

Authority-like fields or instruction text found inside retrieved content are preserved only as inert evidence/diagnostics and must be flagged; they are never applied to the governing authority envelope.

## Composition boundary
Reuse existing earned primitives rather than replacing them:
- Project provenance/event graph;
- Research source/claim/citation integrity and injection flags;
- Observability trace linkage and privacy-safe replay;
- Evidence Observatory append-only/fail-closed claim state;
- Developer package/infra metadata and no-network/no-secret contracts;
- Agent/Mission Control authority records.

FA-10 may add a dedicated local context index, dependency graph, pure authority-invariance verifier and additive Inspector/Developer UI. It must not introduce an external retriever, remote code execution, production executor, secret broker, outbound network permission, or autonomous authority mutation. Those belong to later governed phases.

## Verification plan
Before FA-10 can be earned, an independent read-only repository gate must prove at minimum:
1. all seven context domains are represented and provenance-bound;
2. graph edges are dependency/reference/provenance only and cannot act as authority delegation;
3. malicious retrieved instructions and authority-like fields cannot change the authority envelope;
4. tampered node/edge/event hashes fail closed;
5. cross-project context leakage fails closed;
6. existing Research/Observability/Evidence/Developer/Project authority files remain unchanged from sealed FA-09;
7. cumulative vNext and selected earned legacy regressions pass;
8. no new direct network/deploy/repository-write capability exists in the FA-10 verification gate.

## Claim boundary
Passing FA-10 will earn only the Deep Context & System Graph implementation gate. It will not certify external retrieval, production execution, external security validation, Phase 13/14/15, Wolfram parity or superiority.
