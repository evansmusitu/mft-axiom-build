# FA-13 — Engineering Command Center — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_IMPLEMENTATION

## Frozen source authority
Authoritative final-product program defines FA-13 as:
- Class: Implementation
- Scope: Windsurf-class minimum plus AXIOM governance/evidence/context.
- Gate: **Must pass acceptance matrix.**

Authoritative acceptance source:
- `06_ENGINEERING_COMMAND_CENTER/ENGINEERING_COMMAND_CENTER_ACCEPTANCE_MATRIX.json`
- verified handoff SHA-256: `05f29ed7cac7c88d54f48dfec536969428e04523337db3d38b7d1d02c43e3e85`
- rule: **Reject if below Windsurf/Devin-class core engineering or if AXIOM breadth is weakened.**

Authoritative engineering blueprint:
- `06_ENGINEERING_COMMAND_CENTER/WINDSURF_SUPERSET_ENGINEERING_BLUEPRINT.md`
- verified SHA-256: `84abb20fd3e5ca2207d12d442bd3baa1531d0cbda86b8ff1f6a6eeb82167c6d8`

Live implementation parent / rollback origin: sealed FA-12 head `4b818f04cd722f1e2e620e0e42da7200def1897c`.

## Mandatory acceptance matrix
All 14 rows remain independent and may not be collapsed into a single marketing or UI claim.

1. `IDE` — Windsurf-class engineering workspace + AXIOM Project/Evidence context.
2. `agent_fleet` — local+cloud command center + workload identities/budgets/scopes/evidence.
3. `spaces` — sessions/PRs/files/context + full Project Graph.
4. `context` — fast code context + code/runtime/data/infra/traces/requirements/evidence.
5. `maps` — code maps + multi-layer System Graph.
6. `terminal` — manual/automatic policy + independent S0–S5 authorization.
7. `checkpoints` — code revert + complete engineering state.
8. `preview` — browser preview + Product Reality Lab.
9. `cloud_handoff` — background isolated agent + governed execution fabric.
10. `models` — multi-model + qualification/cost/privacy router.
11. `deployment` — app deploy + staging/canary/prod/rollback/evidence.
12. `enterprise` — SSO/RBAC/admin + agent/data/network/action policy graph.
13. `security` — enterprise controls + independent security authority/red team.
14. `breadth` — must not narrow AXIOM; retain Research/Analyze/Twins/Artifacts/Computer/Live/Governance.

## Truth model for matrix rows
Each row must carry one of these non-interchangeable implementation/evidence states:
- `IMPLEMENTED_VERIFIED`: row contract and implementation are present and independently repository-verified for the claimed scope.
- `IMPLEMENTED_BLOCKED_EXTERNAL`: control plane/contract is implemented but a required external runtime/provider/device/deployment authority is not yet qualified.
- `PARTIAL`: some required components are absent.
- `NOT_PROVEN`: evidence is insufficient.
- `FAILED`: verified behavior violates the row.

FA-13 may be sealed only if every row required by the frozen acceptance matrix is satisfied at the level actually demanded by that row. A truthful `IMPLEMENTED_BLOCKED_EXTERNAL`, `PARTIAL`, `NOT_PROVEN`, or `FAILED` row cannot be relabeled PASS to finish the phase.

## Implementation target
Build an additive Engineering Command Center inside the broader AXIOM OS, not a replacement for it.

### Engineering Mission Control
Expose project objective, acceptance criteria, progress, active agents, workload identity, scopes, budgets, blockers, approvals, checkpoints, tests, security state and evidence.

### IDE/workspace
Provide an engineering workspace model for repository tree, files, editor buffers, diffs, diagnostics, search/context references, terminal intents, tests and preview references. Browser-local implementation may model and inspect these artifacts but must not pretend to be a native filesystem/host shell when such authority is absent.

### Engineering Spaces
Project-bound spaces bind objective, requirements, repository metadata, architecture, data, infra, agents, work, issues, tests, PR metadata, deployments, incidents, decisions and evidence. Cross-project reuse fails closed.

### Agent fleet
Compose with earned Mission Control. Preserve separate workload identities, grants, budgets, revocation/kill controls and independent verifier/security roles. No giant shared agent credential.

### Deep Context and System Graph
Reuse sealed FA-10 authority invariance. Engineering context may influence retrieval/planning/relevance but retrieved content remains data, never authority. Extend engineering projections without weakening the seven-domain truth boundary or authority hashes.

### Terminal and execution
Reuse sealed FA-11 S0–S5 authorization. The Command Center may request governed execution but cannot bypass the independent authorization gateway, network policy, sandbox/worktree isolation, secret broker rules or approval separation.

### Complete checkpoints
A checkpoint must be hash-bound to engineering state including, where present: git/repository tree identity, dependency state, migration state, environment metadata, plan, acceptance criteria, test results, Product Reality snapshot references, security results, artifacts and evidence hash. Revert must be explicit, scoped, auditable and must not silently mutate production authority.

### Preview / Product Reality
Reuse sealed FA-12. A rendered preview or screenshot is not visual-completion proof. Missing screenshot/accessibility/device/runtime evidence remains missing/not-proven exactly as FA-12 requires.

### Model/capability routing
Provide qualification-aware routing metadata across model/capability candidates using quality, reliability, latency, cost, privacy, context, tool support, historical success and qualification state. This router cannot promote an unqualified model/capability or imply provider availability that has not been evidenced.

### Cloud handoff truth boundary
Implement a governed cloud-handoff contract and evidence package only where it can be grounded in the earned execution/agent model. No remote/cloud executor may be fabricated. If no independently qualified cloud execution substrate is connected and verified, the row remains `IMPLEMENTED_BLOCKED_EXTERNAL`/`NOT_PROVEN` as appropriate.

### Deployment truth boundary
Implement the governed deployment control-plane/state model for:
`BUILD → TEST → SECURITY → A11Y → VISUAL → STAGING → SMOKE → CANARY → PRODUCTION → OBSERVE → ROLLBACK`.

FA-13 does not itself grant production credentials, production deployment authority, staging infrastructure or permission to skip later release gates. A state-machine/UI/control-plane implementation is not proof that staging/canary/production deployment occurred.

### Enterprise/security truth boundary
Expose policy-graph/control-plane contracts that compose with existing identity, Project permissions, Agent grants, S0–S5 authorization, data/network/action policy and independent security/verifier roles. Do not invent SSO/organization provider integration or independent external red-team evidence where it is absent.

### AXIOM breadth preservation
Engineering is one subsystem. FA-13 must not delete, hide or redefine Projects, Work, Research, Knowledge/Memory, Analyze, Twins/Scenario, Artifacts/Create, Computer, Live, Automations, Evidence, Trust, Developer, Marketplace or Enterprise capabilities. Home remains outcome-first rather than IDE-first.

## Required adversarial verification
Before FA-13 can be earned, a read-only repository gate must prove at minimum:
1. all 14 acceptance rows exist with explicit evidence state and row-specific evidence;
2. no row can self-promote from UI presence/naming alone;
3. missing external cloud/runtime/deployment/SSO/red-team evidence stays blocked/not-proven;
4. Engineering Mission Control is project-bound and cross-project reuse fails closed;
5. agent fleet preserves workload identity, least privilege, budgets, kill/revoke and independent roles;
6. Deep Context/retrieved content cannot alter authority;
7. System Graph relations cannot delegate authority;
8. terminal/execution paths remain behind independent S0–S5 authorization;
9. path/worktree/sandbox/network/secret boundaries remain fail closed;
10. checkpoints are hash-bound, complete for the declared state and tamper-evident;
11. revert cannot silently elevate authority or mutate production state;
12. Product Reality remains no-fake-visual-completion;
13. model/capability routing cannot select unqualified candidates as qualified;
14. deployment sequence cannot skip required stages or convert control-plane state into deployment evidence;
15. enterprise/security control-plane metadata cannot self-attest external SSO/red-team qualification;
16. AXIOM breadth remains present and Home remains outcome-first;
17. sealed FA-12/FA-11/FA-10/FA-09 authorities remain unchanged;
18. protected `mcp/`, `auth/`, submission/publication surfaces remain unchanged;
19. cumulative vNext and selected earned legacy regressions pass;
20. CI remains read-only with no repository-write/deploy authority.

## Claim boundary
Passing repository tests may earn only the FA-13 implementation gate for rows actually proven to satisfy the frozen matrix. It does not by itself prove production deployment, live cloud-agent execution, external enterprise SSO, independent external red-team validation, legacy Phase 13/14/15, Wolfram parity or superiority.

If any frozen acceptance row still requires evidence or infrastructure that is not actually available, FA-13 must remain unsealed and report that exact blocker rather than weakening the matrix.
