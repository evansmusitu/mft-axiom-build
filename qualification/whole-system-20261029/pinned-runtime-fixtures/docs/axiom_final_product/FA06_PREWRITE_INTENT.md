# FA-06 — Governed Implementation Intent

Status: IMPLEMENTATION_AUTHORIZED by explicit user instruction `START BUILDING` on 2026-09-15.

## Authority baseline
- Source commit: `a582372dd2e19aef3058cd26269bc45fbff435f9` (`frontier/axiom-v5-final-app-vnext-20260914` snapshot).
- Source tree: `d5870ebbe1f48e4f3250126e0300829e999a18cb`.
- Isolated implementation branch: `frontier/axiom-final-product-fa06-20260915`.
- `main` remains untouched at `d6a846f6bbe0bccac1758713eb4de167caf07113`.
- PR #1 remains OPEN, DRAFT, UNMERGED and is not the implementation vehicle for this phase.

## Objective
Earn FA-06 Application Foundation without widening authority: establish the final-product design-system foundation, stable global shell contracts, typed/runtime-validated Project/Work/Agent/Artifact/Evidence object contracts, and a same-origin identity/session adapter that relies on secure server cookies rather than browser-stored credentials.

## Scope
1. Add explicit five-object runtime contracts and validators.
2. Add design-system token contracts usable by the browser application without deleting existing surfaces.
3. Add global-shell navigation/inspection contracts preserving the approved surface breadth.
4. Add an identity/session adapter that is fail-closed, same-origin, credential-cookie based, timeout-aware, abortable, and does not persist secrets in localStorage/sessionStorage.
5. Integrate the foundation with the existing vNext browser scaffold using additive changes.
6. Add deterministic tests for contracts, identity/session behavior, and shell invariants.

## Non-scope
- No production deployment.
- No modification of `main`.
- No modification of PR #1.
- No promotion of the 2,235 discovered candidate DAGs.
- No parity/superiority claim.
- No widening of S0-S5 authority.
- No external-action execution substrate yet; that belongs to later governed phases.

## Acceptance tests
- All five durable object types have explicit versioned contracts and reject structurally invalid objects.
- Shell contract includes every approved final-product capability class or an explicit preserved route mapping.
- Identity/session adapter uses `credentials: "include"`, same-origin URLs, explicit timeout/abort, and fail-closed unauthenticated state.
- No credential/token persistence is added to Web Storage.
- Existing vNext tests remain compatible.
- New FA-06 deterministic tests pass locally against the exact branch contents.

## Security scope
- S0/S1 only for this phase's browser-foundation state.
- Authentication authority remains server-side.
- Browser code may observe session state but cannot grant roles/scopes to itself.
- Retrieved data remains data, not authority.
- No long-lived secrets are introduced.

## Rollback plan
The rollback origin is the untouched source tree `d5870ebbe1f48e4f3250126e0300829e999a18cb`. FA-06 changes are isolated to this branch and can be abandoned without changing production, `main`, PR #1, or the production rollback origin.
