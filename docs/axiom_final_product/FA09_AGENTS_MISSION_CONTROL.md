# FA-09 — Agents / Mission Control

Status: EARNED_IMPLEMENTATION_GATE

Pre-verification state: `IMPLEMENTED_PENDING_REPOSITORY_VERIFICATION`.

## Implementation boundary
FA-09 composes the already-earned browser-local Agent, Project and Observability substrates. It does not replace their grant, delegation, approval, budget, kill-switch, provenance or trace semantics.

## Least-privilege verifier
`vnext/mission_control_verifier.js` independently fails closed unless active workload identities are unique, delegated grants stay within parent authority and depth, budgets and kill states are valid, enabled automations retain exact approval authority, Agent-store integrity reports PASS, and every redirect is non-escalating and provenance-linked.

## Redirect sidecar
`vnext/mission_control_store.js` adds browser-local responsibility redirects only. A redirect requires Project-owner authority, same-project distinct active non-killed Agents, a target grant that is a subset of the source grant, shared required tool/data scopes, and a stored confirmation preview whose exact hash is fresh and unconsumed. Confirmation is bound to the current source/target grant hashes.

A recorded redirect creates a Project `mission-control-redirect` edge plus tamper-evident redirect receipt and event-chain evidence. Receipts explicitly record no external action, no network request and no plaintext secret access. Missing receipt, event, hash, Agent authority or Project provenance remains FAIL.

## Mission Control UI
`vnext/mission_control_ui.js` overlays the existing Agents route additively with execution/delegation/redirect lineage, workload identities, grants, budgets, exact kill-switch preview/confirmation, bounded child delegation, redirect preparation/confirmation, and integrity state. Existing Agent registration and Automations local-preview behavior remain intact.

## Repository verification evidence
FA-09 was independently repository-verified on exact commit `1c8b0f24d7a82003ad2de0a07a6d70d60c40a0e6` by GitHub Actions run `34944046502`, job `104299142591`, conclusion SUCCESS.

The gate proved:
- cumulative vNext deterministic suite: 36/36 PASS, including all eight FA-09 positive/adversarial Mission Control tests;
- earned Phase-9 Agent regressions: 7/7 PASS;
- earned Project regressions: 7/7 PASS;
- earned Observability regressions: 6/6 PASS;
- `axiom_interface/agent_security.js`, `axiom_interface/agent_store.js`, `axiom_interface/projects.js`, and `axiom_interface/observability.js` were unchanged from verified FA-08 head `714ac26db04c832f56665b26a18747e61404f533`;
- Mission Control syntax and final-product UI wiring passed;
- redirect non-escalation, exact-confirmation, provenance, no-external-action, no-network and no-plaintext-secret boundaries passed;
- CI token permissions were `Contents: read` and `Metadata: read`, checkout persisted no credentials, and the gate exposed no deploy or repository-write capability.

A sealing-document commit must pass the same repository gate again before it is treated as the final FA-09 branch head.

## Claim boundary
This earns only the FA-09 final-product implementation gate. It does not certify production deployment, remote/cloud agents, production workload isolation, external consequential execution, independent external security, model invocation, plaintext-secret access, Phase 13/14/15 evidence, Wolfram parity or superiority.
