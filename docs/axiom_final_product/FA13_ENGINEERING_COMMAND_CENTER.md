# FA-13 — Engineering Command Center

Status: FA13_IMPLEMENTATION_INTEGRITY_VERIFIED_ACCEPTANCE_MATRIX_BLOCKED

## Frozen gate
FA-13 is governed by the authoritative 14-row Engineering Command Center acceptance matrix. The phase rule is: **reject if below Windsurf/Devin-class core engineering or if AXIOM breadth is weakened.**

Passing implementation-integrity tests is not equivalent to passing the acceptance matrix. This record therefore seals only the repository implementation-integrity evidence. **FA-13 itself remains unsealed and blocked.**

## Additive implementation
FA-13 adds:
- `engineering_command_center_security.js` — exact 14-row registry, non-interchangeable row states, independent-evidence normalization, model qualification router, checkpoint sealing and deployment-stage validation;
- `engineering_command_center_verifier.js` — row-by-row fail-closed verification, whole-snapshot hash binding, external-builder self-verification rejection, breadth preservation and separate implementation-integrity vs matrix status;
- `engineering_command_center_adapters.js` — truthful matrix derivation and Command Center snapshot composition;
- `engineering_command_center_store.js` — Project-scoped Engineering Spaces, checkpoints, model routes, blocked cloud handoffs, deployment control plans, incidents, matrix evidence and hash-linked events;
- `engineering_command_center_ui.js` — Engineering Mission Control, governed browser-local IDE/workspace controls, bounded terminal, checkpoints, matrix truth, agent fleet, Deep Context/System Graph, model-routing state, cloud-handoff state, release lane, enterprise/security truth and retained AXIOM breadth;
- deterministic/adversarial FA-13 tests;
- a read-only GitHub integrity workflow.

FA-13 composes sealed FA-09 Mission Control, FA-10 Deep Context/System Graph, FA-11 S0–S5 execution and FA-12 Product Reality rather than rewriting those authorities.

## Engineering workspace truth
The browser-local Engineering Space exposes a governed workspace contract for file tree/editor/diff/diagnostics/search/tests/preview and composes with the FA-11 virtual worktree for governed file read/write, build/test and bounded terminal actions.

It remains explicitly **not a native host shell**. External repository mutation, cloud-agent execution and production deployment are not fabricated. The UI explicitly states `PRODUCTION AUTHORITY: FALSE` and does not infer parity, cloud execution, deployment, SSO or red-team qualification from UI presence.

## Preserved hardening failures
Before repository write, three truth-boundary weaknesses were found and fixed:
1. the first Engineering Store snapshot could have returned the complete AXIOM breadth list without requiring runtime proof that those routes were actually registered;
2. the first verifier draft did not bind the complete Engineering Command Center snapshot hash;
3. syntactically valid external evidence did not yet reject an external verifier identical to the builder.

All three are now regression tests. The store defaults breadth to unproven until actual routes are supplied; whole-snapshot tampering fails closed; and externally qualified rows reject builder self-verification.

A byte-integrity check also rejected an older staged store variant containing a deployment digest typo before it reached the branch. The selected repository store uses the tested `deployment_sha256` field.

## Local isolated verification
The isolated FA-13 harness passed **18/18** before repository attachment. It exercised the exact matrix, blocked external truth, snapshot/checkpoint tamper detection, cross-project rejection, deployment ordering, model qualification, System Graph authority invariance, breadth preservation and absence of direct external transport/host-shell/deployment-executor primitives.

Local evidence alone was not treated as repository qualification.

## Preserved first repository-gate failure
The first repository integrity run is intentionally preserved:
- run: `34958246082`
- job: `104345390146`
- exact head: `703fd6a27519a8ebbaf4dd42fbb2e86593c30f84`
- result: **FAILURE**

The failure occurred in the first authority/document assertion because the workflow searched for capitalized `Acceptance matrix` while this record used lowercase `acceptance matrix`. Branch ancestry, read-only token permissions and checkout succeeded; product tests did not run because the fail-closed assertion stopped the job.

The repair changed only that brittle case-sensitive assertion. It did not weaken the acceptance matrix, blocker truth, security checks, authority protection or test scope.

## Earned repository implementation-integrity evidence
The repaired exact-head repository run is:
- run: `34958479454`
- job: `104346136639`
- exact head: `f5fb3490919b4acbcb57fcc7d22fc0e81ead729e`
- result: **SUCCESS**

Raw job evidence proves:
- cumulative vNext: **104/104 PASS**, 0 fail, 0 skipped/cancelled/todo;
- selected earned legacy regressions: **39/39 PASS**;
  - Project contract: 7/7;
  - Observability Phase 6: 6/6;
  - Computer Phase 8: 4/4;
  - Agents Phase 9: 7/7;
  - Developer Phase 12: 7/7;
  - legacy Phase-13 Evidence Observatory: 8/8 regression coverage only, **not** an earned legacy Phase-13 claim;
- GitHub token permissions: `Contents: read`, `Metadata: read`;
- checkout: `persist-credentials: false`;
- sealed FA-09 through FA-12 authority files unchanged from sealed FA-12 head `4b818f04cd722f1e2e620e0e42da7200def1897c`;
- protected `mcp/`, `auth/`, `chatgpt-app-submission.json` and `submission/` unchanged;
- FA-13 module syntax and runtime wiring pass;
- frozen 14-row blocker truth and no-self-promotion checks pass;
- no new direct `fetch`, WebSocket, XHR, EventSource, sendBeacon, host process spawn/exec, Docker push, kubectl apply or Terraform apply primitive in the FA-13 modules;
- `status:'BLOCKED_EXTERNAL'`, `production_authority:false` and unproven breadth defaults remain enforced;
- workflow has no repository-write, OIDC, Pages, package, PR, issue, status or deployment authority;
- `git diff --check` passes.

Project tests ran under Node `v22.23.2`; Python regression tests ran under CPython `3.12.14`.

The runner emitted upstream action-runtime warnings because `actions/checkout@v4`, `actions/setup-node@v4` and `actions/setup-python@v5` target deprecated Node 20 internals and GitHub forced those actions to Node 24. Setup actions also emitted a `punycode` deprecation warning. These warnings did not fail the integrity gate and are not represented as product qualification evidence.

## Current acceptance blockers
The implementation must **not** be sealed as FA-13 complete while these rows remain unsatisfied:

1. `IDE` — governed IDE/workspace implementation exists, but Windsurf-class minimum qualification has not yet been independently evidenced for the implemented product. State: `PARTIAL`.
2. `agent_fleet` — local Mission Control/workload-identity semantics exist; independently qualified cloud-agent execution receipt is absent. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.
3. `cloud_handoff` — governed handoff package exists; no qualified external background executor/receipt is bound. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.
4. `deployment` — the exact deployment control-plane sequence exists, but qualified STAGING/CANARY/PRODUCTION/ROLLBACK execution evidence and a release receipt are absent. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.
5. `enterprise` — RBAC/policy-graph model exists; external SSO/admin-provider qualification is absent. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.
6. `security` — independent authorization/security roles are preserved; independent external red-team qualification is absent. State: `IMPLEMENTED_BLOCKED_EXTERNAL`.

The other matrix rows can have repository implementation evidence without converting the overall frozen gate to PASS. Empty runtime state is never converted into evidence.

## Breadth preservation
Engineering remains one subsystem. Home remains outcome-first. The FA-13 UI retains Twin/Scenario, Evidence Observatory, Marketplace and Enterprise as broader AXIOM surfaces without self-certifying later dedicated functionality.

## Claim boundary
The repository integrity evidence above authorizes the statement **FA-13 implementation integrity verified** only. It does **not** authorize `FA-13 PASSED`, `FA-13 SEALED`, Windsurf/Devin parity, production deployment, live cloud-agent execution, external Enterprise SSO, independent external red-team validation, legacy Phase 13/14/15, Wolfram parity or superiority.

The authoritative FA-13 phase remains **ACCEPTANCE_MATRIX_BLOCKED / UNSEALED** until all required rows are genuinely satisfied and independently evidenced.

## Governance incident record
During connector selection before the FA-13 implementation commit, two unintended draft pull requests were opened against `main`: PR #6 (`noop`) and PR #7 (`noop2`). Both were immediately closed, remained unmerged and carried no code changes. PR #1 remained untouched, OPEN, DRAFT and UNMERGED. This incident remains preserved as governance/regression evidence rather than omitted.
