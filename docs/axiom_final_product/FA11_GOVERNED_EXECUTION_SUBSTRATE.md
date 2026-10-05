# FA-11 — Governed Execution Substrate

Status: FA11_IMPLEMENTATION_GATE_EARNED_REPOSITORY_VERIFIED_NOT_PRODUCTION_QUALIFIED

Prior status: IMPLEMENTED_PENDING_REPOSITORY_VERIFICATION

## Frozen gate
FA-11 covers terminal/files/sandbox/build/test/secret broker/network/worktree isolation. The hard gate is: **S0-S5 enforced.**

## Implementation
The additive vNext substrate introduces:
- `execution_security.js`: closed operation registry, deterministic S0-S5 classification, path/terminal/network/resource bounds and plaintext-secret rejection;
- `authorization_gateway.js`: independent authority-envelope evaluation, exact request hashing, risk-understatement rejection, workload/grant/budget/incident checks, destination policy and non-self approval separation;
- `execution_store.js`: project/workload-bound browser-local virtual sandboxes/worktrees, bounded file/terminal/build/test operations, opaque secret-lease records, blocked external-executor receipts and tamper-evident event/receipt verification;
- `execution_ui.js`: truthful Build-surface projection of the qualified browser-local substrate and its explicit no-host-shell/no-direct-network/no-plaintext-secret/no-production-deploy boundary;
- deterministic/adversarial tests for the FA-11 gate.

Unknown operations fail closed at S5. Callers cannot lower computed risk. Retrieved data cannot authorize side effects. S4/S5 require distinct independent approvals and remain blocked when a qualified external executor is absent. The browser-local substrate performs no external network request, repository mutation, public deployment, destructive action or plaintext-secret recovery.

## Preserved pre-repository failures
Three implementation defects were found before repository write and converted into regression coverage:
1. the first async approval-rejection test incorrectly used a synchronous assertion;
2. plaintext-secret detection initially missed quoted JSON-shaped keys such as `"password":"..."`;
3. persisted request/approval indexing metadata initially polluted integrity-hash recomputation.

All three were repaired before repository write. The isolated staged harness passed 16/16 tests and syntax checks. That isolated result was not used as the independent repository gate.

## Independent repository evidence — first qualification run
The read-only repository gate executed against exact implementation head:
- implementation head: `4a739ab370880c1dc3fea7b8ba54383315745836`;
- workflow: `MUSITU Axiom FA-11 Governed Execution Gate`;
- run: `34950082105`;
- job: `104318708121`;
- conclusion: **SUCCESS**.

Raw GitHub Actions logs prove:
- cumulative vNext deterministic/adversarial tests: **68/68 PASS**, 0 failed, 0 skipped, 0 cancelled;
- selected earned legacy regressions: **39/39 PASS** — Project 7/7, Observability 6/6, Computer 4/4, Agents 7/7, Developer 7/7, Evidence 8/8;
- the S0-S5 operation registry, risk-understatement rejection, retrieved-data side-effect denial, exact independent approval, distinct S4/S5 approvers, unknown-operation S5 fail-closed behavior, project/worktree isolation, no-plaintext-secret boundary and qualified-external-executor block all passed;
- earned Project, Observability, Agent, Computer, Mission Control and FA-10 Deep Context authority files were unchanged from sealed FA-10;
- `mcp/`, `auth/`, `chatgpt-app-submission.json` and `submission/` were unchanged from sealed FA-10;
- no direct fetch/WebSocket/XHR/EventSource/sendBeacon transport, host shell/process spawn or production executor was introduced by FA-11;
- GitHub token permissions were only `Contents: read` and `Metadata: read` and checkout persisted no credentials;
- the workflow exposes no repository-write, package publication, deployment or infrastructure-apply authority.

The runner emitted only GitHub Actions' Node 20 action-runtime deprecation warning for upstream actions being forced onto Node 24. The tested application JavaScript ran under Node 22.23.2. This warning does not change the FA-11 product/security gate result.

## Existing authority preservation
FA-11 composes with, and does not replace, earned Agent/Mission Control workload identity and grants, Project provenance, FA-10 retrieved-data authority invariance, Computer approval/rollback patterns, and Observability/Evidence integrity boundaries.

## Qualification boundary
The first independent repository run earns the FA-11 implementation gate candidate at `4a739ab370880c1dc3fea7b8ba54383315745836`. This evidence-record commit must itself pass the same read-only gate before the phase is treated as sealed continuation authority.

FA-11 qualification is limited to the governed **browser-local execution-substrate contract**. It does not certify unrestricted local shell access, plaintext or production secrets, direct external network execution, real repository mutation, public publication, production deployment, external security validation, legacy Phase 13/14/15, Wolfram parity or superiority.
