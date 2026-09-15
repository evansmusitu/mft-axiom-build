# FA-11 — Governed Execution Substrate

Status: IMPLEMENTED_PENDING_REPOSITORY_VERIFICATION

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

All three were repaired before repository write. The isolated staged harness passes 16/16 tests and syntax checks. This result is not the independent repository gate.

## Existing authority preservation
FA-11 composes with, and does not replace, earned Agent/Mission Control workload identity and grants, Project provenance, FA-10 retrieved-data authority invariance, Computer approval/rollback patterns, and Observability/Evidence integrity boundaries.

## Claim boundary
FA-11 remains unearned until a read-only repository gate proves all S0-S5 adversarial requirements, cumulative vNext tests, selected legacy regressions, unchanged earned authorities, no transport/deploy widening and read-only CI. Passing earns only the governed browser-local execution-substrate implementation gate. It does not certify unrestricted local shell access, production secrets, external network execution, production deployment, external security validation, legacy Phase 13/14/15, Wolfram parity or superiority.
