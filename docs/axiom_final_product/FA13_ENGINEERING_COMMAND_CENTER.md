# FA-13 — Engineering Command Center

Status: IMPLEMENTED_LOCALLY_PENDING_REPOSITORY_INTEGRITY_VERIFICATION_ACCEPTANCE_MATRIX_BLOCKED

## Frozen gate
FA-13 is governed by the authoritative 14-row Engineering Command Center acceptance matrix. The phase rule is: **reject if below Windsurf/Devin-class core engineering or if AXIOM breadth is weakened.**

Passing implementation tests is not equivalent to passing the acceptance matrix.

## Additive implementation
The staged FA-13 slice adds:
- `engineering_command_center_security.js` — exact 14-row registry, non-interchangeable row states, independent-evidence normalization, model qualification router, checkpoint sealing and deployment-stage validation;
- `engineering_command_center_verifier.js` — row-by-row fail-closed verification, whole-snapshot hash binding, external-builder self-verification rejection, breadth preservation and separate implementation-integrity vs matrix status;
- `engineering_command_center_adapters.js` — truthful matrix derivation and Command Center snapshot composition;
- `engineering_command_center_store.js` — Project-scoped Engineering Spaces, checkpoints, model routes, blocked cloud handoffs, deployment control plans, incidents, matrix evidence and hash-linked events;
- `engineering_command_center_ui.js` — Engineering Mission Control, governed browser-local IDE/workspace controls, bounded terminal, checkpoints, matrix truth, agent fleet, Deep Context/System Graph, model-routing state, cloud-handoff state, release lane, enterprise/security truth and retained AXIOM breadth;
- deterministic/adversarial FA-13 tests.

FA-13 composes sealed FA-09 Mission Control, FA-10 Deep Context/System Graph, FA-11 S0-S5 execution and FA-12 Product Reality rather than rewriting those authorities.

## Engineering workspace truth
The browser-local Engineering Space exposes a serious governed workspace contract for file tree/editor/diff/diagnostics/search/tests/preview and can use the FA-11 virtual worktree for governed file read/write, build/test and bounded terminal actions.

It remains explicitly **not a native host shell**. External repository mutation, cloud-agent execution and production deployment are not fabricated.

## Preserved local hardening failures
Before repository write, three truth-boundary weaknesses were identified and fixed:
1. the first Engineering Store snapshot could have returned the complete AXIOM breadth list without requiring the runtime to prove those routes were actually registered;
2. the first verifier draft did not verify the hash of the complete Engineering Command Center snapshot;
3. syntactically valid external evidence did not yet reject an external verifier identical to the builder.

All three are now regressions. The store defaults breadth to unproven until the UI supplies actual registered routes; the verifier fails on whole-snapshot tampering; and independently qualified external rows reject builder self-verification.

## Local isolated verification
Current isolated FA-13 harness: **18/18 PASS**.

It proves at minimum:
- exact 14-row matrix;
- local implementation may have integrity `PASS` while matrix truth remains `BLOCKED`;
- a fully synthetic independently-qualified fixture can exercise the evaluator's `PASS` path without being treated as real-world evidence;
- whole-snapshot and checkpoint tampering fail closed;
- external rows cannot self-promote and builder self-verification fails;
- cross-project evidence fails closed;
- deployment stage skipping fails;
- unqualified model candidates are never selected;
- authority-delegating System Graph relations fail;
- removing a permanent AXIOM breadth surface fails;
- default cloud/deployment/enterprise/security truth remains blocked;
- new FA-13 modules contain no direct external transport, host-shell or deployment-executor primitive.

This local result is not independent repository verification and does not satisfy the real external acceptance blockers below.

## Current acceptance blockers
The implementation must **not** be sealed as FA-13 complete while these remain unproven:

1. `IDE` — governed IDE/workspace implementation exists, but Windsurf-class minimum qualification has not yet been independently evidenced for the implemented product. State: `PARTIAL`.
2. `agent_fleet` — local Mission Control/workload-identity semantics exist; independently qualified cloud-agent execution receipt is absent. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.
3. `cloud_handoff` — governed handoff package exists; no qualified external background executor/receipt is bound. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.
4. `deployment` — exact deployment control-plane sequence exists, but qualified STAGING/CANARY/PRODUCTION/ROLLBACK execution evidence and release receipt are absent. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.
5. `enterprise` — RBAC/policy-graph model exists; external SSO/admin-provider qualification is absent. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.
6. `security` — independent authorization/security roles are preserved; independent external red-team qualification is absent. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.

The implementation also requires real runtime project data to populate checkpoints/model routes when used; empty runtime state is not silently converted into evidence.

## Breadth preservation
Engineering remains one subsystem. Home remains outcome-first. The FA-13 UI retains navigable placeholders for Twin/Scenario, Evidence Observatory, Marketplace and Enterprise surfaces that are explicitly labeled as retained/not-self-certified; their dedicated functionality is not claimed complete before FA-14/FA-15.

## Claim boundary
A successful repository **integrity** workflow may prove that the FA-13 implementation obeys its contracts, preserves prior authorities, passes deterministic/adversarial tests and truthfully reports blockers.

It will **not** authorize changing this phase status to acceptance-matrix PASS while any required row above remains blocked/not proven. It does not prove production deployment, live cloud-agent execution, external SSO, independent external red-team validation, legacy Phase 13/14/15, Wolfram parity or superiority.

## Governance incident record
During connector selection before the FA-13 implementation commit, two unintended draft pull requests were opened against `main`: PR #6 (`noop`) and PR #7 (`noop2`). Both were immediately closed, remained unmerged, and carried no code changes. PR #1 remained untouched, OPEN, DRAFT and UNMERGED. This incident is preserved here as regression/governance evidence rather than omitted.
