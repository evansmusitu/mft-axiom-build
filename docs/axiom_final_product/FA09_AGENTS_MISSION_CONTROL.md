# FA-09 — Agents / Mission Control

Status: IMPLEMENTED_PENDING_REPOSITORY_VERIFICATION

## Implementation boundary
FA-09 composes the already-earned browser-local Agent, Project and Observability substrates. It does not replace their grant, delegation, approval, budget, kill-switch, provenance or trace semantics.

## Least-privilege verifier
`vnext/mission_control_verifier.js` independently fails closed unless active workload identities are unique, delegated grants stay within parent authority and depth, budgets and kill states are valid, enabled automations retain exact approval authority, Agent-store integrity reports PASS, and every redirect is non-escalating and provenance-linked.

## Redirect sidecar
`vnext/mission_control_store.js` adds browser-local responsibility redirects only. A redirect requires Project-owner authority, same-project distinct active non-killed Agents, a target grant that is a subset of the source grant, shared required tool/data scopes, and a stored confirmation preview whose exact hash is fresh and unconsumed. Confirmation is bound to the current source/target grant hashes.

A recorded redirect creates a Project `mission-control-redirect` edge plus tamper-evident redirect receipt and event-chain evidence. Receipts explicitly record no external action, no network request and no plaintext secret access. Missing receipt, event, hash, Agent authority or Project provenance remains FAIL.

## Mission Control UI
`vnext/mission_control_ui.js` overlays the existing Agents route additively with execution/delegation/redirect lineage, workload identities, grants, budgets, exact kill-switch preview/confirmation, bounded child delegation, redirect preparation/confirmation, and integrity state. Existing Agent registration and Automations local-preview behavior remain intact.

## Claim boundary
FA-09 does not claim remote/cloud agents, production workload isolation, external consequential execution, model invocation, plaintext-secret access, Phase 13/14/15 evidence, Wolfram parity or superiority. Repository verification is required before the FA-09 implementation gate is earned.
