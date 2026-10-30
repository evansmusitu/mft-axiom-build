# FA-09 — Agents & Mission Control Governed Implementation Intent

Status: IMPLEMENTATION_AUTHORIZED under the explicit `START BUILDING` instruction.

## Authority baseline
- Verified predecessor: FA-08 final head `714ac26db04c832f56665b26a18747e61404f533`.
- Isolated implementation branch: `frontier/axiom-final-product-fa09-20260915`.
- `main` remains untouched at `d6a846f6bbe0bccac1758713eb4de167caf07113`.
- PR #1 remains OPEN, DRAFT, UNMERGED and is not the implementation vehicle.

## Objective
Earn FA-09 Agents & Mission Control by surfacing the already-earned browser-local governed agent substrate as a final-product Mission Control, adding a provenance-preserving local redirect control, execution-graph inspection, and an independent least-privilege verifier without creating new external execution authority.

## Preserve, do not replace
- `axiom_interface/agent_security.js` remains the grant, delegation, network, secrets, autonomy, trigger and budget policy authority.
- `axiom_interface/agent_store.js` remains the governed agent/automation registry authority for separate workload identities, grants, approvals, budgets, kill-switch cascades, local-preview receipts and integrity verification.
- Existing Project and Observability substrates remain authoritative dependencies.
- Historical Phase 9 agent evidence remains historical truth and is not rewritten by this final-product FA-09 gate.

## Scope
1. Add a pure least-privilege Mission Control verifier covering agents, parent-child delegation, automations, workload identities, budgets, kill state and redirects.
2. Add a browser-local Mission Control sidecar for exact-confirmation redirects between governed agents.
3. Redirect is permitted only within the same Project when source and target are ACTIVE, distinct, not killed, and the target grant is an exact least-privilege subset of the source grant. Redirect can never elevate authority.
4. Persist redirect decisions with tamper-evident receipts/events and Project provenance links to both agent objects.
5. Upgrade the vNext Agents surface into Mission Control with execution graph, workload identity, grants, budget usage, delegation, kill preview/confirmation and redirect visibility.
6. Preserve the Automations local-preview boundary and existing exact-configuration approval policy.
7. Add deterministic positive and adversarial tests and re-run the earlier earned agent regression suite.

## Non-scope
- No remote/cloud agent execution.
- No production deployment.
- No external consequential action execution.
- No model invocation or external network access added by FA-09.
- No plaintext secret access.
- No self-granted roles/scopes and no bypass of Project owner authority.
- No candidate DAG promotion.
- No Phase 13/14/15, parity or superiority claims.

## Acceptance gate — least privilege
- Every active Agent has a unique workload identity.
- Delegated Agent grants must remain subsets of the parent grant and within delegation depth.
- Agent usage must not exceed run or compute budgets.
- Killed agents must have kill switch engaged; killed ancestors cannot leave descendants active.
- Enabled Automations must remain inside the owning Agent grant and retain exact approval receipts.
- Redirect source/target must be same-project, active, distinct and non-killed.
- Redirect target grant must be a subset of source grant; required tool/data scopes must be present in both.
- Redirect requires an exact, fresh confirmation hash and records no external action/network/secret access.
- Mission Control and Agent store integrity must PASS independently.
- Any missing or inconsistent authority/evidence remains FAIL.
- Existing Phase 9 agent regression tests remain passing.

## Security scope
- S0/S1 browser-local state only.
- Existing `DENY_ALL_EXTERNAL_NETWORK` and symbolic-secret policies remain authoritative.
- Builders do not self-certify; repository verification must exercise adversarial least-privilege failures.
- Retrieved data remains data, not authority.

## Rollback
Abandon the FA-09 branch and return to verified FA-08 head `714ac26db04c832f56665b26a18747e61404f533`. Production, `main`, PR #1 and prior verified phase branches remain unchanged.
